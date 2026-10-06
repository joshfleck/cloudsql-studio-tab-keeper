(() => {
    'use strict';

    const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
    const SAVE_DELAY_MS = 1000;
    const MAX_LINES = 5000;

    // The console is a single-page app, so the script is injected on every
    // console page and only acts while the current route is a Studio page.
    const studioInstance = () => location.pathname.match(/^\/sql\/instances\/([^/]+)\/studio/)?.[1] ?? null;

    // The database name is only known once the login completes and the
    // Explorer tree has rendered; until then nothing is saved or restored.
    const currentDatabase = () =>
        studioInstance() &&
        (document
            .querySelector('button[aria-label="Icon for database level in the tree navigation"]')
            ?.closest('[role=treeitem]')
            ?.textContent.trim() ||
            null);

    const storageKey = () => {
        const database = currentDatabase();
        if (!database) return null;
        const project = new URLSearchParams(location.search).get('project');
        return `studio-tab-keeper:${project}:${studioInstance()}:${database}`;
    };

    const readState = () => {
        try {
            return JSON.parse(localStorage.getItem(storageKey()) || '{}');
        } catch {
            return {};
        }
    };

    const writeState = state => {
        try {
            localStorage.setItem(storageKey(), JSON.stringify(state));
        } catch {
            // storage unavailable or full; tabs are simply not kept
        }
    };

    const hasContent = snapshot => Boolean(snapshot?.tabs?.some(sql => sql?.trim()));

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    const waitFor = async (predicate, timeoutMs = 5000) => {
        const end = Date.now() + timeoutMs;
        while (Date.now() < end) {
            const value = predicate();
            if (value) return value;
            await sleep(100);
        }
        return null;
    };

    const queryTabs = () =>
        [...document.querySelectorAll('button[role=tab][mat-tab-link]')].filter(
            tab => tab.getAttribute('aria-label') !== 'Home',
        );

    const activeIndex = () => queryTabs().findIndex(tab => tab.getAttribute('aria-selected') === 'true');

    const editorRoot = () => document.querySelector('.monaco-editor');

    const inputArea = () => document.querySelector('.monaco-editor textarea.inputarea');

    const newTabButton = () => [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'New tab');

    const renderedLines = () =>
        [...document.querySelectorAll('.monaco-editor .view-lines .view-line')]
            .sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top))
            .map(line => line.textContent.replace(/ /g, ' '));

    const visibleText = () => renderedLines().join('\n');

    // Monaco only renders the lines inside its viewport. The editor's host is
    // absolutely positioned inside an overflow:hidden container, so growing it
    // to fit the whole document makes Monaco render every line without
    // anything changing on screen.
    const fullText = async () => {
        const root = editorRoot();
        const host = root?.closest('.cfc-code-editor');
        const lineHeight = root?.querySelector('.view-line')?.getBoundingClientRect().height;
        if (!host || !lineHeight) return visibleText();

        const viewportLines = Math.floor(root.getBoundingClientRect().height / lineHeight);
        if (renderedLines().length < viewportLines - 1) return visibleText();

        const originalHeight = host.style.height;
        const originalEditorHeight = root.style.height;
        const scrollContent = () => root.querySelector('.lines-content');
        const scrollTop = () => -parseFloat(scrollContent()?.style.top || '0');
        const savedScrollTop = scrollTop();

        let capacity = 400;
        let text = visibleText();
        while (capacity <= MAX_LINES * 4) {
            const targetHeight = `${Math.ceil(capacity * lineHeight)}px`;
            host.style.height = targetHeight;
            await waitFor(() => root.style.height === targetHeight);
            await sleep(200);
            const lines = renderedLines();
            text = lines.join('\n');
            if (lines.length < capacity - 2 || lines.length >= MAX_LINES) break;
            capacity *= 4;
        }

        host.style.height = originalHeight;
        await waitFor(() => root.style.height === originalEditorHeight);
        await sleep(200);

        const drift = savedScrollTop - scrollTop();
        if (drift) {
            root.querySelector('.monaco-scrollable-element')?.dispatchEvent(
                new WheelEvent('wheel', { deltaY: drift, bubbles: true, cancelable: true }),
            );
        }
        return text;
    };

    // Moves the previous session's tabs aside, once per database per page load,
    // so edits in this session cannot overwrite what is offered for restore.
    const rotatedKeys = new Set();
    const rotateStaleSession = ({ force = false } = {}) => {
        const key = storageKey();
        if (!key || (!force && rotatedKeys.has(key))) return;
        rotatedKeys.add(key);
        const state = readState();
        if (hasContent(state.current)) {
            state.previous = state.current;
        }
        state.current = { at: Date.now(), tabs: [] };
        if (state.previous && Date.now() - state.previous.at > MAX_AGE_MS) {
            delete state.previous;
        }
        writeState(state);
    };

    let saveTimer = null;
    let saving = false;

    const saveNow = async () => {
        clearTimeout(saveTimer);
        saveTimer = null;
        if (saving) return;
        const key = storageKey();
        const index = activeIndex();
        const modelUri = editorRoot()?.dataset.uri;
        if (!key || index < 0 || !inputArea()) return;
        rotateStaleSession();
        saving = true;
        try {
            const text = await fullText();
            // Skip if the user switched tabs or database while the editor was being read.
            if (storageKey() !== key || activeIndex() !== index || editorRoot()?.dataset.uri !== modelUri) return;
            const state = readState();
            const tabs = state.current?.tabs ?? [];
            tabs[index] = text;
            state.current = { at: Date.now(), tabs };
            writeState(state);
        } finally {
            saving = false;
        }
    };

    const scheduleSave = () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveNow, SAVE_DELAY_MS);
    };

    const isEditorInput = event => event.target?.matches?.('.monaco-editor textarea');

    // Monaco handles paste and cut itself without firing an input event.
    for (const type of ['input', 'keyup', 'paste', 'cut', 'drop']) {
        document.addEventListener(type, event => isEditorInput(event) && scheduleSave(), true);
    }

    // A pending save must finish before Studio swaps the editor to another tab's model.
    let replayingClick = false;
    document.addEventListener(
        'click',
        async event => {
            const target = event.target;
            if (replayingClick || saveTimer === null) return;
            if (!target.closest?.('button[role=tab]') || target.closest('button[aria-label="Close tab"]')) return;
            event.stopImmediatePropagation();
            event.preventDefault();
            await saveNow();
            replayingClick = true;
            target.click();
            replayingClick = false;
        },
        true,
    );

    document.addEventListener(
        'click',
        async event => {
            const close = event.target.closest?.('button[aria-label="Close tab"]');
            if (!close || !storageKey()) return;
            const tab = close.closest('button[role=tab]');
            const index = queryTabs().indexOf(tab);
            const before = queryTabs().length;
            await sleep(700);
            if (index < 0 || queryTabs().length >= before) return;
            const state = readState();
            state.current?.tabs?.splice(index, 1);
            writeState(state);
        },
        true,
    );

    // A paste event inserts the text verbatim. Typing it (execCommand insertText)
    // would trigger Monaco's auto-indent and auto-closing brackets and quotes.
    const pasteIntoEditor = async text => {
        const area = await waitFor(inputArea);
        if (!area) return false;
        area.focus();
        const data = new DataTransfer();
        data.setData('text/plain', text);
        area.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
        return true;
    };

    const restoreTabs = async tabs => {
        for (const sql of tabs) {
            if (!sql?.trim()) continue;
            if (activeIndex() < 0 && queryTabs()[0]) {
                queryTabs()[0].click();
                await sleep(300);
            }
            const reusable = activeIndex() >= 0 && !visibleText().trim();
            if (!reusable) {
                const before = queryTabs().length;
                newTabButton()?.click();
                await waitFor(() => queryTabs().length > before);
                await sleep(300);
            }
            await pasteIntoEditor(sql);
            await waitFor(() => visibleText().trim());
            await saveNow();
        }
    };

    let banner = null;
    let bannerKey = null;
    let restoring = false;

    const dismissBanner = () => {
        banner?.remove();
        banner = null;
        bannerKey = null;
    };

    const showBanner = (previous, database) => {
        const count = previous.tabs.filter(sql => sql?.trim()).length;
        banner = document.createElement('div');
        bannerKey = storageKey();
        banner.style.cssText =
            'position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:10px 12px;background:#202124;color:#fff;' +
            'font:13px/1.4 Roboto,sans-serif;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.4);display:flex;gap:8px;align-items:center';
        const label = document.createElement('span');
        label.textContent =
            `Restore ${count} saved tab${count === 1 ? '' : 's'} for "${database}" ` +
            `from ${new Date(previous.at).toLocaleString()}?`;
        const restore = document.createElement('button');
        restore.textContent = 'Restore';
        const discard = document.createElement('button');
        discard.textContent = 'Discard';
        for (const button of [restore, discard]) {
            button.style.cssText = 'cursor:pointer;border:0;border-radius:4px;padding:4px 10px;font:inherit';
        }
        restore.onclick = async () => {
            const state = readState();
            dismissBanner();
            restoring = true;
            await restoreTabs(state.previous?.tabs ?? []);
            const after = readState();
            delete after.previous;
            writeState(after);
            restoring = false;
        };
        discard.onclick = () => {
            const state = readState();
            delete state.previous;
            writeState(state);
            dismissBanner();
        };
        banner.append(label, restore, discard);
        document.body.append(banner);
    };

    // Studio can also drop its tabs in place (back to the database login
    // without a page reload). That shows up as fewer open tabs than were
    // saved, or a lone open tab that is empty although a non-empty one was saved.
    const tabsWereLost = () => {
        const saved = readState().current;
        if (!hasContent(saved) || saving) return false;
        const live = queryTabs().length;
        if (live < saved.tabs.length) return true;
        return live === 1 && activeIndex() === 0 && Boolean(inputArea()) && !visibleText().trim();
    };

    let announced = false;

    // The tab strip and database name only exist once the database login has completed.
    setInterval(() => {
        const database = currentDatabase();
        if (database && !announced) {
            announced = true;
            console.info(`[studio-tab-keeper] tracking tabs for database "${database}"`);
        }
        if (banner && bannerKey !== storageKey()) dismissBanner();
        if (banner || restoring || saveTimer !== null || !database || !queryTabs().length) return;
        rotateStaleSession();
        if (tabsWereLost()) rotateStaleSession({ force: true });
        const { previous } = readState();
        if (hasContent(previous)) showBanner(previous, database);
    }, 2000);
})();

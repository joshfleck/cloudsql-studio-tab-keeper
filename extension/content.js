(() => {
    'use strict';

    const SAVE_DELAY_MS = 1000;
    const MAX_LINES = 5000;
    const TOAST_MS = 5000;
    const FADE_MS = 300;
    // Monaco renders spaces inside lines as non-breaking spaces.
    const NBSP = String.fromCharCode(160);

    // Published into the page by bridge.js, which can read chrome.storage.
    const settings = () => {
        try {
            return JSON.parse(document.documentElement.dataset.studioTabKeeper || '{}');
        } catch {
            return {};
        }
    };

    const CARD_STYLE =
        'display:flex;gap:10px;align-items:center;padding:12px 16px;background:#202124;color:#fff;' +
        'font:14px/1.4 Roboto,sans-serif;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.45);' +
        `pointer-events:auto;opacity:1;transition:opacity ${FADE_MS}ms ease`;

    const fadeOut = element => {
        element.style.pointerEvents = 'none';
        element.style.opacity = '0';
        setTimeout(() => element.remove(), FADE_MS);
    };

    const makeCloseButton = onClick => {
        const button = document.createElement('button');
        button.textContent = '×';
        button.setAttribute('aria-label', 'Dismiss');
        button.style.cssText =
            'flex:none;cursor:pointer;border:0;background:transparent;color:#9aa0a6;font:22px/1 Roboto,sans-serif;padding:0 0 0 4px';
        button.onclick = onClick;
        return button;
    };

    // Top-center, over the console header's search bar (nothing there needs
    // to stay visible): notices and the restore banner stack here instead of
    // overlapping, and the banner stays clear of the editor's tabs and toolbar.
    let overlay = null;
    const getOverlay = () => {
        if (!overlay?.isConnected) {
            overlay = document.createElement('div');
            overlay.style.cssText =
                'position:fixed;top:2px;left:50%;transform:translateX(-50%);z-index:2147483647;display:flex;' +
                'flex-direction:column;align-items:center;gap:8px;pointer-events:none';
            document.body.append(overlay);
        }
        return overlay;
    };

    let toast = null;
    let toastTimer = null;

    const hideToast = () => {
        clearTimeout(toastTimer);
        if (!toast) return;
        fadeOut(toast);
        toast = null;
    };

    const showToast = message => {
        if (!toast) {
            toast = document.createElement('div');
            toast.style.cssText = CARD_STYLE;
            const check = document.createElement('span');
            check.textContent = '✓';
            check.style.cssText =
                'flex:none;width:22px;height:22px;border-radius:50%;background:#34a853;color:#fff;' +
                'font:bold 14px/22px Roboto,sans-serif;text-align:center';
            toast.append(check, document.createElement('span'), makeCloseButton(hideToast));
            getOverlay().prepend(toast);
        }
        toast.children[1].textContent = message;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(hideToast, TOAST_MS);
    };

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
            .map(line => line.textContent.replaceAll(NBSP, ' '));

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
            if (tabs[index] === text) return;
            tabs[index] = text;
            state.current = { at: Date.now(), tabs };
            writeState(state);
            if (settings().notifyOnSave) {
                showToast(`Saved tab ${index + 1} (${text.split('\n').length} lines)`);
            }
        } finally {
            saving = false;
        }
    };

    const scheduleSave = () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveNow, SAVE_DELAY_MS);
    };

    const isEditorInput = event => event.target?.matches?.('.monaco-editor textarea');

    // Keys that move the cursor or only modify other keys never change the text.
    const NON_EDITING_KEYS = new Set([
        'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown',
        'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Escape',
    ]);
    const isNonEditingKey = event =>
        NON_EDITING_KEYS.has(event.key) ||
        ((event.metaKey || event.ctrlKey) && ['a', 'c', 'f'].includes(event.key.toLowerCase()));

    // Monaco handles paste and cut itself without firing an input event, and
    // undo/redo are keyboard shortcuts, so keyup is watched as well.
    for (const type of ['input', 'keyup', 'paste', 'cut', 'drop']) {
        document.addEventListener(
            type,
            event => {
                if (!isEditorInput(event) || (type === 'keyup' && isNonEditingKey(event))) return;
                scheduleSave();
            },
            true,
        );
    }

    // Toolbar buttons that rewrite the editor text without any keyboard event.
    const EDITING_BUTTONS = new Set(['Format', 'Clear']);
    document.addEventListener(
        'click',
        event => {
            const button = event.target.closest?.('button');
            if (button && EDITING_BUTTONS.has(button.textContent.trim())) scheduleSave();
        },
        true,
    );

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

    // Databases whose banner the user closed with the X; not offered again until the page reloads.
    const dismissedKeys = new Set();

    const dismissBanner = () => {
        if (banner) fadeOut(banner);
        banner = null;
        bannerKey = null;
    };

    const runRestore = async (previous, database) => {
        const count = previous.tabs.filter(sql => sql?.trim()).length;
        restoring = true;
        try {
            await restoreTabs(previous.tabs);
            const after = readState();
            delete after.previous;
            writeState(after);
        } finally {
            restoring = false;
        }
        showToast(`Restored ${count} tab${count === 1 ? '' : 's'} for "${database}"`);
    };

    const showBanner = (previous, database) => {
        const count = previous.tabs.filter(sql => sql?.trim()).length;
        banner = document.createElement('div');
        bannerKey = storageKey();
        banner.style.cssText = CARD_STYLE;
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
        restore.onclick = () => {
            const saved = readState().previous ?? previous;
            dismissBanner();
            runRestore(saved, database);
        };
        discard.onclick = () => {
            const state = readState();
            delete state.previous;
            writeState(state);
            dismissBanner();
        };
        const close = makeCloseButton(() => {
            dismissedKeys.add(bannerKey);
            dismissBanner();
        });
        banner.append(label, restore, discard, close);
        getOverlay().append(banner);
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
        if (!hasContent(previous)) return;
        if (settings().autoRestore) runRestore(previous, database);
        else if (!dismissedKeys.has(storageKey())) showBanner(previous, database);
    }, 2000);
})();

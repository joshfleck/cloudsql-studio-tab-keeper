const init = async () => {
    const settings = await chrome.storage.sync.get(TAB_KEEPER_DEFAULTS);
    for (const name of Object.keys(TAB_KEEPER_DEFAULTS)) {
        const checkbox = document.getElementById(name);
        checkbox.checked = settings[name];
        checkbox.addEventListener('change', () => chrome.storage.sync.set({ [name]: checkbox.checked }));
    }
};

init();

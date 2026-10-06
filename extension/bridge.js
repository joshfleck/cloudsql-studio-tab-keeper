// Runs in the extension's isolated world, where chrome.storage is available,
// and publishes the settings on <html> for content.js, which runs in the page's world.
const publishSettings = async () => {
    const settings = await chrome.storage.sync.get(TAB_KEEPER_DEFAULTS);
    document.documentElement.dataset.studioTabKeeper = JSON.stringify(settings);
};

publishSettings();

chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === 'sync') publishSettings();
});

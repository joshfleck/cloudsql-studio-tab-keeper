# Cloud SQL Studio tab keeper

A small Chrome extension that keeps your **Cloud SQL Studio** editor tabs when Studio drops them, and offers to restore them.

Studio forgets every open editor tab when its database login expires and sends you back to the login screen. Saved queries are the only built-in way to keep them, and those are shared across the whole project. This extension keeps your scratch tabs privately in your own browser instead.

## Install

Requires Chrome (or another Chromium browser) 111 or newer.

1. Clone or download this repository.
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the `extension` folder.
5. Reload any open Cloud SQL Studio tab.

After updating the files, click the extension's **Reload** button on `chrome://extensions` and reload the Studio tab.

## Use

There is nothing to do while you work. Tabs are saved in the background.

When Studio drops your tabs (or after a page reload, once you log back into the database), a banner appears in the bottom-right corner:

> Restore 3 saved tabs for "my-database" from 10/6/2026, 11:49 AM?

- **Restore** recreates the tabs and pastes their contents back in.
- **Discard** throws the saved tabs away.

To check the extension is active, open DevTools → Console on a Studio tab after logging in. You should see
`[studio-tab-keeper] tracking tabs for database "…"`.

## How it works

- **When it saves:** one second after you stop editing (typing, paste, cut), and just before you switch to another tab. It does not save on reload, so an edit made less than a second before a reload is lost.
- **Per database:** tabs are stored per project, instance and database. Tabs from one database are never offered when you log into another.
- **Storage:** the page's `localStorage`, in your browser profile only. Nothing is sent anywhere, and the extension requests no permissions. Saved tabs older than 7 days are dropped.
- **Detecting lost tabs:** after a page reload, or when Studio drops its tabs in place (fewer open tabs than were saved, or a lone empty tab where a non-empty one was saved).
- **Long queries:** Studio's editor only renders the lines in view. To read a whole tab, the extension briefly makes the editor's (clipped, invisible) container tall enough to hold every line, reads the text, and restores the height and scroll position. Up to 5000 lines per tab are kept.
- **Restore:** text is pasted with a synthetic paste event so the editor does not apply auto-indent or auto-close brackets and quotes to it.

## Limitations

- Restored tabs are named "Untitled query", and tab order is assumed from position.
- Only the tab contents are restored: not cursor position, scroll position, results, or query history.
- It depends on Studio's undocumented page structure (`role=tab`, `aria-label="New tab"`, the Monaco editor classes), so a console UI change can break it.
- Saved SQL stays in your browser profile and may contain sensitive literals from production queries. Use Discard, or clear the site's data, if that matters.
- Only Cloud SQL Studio is supported (`console.cloud.google.com/sql/instances/<instance>/studio`).

## Troubleshooting

- **No console message:** the extension is not running. Check `chrome://extensions` for errors on this extension, make sure it is enabled, and reload the Studio tab.
- **Message appears but no banner:** the banner only appears after the database login completes and only if tabs were saved for that exact database.
- **Tabs not saved:** wait a second after your last edit before reloading.

## Files

- `extension/manifest.json`: Manifest V3, runs `content.js` on console pages in the page's own context (`"world": "MAIN"`).
- `extension/content.js`: all of the logic.

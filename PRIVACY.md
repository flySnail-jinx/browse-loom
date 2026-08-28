# Privacy Policy for BrowseLoom

Last updated: August 21, 2026

BrowseLoom is a local-first Chromium extension that replaces the new tab page with a dashboard for organizing open browser tabs and a separate plugin-local bookmark workspace.

This policy explains what data the extension uses, where it is stored, and what external requests may occur.

## Single Purpose

BrowseLoom helps users organize, filter, save, restore, and close browser tabs from a local new-tab dashboard and optional side panel.

## Data the Extension Uses

BrowseLoom may read the following browser tab information to render the dashboard:

- tab title
- tab URL
- tab window ID
- tab active state
- tab pinned state
- Chrome Tab Group ID and group metadata
- recently closed tab/window metadata exposed by `chrome.sessions`
- temporary tab/window IDs used by quick return navigation

This information is used only to display and manage tabs inside the extension UI.

## Data Stored Locally

BrowseLoom stores the following data locally on the user's device:

- saved-for-later tab URLs and titles
- saved-for-later completion/archive state
- saved session URLs, titles, window order, and group labels; pinned tabs are excluded
- lightweight local activity stats and achievement flags
- privacy mode state and privacy screen settings
- selected view mode
- selected language
- selected theme
- cached favicon images when the user enables external site icons
- custom bookmark titles, URLs, notes, icon choices, folder layout, order, and local open counts

Saved tabs, preferences, and settings are stored using `chrome.storage.local` and `localStorage`.

Quick return navigation stores only the dashboard and destination tab/window IDs in `chrome.storage.session`. This data remains in memory, is not persisted to disk, and is cleared when the browser restarts, the extension reloads, or the extension is disabled.

## Data Sharing

BrowseLoom does not:

- sell user data
- use user data for advertising
- transfer tab lists to a developer-operated server
- collect analytics or telemetry
- require an account
- run a backend service

BrowseLoom's use of information received from Chrome extension APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.

## External Requests

External site icons are optional and disabled by default. If the user explicitly enables **Load site icons via DuckDuckGo** in BrowseLoom's privacy settings, BrowseLoom requests favicons from:

```text
https://icons.duckduckgo.com
```

Each request sends the website's domain name to DuckDuckGo so that the matching icon can be returned. The request does not include the full tab list or page content. These requests are used only to display small site icons next to tab and custom bookmark entries. Favicons are cached locally for up to 7 days to reduce repeated network requests.

Users can disable external favicon requests again at any time. When disabled, cached favicons may still render, but new domains will not request icons from the external service.

Privacy mode does not provide a web search box and does not change the browser search provider.

## Permissions

BrowseLoom requests the following extension permissions:

| Permission | Purpose |
| --- | --- |
| `tabs` | Read open tabs, focus tabs, close tabs, and create tab groups |
| `storage` | Store saved tabs, custom bookmarks, saved sessions, local stats, and local preferences |
| `tabGroups` | Read, create, update, collapse, and ungroup Chrome Tab Groups |
| `sidePanel` | Show the optional side panel tab center |
| `sessions` | Display and restore recently closed browser tabs/windows |
| `bookmarks` (optional) | Read the current browser bookmark tree after the user explicitly starts an import |

The extension requests `bookmarks` at runtime rather than installation. The browser permission warning says the extension can read and change bookmarks because that is the API's permission scope, but BrowseLoom only calls the read-only bookmark-tree API. It does not create, edit, move, or delete bookmarks in the browser. Imported copies are written to the extension's local `bookmarkLibrary`; no bookmark data is transmitted to a server.

The extension requests only the permissions needed for its stated tab-dashboard and local bookmark workspace purpose.

## Data Retention and Deletion

Data stored by BrowseLoom remains on the user's device until the user removes it.

Users can delete stored data by:

- removing the extension from the browser
- clearing extension site data / browser storage
- removing saved-for-later items inside the extension UI; removal physically deletes the item from extension storage
- deleting custom bookmarks or folders inside the bookmark workspace

Users can revoke the optional browser bookmark permission from the bookmark settings panel after importing.

## Children

BrowseLoom is a general productivity tool and is not directed at children.

## Changes

If this privacy policy changes, the updated version will be published in this repository.

## Contact

For support or privacy questions, use the GitHub repository:

https://github.com/flySnail-jinx/browse-loom

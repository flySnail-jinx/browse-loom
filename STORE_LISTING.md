# Chrome Web Store Listing Draft

Use this document as copy-and-paste source material for the Chrome Web Store Developer Dashboard.

## Basic Information

**Name**

```text
BrowseLoom
```

**Short description**

```text
A local-first workspace for tabs, bookmarks, saved sessions, and later-reading items.
```

**Category**

```text
Productivity
```

**Language**

```text
English
```

The package includes English and Simplified Chinese extension metadata. Create matching localized store listings in the Developer Dashboard.

## Detailed Description

```text
BrowseLoom replaces your new tab page with a local dashboard for open browser tabs.

It helps you understand what is open, find the right tab faster, clean up duplicates, and close groups of tabs without accidentally touching pinned tabs.

Highlights:
- Group tabs by domain or by Chrome's native Tab Groups
- Filter tabs instantly with the / shortcut
- Hide tab details with privacy mode before screen sharing
- Protect pinned tabs from bulk-close and duplicate-cleanup actions
- Detect duplicate pages and close extras while keeping one copy
- Save tabs for later in a local checklist
- Organize plugin-local bookmarks and optionally import a read-only copy of browser bookmarks
- Save the current window by default or explicitly save all windows
- Restore a saved session into the current window or recreate its window structure
- Switch between English and Simplified Chinese
- Choose from 14 built-in visual themes
- Refresh automatically when tabs open, close, or navigate
- Store preferences and saved tabs locally

Privacy:
BrowseLoom does not require an account, does not use analytics, does not sell data, and does not upload your tab list to a server. Saved tabs and preferences stay on your device. The extension may request favicons from DuckDuckGo's icon service and cache them locally for up to 7 days; users can disable external favicon requests in privacy settings.

Attribution:
BrowseLoom is distributed under the Apache License 2.0. It is a derivative work based on Super Tab Out by Sivan, which is licensed under Apache-2.0. Super Tab Out includes modified portions of Tab Out by Zara Zhang, which is licensed under the MIT License. Required upstream notices are preserved in this project's NOTICE file. This project is not affiliated with Google, Chrome, Microsoft Edge, Brave, DuckDuckGo, or the upstream authors.
```

## Single Purpose Statement

Use this in the Privacy tab if prompted.

```text
BrowseLoom replaces the new tab page with a local workspace for organizing open tabs, saved sessions, later-reading items, and user-managed browser links.
```

## Permission Justifications

Use these explanations in the Privacy / Permissions sections if requested.

| Permission | Justification |
| --- | --- |
| `tabs` | Required to read open tabs, display tab titles and URLs, focus selected tabs, close tabs, and create tab groups from the dashboard. |
| `storage` | Required to store saved-for-later tabs, saved sessions, local stats, privacy settings, language, theme, and view preferences locally. |
| `tabGroups` | Required to read, create, update, collapse, and ungroup Chrome Tab Groups. |
| `sidePanel` | Required to provide the optional side panel tab center while the user stays on the current webpage. |
| `sessions` | Required to show and restore recently closed browser tabs/windows. |
| `bookmarks` (optional) | Requested only when the user starts import, to read the current browser bookmark tree and copy supported links into BrowseLoom's local bookmark workspace. The browser's bookmarks are never changed. |

## Privacy Practices Answers

Suggested factual answers based on the current implementation:

- The extension does not sell user data.
- The extension does not use user data for advertising.
- The extension does not transfer tab lists to a backend server.
- The extension does not collect analytics or telemetry.
- The extension stores saved tabs and preferences locally using browser storage.
- The extension stores saved sessions, lightweight stats, and achievement flags locally using browser storage.
- The extension uses tab titles and URLs only to render and manage the local dashboard.
- The extension uses `chrome.sessions` only to show and restore recently closed tabs/windows.
- The extension requests favicons from `icons.duckduckgo.com` only when external favicons are enabled, and caches them locally.

## Support / Homepage URLs

**Homepage URL**

```text
https://github.com/flySnail-jinx/browse-loom
```

**Support URL**

```text
https://github.com/flySnail-jinx/browse-loom/issues
```

**Privacy policy URL**

After pushing `PRIVACY.md` to GitHub, use the public file URL:

```text
https://github.com/flySnail-jinx/browse-loom/blob/main/PRIVACY.md
```

## Screenshot Checklist

Chrome Web Store screenshots should show the extension's actual UI. Recommended set:

1. **Main dashboard in domain view**
   - Upload: `store-assets/browseloom-1-tabs.jpg`
   - Show several domain cards.
   - Include the tab filter control and theme/language controls.
   - Demonstrates the primary new-tab value.

2. **Bookmark workspace**
   - Upload: `store-assets/browseloom-2-bookmarks.jpg`
   - Show categories, flexible folder boards, recent bookmarks, and popular bookmarks.
   - Demonstrates the plugin-local bookmark workflow.

3. **Chrome Tab Groups view**
   - Upload: `store-assets/browseloom-3-groups.jpg`
   - Create at least one Chrome Tab Group before taking the screenshot.
   - Show the Groups / Domains toggle.
   - Demonstrates native group support.

4. **Privacy mode**
   - Upload: `store-assets/browseloom-4-privacy.jpg`
   - Show the clock privacy screen.
   - Keep the UI free of private tab titles.
   - Demonstrates screen-sharing safety.

5. **Appearance settings**
   - Upload: `store-assets/browseloom-5-settings.jpg`
   - Show language, theme, background, and type controls.
   - Demonstrates customization and bilingual support.

6. **Saved for later**
   - Save one or two tabs.
   - Show the right-side saved checklist.
   - Demonstrates local workflow beyond closing tabs.

## Screenshot Preparation Tips

- Use a clean browser profile with non-sensitive tabs.
- Avoid showing personal email addresses, account names, private docs, or internal work tabs.
- Use demo pages such as:
  - `https://github.com/flySnail-jinx/browse-loom`
  - `https://example.com`
  - `https://developer.chrome.com/docs/extensions/`
  - `https://news.ycombinator.com`
  - `https://www.wikipedia.org`
- Pin one tab to demonstrate pinned-tab protection if useful.
- Use the same theme across most screenshots for visual consistency, then use the theme picker screenshot to show variety.

## Generated Local Assets

These files are generated in this repository and can be uploaded directly:

| Store field | Local file |
| --- | --- |
| Store icon, 128x128 | `extension/icons/icon128.png` |
| Screenshot 1 | `store-assets/browseloom-1-tabs.jpg` |
| Screenshot 2 | `store-assets/browseloom-2-bookmarks.jpg` |
| Screenshot 3 | `store-assets/browseloom-3-groups.jpg` |
| Screenshot 4 | `store-assets/browseloom-4-privacy.jpg` |
| Screenshot 5 | `store-assets/browseloom-5-settings.jpg` |
| Small promo tile, 440x280 | `store-assets/promo-small-440x280.jpg` |

## Release Package Checklist

Before uploading:

- `manifest.json` is at the root of the ZIP.
- Run `npm run validate`; it rebuilds both artifacts and verifies every packaged file against the current source.
- The ZIP contains `app.js`, `background.js`, `index.html`, `style.css`, `theme-init.js`, `sidepanel.html`, `sidepanel.css`, `sidepanel.js`, the declared `services/`, locales, backgrounds, vendor Three.js files, notices, and icons.
- The ZIP does not contain `.git`, `.omx`, `.DS_Store`, `__MACOSX`, or personal `config.local.js`.
- The version in `manifest.json` is correct for this release.
- The extension was loaded locally and smoke-tested after packaging.

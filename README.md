<div align="center">

<img src="./brand/browseloom-mark.png" alt="BrowseLoom logo" width="112">

<h1>BrowseLoom</h1>

<hr />

<h3>The Local-First New Tab Dashboard for Chrome</h3>

<p>
  <img alt="version v1.1.0" src="https://img.shields.io/badge/version-v1.1.0-2388d9?labelColor=555555">
  <img alt="platform Chrome" src="https://img.shields.io/badge/platform-Chrome-9a9a9a?labelColor=555555">
  <img alt="built with MV3 and Vanilla JS" src="https://img.shields.io/badge/built%20with-MV3%20%2B%20Vanilla%20JS-ff7a3d?labelColor=555555">
  <img alt="license Apache 2.0" src="https://img.shields.io/badge/license-Apache--2.0-35c52a?labelColor=555555">
</p>

<p>
  English | <a href="./README.zh-CN.md">中文</a> | <a href="./CHANGELOG.md">Changelog</a>
</p>

</div>

**A calm, local-first browser workspace for Chrome.**

BrowseLoom brings open tabs, Chrome Tab Groups, local bookmarks, saved sessions, and later-reading items into one visual workspace. It replaces the default new tab page, adds an optional side panel, protects pinned tabs, and keeps browsing data on your device.

No server. No account. No telemetry. No build step. Load the `extension/` folder and use it.

Chrome 116 or newer is required. Edge and Brave may work when they provide the same Manifest V3 capabilities, but they are not release commitments.

Release notes are tracked in [`CHANGELOG.md`](./CHANGELOG.md).

---

## Highlights

- **Text-first command desk**: a quieter new-tab layout with clear hierarchy, compact controls, and no decorative brand icon in the page header.
- **Independent bookmark desk**: press the left arrow to open a plugin-local bookmark workspace. Home is the built-in default category, with custom icon categories, notes, search, icon/list views, and usage-based recent/popular columns.
- **One-click browser bookmark import**: open the gear in the bookmark desk to copy bookmarks from the current Chrome or Edge profile. Permission is requested only when import starts, deep folders are flattened without renaming, and repeated imports add only new browser bookmarks.
- **Flexible folder boards**: every category supports 1×1, 2×1, and 2×2 folders. Bookmarks can move in, out, or across categories by drag-and-drop or the Move menu, while deleting a folder or category preserves its bookmarks.
- **Two ways to organize tabs**: switch between domain grouping and Chrome's native Tab Groups.
- **Fast tab filtering**: press `/` and filter cards, chips, URLs, and group names in real time.
- **Search operators**: narrow results with `domain:`, `group:`, `url:`, and `saved:`; fuzzy matches are highlighted.
- **Side Panel tab center**: search, jump, save, close, dedupe, restore recently closed tabs, and save the current or all windows without leaving the current page.
- **Keyboard and omnibox entry points**: use `loom` in the address bar for search/actions, or commands for panel/session/privacy workflows.
- **Accessibility and motion controls**: icon buttons have accessible labels, chips support keyboard activation, and system reduced-motion preferences are respected.
- **Privacy mode for screen sharing**: click the lock or press `Esc` to hide the tab dashboard behind a clean clock screen.
- **Pinned tabs are protected**: pinned tabs are excluded from cards, counts, duplicate cleanup, and bulk-close actions.
- **One-click duplicate cleanup**: repeated URLs are marked and can be cleaned while keeping one copy.
- **Save for later**: stash a tab into a local checklist before closing it.
- **Auto-refresh**: tab open, close, navigation, and group changes refresh the dashboard automatically.
- **Bilingual UI**: switch between English and Simplified Chinese from Settings.
- **More themes, easier switching**: choose from 14 built-in palettes in the lightweight Settings panel.
- **Switchable local backgrounds**: choose Liquid Glow, Light Rays, Prism, or a static low-power background. Only the selected renderer runs, and the preference stays on this device.
- **Local-first privacy posture**: settings and saved tabs stay on your machine.

---

## Screens and Controls

![BrowseLoom tab workspace](./store-assets/browseloom-1-tabs.jpg)

The tab workspace groups open pages into scannable cards while keeping saved-for-later items and sessions close at hand. These screenshots were captured from the current extension with a clean profile and public demo pages.

The top-right controls are intentionally compact:

- **Lock**: toggles privacy mode.
- **Settings**: opens language, theme, background, type, and privacy-screen options.

Available themes:

| Theme | Tone |
| --- | --- |
| Adaptive Glow | Follows Chrome/Edge light or dark appearance |
| Ivory Page | Minimal white workspace |
| Material Orbit | Clean Material-inspired color system |
| Cupertino Mist | Soft Apple-style glass and mist |
| Warm Parchment | Soft editorial paper |
| Midnight Voyage | Dark, quiet workspace |
| Frost Field | Crisp blue-white |
| Forest Isle | Muted green and earth |
| Graphite Gold | Dark graphite with gold accents |
| Coral Tide | Coastal teal with coral |
| Plum Shade | Low-saturation plum |
| Matcha Haze | Calm green reading mode |
| Ember Slate | Dark slate with warm energy |
| Lavender Breeze | Light lavender with mint |

Current product screens:

| Bookmark Workspace | Chrome Groups |
| --- | --- |
| ![BrowseLoom bookmark workspace](./store-assets/browseloom-2-bookmarks.jpg) | ![Chrome Tab Groups view](./store-assets/browseloom-3-groups.jpg) |

| Privacy Mode | Appearance Settings |
| --- | --- |
| ![Privacy mode](./store-assets/browseloom-4-privacy.jpg) | ![Appearance settings](./store-assets/browseloom-5-settings.jpg) |

---

## Install

1. Clone the repo:

```bash
git clone https://github.com/flySnail-jinx/browse-loom.git
cd browse-loom
```

2. Open your browser extension page:

```text
chrome://extensions
edge://extensions
brave://extensions
```

3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the `extension/` folder in this repo.
6. Open a new tab.

To update later, pull the latest code and click **Reload** on the extension page:

```bash
git pull
```

---

## Debugging

For normal manual testing, use Chrome and load the `extension/` folder from `chrome://extensions`.

For automated extension testing, use **Chrome for Testing** instead of the regular branded Chrome app. Recent branded Chrome builds can block command-line unpacked-extension loading, while Chrome for Testing keeps that workflow available for automation.

This workspace can keep a local browser binary at:

```text
tools/chrome-for-testing/
```

That directory is intentionally ignored by Git because it is large and only needed for local debugging. It is not included in the Chrome Web Store / Edge Add-ons zip packages.

Launch the latest local extension build:

```bash
npm run dev:host
```

By default the script also prepares a repeatable manual regression scenario on every launch: pinned homepages, duplicate URLs, native Chrome Tab Groups, a collapsed group, mixed ungrouped tabs, a recently closed tab, saved-for-later items, saved sessions, activity metrics, and achievements. It cleans previously seeded tabs before recreating the scenario, so repeated `npm run dev:host` runs do not stack duplicate seed tabs.

Use `scripts/launch-chrome-testing.sh --no-seed-tabs` for a clean browser, or `--reset-profile` for a fresh profile before seeding.

Optional overrides: `CHROME_BIN`, `PROFILE_DIR`, `REMOTE_DEBUGGING_PORT`, `SEED_TABS`, `SEED_DELAY_MS`, `SEED_CLEANUP`, and `SEED_REQUIRED`.

## Validation

No build step is required, but the repo includes lightweight local checks for extension changes:

```bash
npm test
npm run validate
```

`npm run validate` rebuilds both store ZIPs, then checks `manifest.json`, script syntax, service loading order, the exact ZIP allowlist, and each packaged file's SHA-256 content against the current source.

---

## Keyboard Shortcuts

| Key | Action |
| --- | --- |
| `/` | Focus the open-tabs filter field |
| `Esc` while the filter is focused | Clear and blur the filter |
| `Esc` elsewhere | Toggle privacy mode |
| `Ctrl/Cmd + Shift + G` | Toggle Groups / Domains view |
| `Ctrl/Cmd + Shift + Y` | Open the Side Panel |
| `Ctrl + Shift + D` | Bookmark the current page in a prefilled editor |
| `Ctrl + Shift + Z` | Switch between BrowseLoom and the tab you opened from it |

Omnibox keyword: type `loom` then a query or action such as `panel`, `save-session`, `dedupe`, or `privacy`.

---

## Feature Details

### Tab Dashboard

BrowseLoom reads your open tabs with `chrome.tabs.query({})`, filters out browser-internal pages, and renders useful cards:

- domain cards for normal browsing
- a Homepages card for landing pages like Gmail, X, YouTube, LinkedIn, and GitHub
- optional Chrome Tab Groups view
- duplicate badges for repeated URLs
- localhost labels with port numbers
- `Ctrl + Shift + Z` quick return between the dashboard and the tab opened from it; only tab/window IDs are kept in memory for the browser session

### Search

The search pill uses one local index for open tabs, Chrome group titles, saved-for-later items, and saved sessions. Supported filters:

| Filter | Example |
| --- | --- |
| `domain:` | `domain:github auth` |
| `group:` | `group:work api` |
| `url:` | `url:docs extensions` |
| `saved:` | `saved:true article` or `saved:false github` |

### Side Panel

The Side Panel keeps BrowseLoom available while you stay on the current page:

- search open tabs, saved-for-later items, and saved sessions
- open from `Ctrl/Cmd + Shift + Y` or omnibox actions such as `loom panel`
- jump to a tab, save it for later, or close it
- clean duplicates while keeping one copy
- restore browser-level recently closed tabs/windows via `chrome.sessions`
- save the current window by default, or explicitly save all windows
- view Tab Health, weekly stats, top domains, and achievements

### Chrome Tab Groups

Domain cards can create native Chrome Tab Groups. Group cards can be renamed, recolored, collapsed/expanded, ungrouped, or saved as a session. Pinned tabs are never saved. Sessions preserve window structure without storing Chrome window IDs; restore defaults to the current window, with an explicit option to recreate the saved windows.

### Closing Behavior

The extension uses exact URL matching for close actions. This keeps bulk actions scoped to the tabs shown in the card and avoids closing unrelated pages on the same host.

Pinned tabs are skipped by every bulk-close and duplicate-cleanup action.

### Save for Later

The bookmark button saves a tab into `chrome.storage.local` before closing it. Saved items stay local and can be checked off into the archive.

### Privacy Mode

Privacy mode hides the tab dashboard and shows a minimal clock/date screen. It is useful before screen sharing or recording. You can customize whether the privacy screen shows:

- clock
- date
- custom text
- external favicon requests

### Themes and Language

Theme choice is stored in `localStorage` and applied before the page paints, so the selected theme does not flash back to the default on reload.

Language choice is also stored locally and applied early. The switch affects fixed UI labels only; tab titles, URLs, Chrome group names, and user-entered text are not translated or modified.

---

## Privacy

BrowseLoom is local-first.

Stored locally:

- saved-for-later tabs
- saved sessions
- lightweight activity stats and achievements
- privacy mode state and settings
- view mode
- language choice
- theme choice
- favicon cache

External favicon requests can be disabled from privacy settings. When disabled, cached favicons can still render, but new domains will not call the icon service.

The only routine external request, when enabled, is:

- `icons.duckduckgo.com` for favicons, cached locally for 7 days

No Google Fonts are used. Fonts come from system font stacks.

Privacy mode does not provide a web search box or change the browser search provider.

Store upload packages are generated locally into `dist/` with `npm run package`. The Chrome package is the supported release artifact; the Edge package is a capability-compatible convenience artifact. ZIP files are ignored by Git and must not be committed.

---

## Permissions

The extension currently requests:

| Permission | Why it is needed |
| --- | --- |
| `tabs` | Read, focus, close, and group open tabs |
| `storage` | Persist saved tabs, sessions, stats, privacy settings, and view mode |
| `tabGroups` | Read, render, create, update, collapse, and ungroup Chrome Tab Groups |
| `sidePanel` | Show the Side Panel tab center |
| `sessions` | Show and restore recently closed browser tabs/windows |
| `bookmarks` (optional) | Read the current browser bookmark tree only after the user starts an import; BrowseLoom never changes the browser copy |

---

## Tech Stack

| Area | Implementation |
| --- | --- |
| Extension platform | Chrome Manifest V3 |
| UI | Plain HTML, CSS, JavaScript |
| Storage | `chrome.storage.local` and `localStorage` |
| Sound | Web Audio API |
| Animations | CSS transitions and JavaScript particles |
| Build | None |

Everything runs locally in the extension. The background service worker owns browser-level entry points such as toolbar bookmark capture, badge count, commands, omnibox actions, side panel, and lightweight session actions.

---

## Attribution and License

BrowseLoom is licensed under the Apache License, Version 2.0.

This project is a derivative work based on **[Super Tab Out](https://github.com/SivanCola/super-tab-out)** by **Sivan**, licensed under Apache-2.0. Super Tab Out includes modified portions of **[Tab Out](https://github.com/zarazhangrui/tab-out)** by **Zara Zhang**, licensed under the MIT License.

The Apache-2.0 license text is in [`LICENSE`](./LICENSE). Required upstream MIT copyright and permission notices are preserved in [`NOTICE`](./NOTICE). Please do not remove those notices from substantial copies or distributions.

This fork adds security hardening, Manifest V3 updates, cross-browser new-tab handling, pinned-tab protection, Chrome Tab Groups view, bilingual UI, expanded theme support, privacy mode, tab filtering, favicon caching, and local-first saved-tab workflows.

This project is not affiliated with Google, Chrome, Microsoft Edge, Brave, DuckDuckGo, or the upstream authors. Product names and service names are used only to describe compatibility or attribution.

Apache-2.0. See [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).

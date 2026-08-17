# Changelog

English · [简体中文](./CHANGELOG.zh-CN.md)

All notable changes to BrowseLoom are tracked here.

## 1.1.0 - 2026-08-17

### Added

- Added a new woven BrowseLoom logo and regenerated the 16 px, 48 px, and 128 px extension icons.
- Added a maintainable background switcher in Appearance settings with Liquid Glow, React Bits-inspired Light Rays and Prism, plus a static low-power option. Backgrounds are registered independently, persisted locally, and clean up their canvas, animation loop, observers, listeners, and WebGL context when switched.
- Added an independent, plugin-local bookmark workspace reached with the left arrow. Home is the built-in default category, with icon categories in the left rail, icon/list views, notes, search, recently opened and most-opened columns.
- Added a bottom-left bookmark settings gear with one-click import from the current Chrome or Edge profile. The optional permission is requested only on import; deeper native folders are flattened without renaming, repeated imports are idempotent, and unsupported non-HTTP(S) entries are reported without being stored.
- Added custom bookmark and folder creation, online or solid-color icons, 1×1 / 2×1 / 2×2 folder boards, wheel/button paging, full-folder expansion, cross-category movement, drag-in/drag-out, reorder, safe delete, and undo flows.
- Changed the toolbar action to capture the current page and added `Ctrl + Shift + D`; an ephemeral session draft prefills the bookmark editor with the title, URL, Unfiled category, category root, and online icon.
- Added `Ctrl + Shift + Z` quick return navigation between BrowseLoom and the tab opened from its dashboard. The route stores tab/window IDs in memory-only session storage and does not capture page content.

### Changed

- Rebranded the product from Super Tab Out to BrowseLoom, moved the project to `flySnail-jinx/browse-loom`, renamed release archives to `browse-loom-*`, and changed the omnibox keyword from `sto` to `loom`.
- Scoped the product and store package to tab, session, later-reading, and local bookmark workflows; removed the unrelated general-purpose tools workbench and dock.
- Saved sessions now use an explicit `windows[]` structure, exclude pinned tabs, default to the current window, and offer explicit all-window save and window-structure restore actions.
- Set the minimum supported Chrome version to 116. Edge and Brave remain capability-compatible targets without a release commitment.
- Unified package and validation file lists. Validation now rebuilds artifacts and compares every ZIP entry against current source content.

### Removed

- Removed temporary bookmark/glass prototypes and the temporary bookmark acceptance server from the working tree after acceptance.

### Fixed

- Saved-for-later removal now physically deletes the item and offers a short in-memory undo action.
- Storage mutations now coordinate across extension pages and the service worker with a same-origin Web Lock, preventing lost bookmark updates.
- Older code now fails closed on a newer storage schema and cannot overwrite forward-version data.
- Recognized browser-reported new-tab URLs such as `chrome://newtab/` as the BrowseLoom dashboard so quick return routes are recorded correctly.
- Replaced the accepted-but-unreliable `Ctrl + Shift + Space` default with `Ctrl + Shift + Z` after live Chrome verification showed that the Space combination was not dispatched to the extension.

## 1.0.9 - 2026-05-20

### Changed

- Bumped the extension and package metadata to `1.0.9` and regenerated local Chrome/Edge store upload packages.
- Updated README release notes for the toolbar Tools entry, lightweight Settings panel, and the current 14-theme set.

### Fixed

- Kept the Settings panel inside the viewport on narrow screens and made Escape blur focused settings/search inputs before closing panels.
- Centralized restorable URL validation so saved tabs, saved sessions, restores, and stored URL opens only allow `http:`, `https:`, and `file:` URLs.

## 1.0.8 - 2026-05-16

### Changed

- Bumped the extension and package metadata to `1.0.8` for the next Chrome/Edge store upload.

## 1.0.7 - 2026-05-14

### Changed

- Bumped the extension and package metadata to `1.0.7` and regenerated local Chrome/Edge store upload packages.
- Stopped tracking generated store ZIP packages in Git; `dist/*.zip` remains local-only.

### Fixed

- Moved the command dock out of the animated footer so its fixed positioning remains anchored to the viewport instead of the footer.
- Avoided external favicon requests for local addresses and removed anonymous CORS mode from favicon images so localhost tabs do not create console errors.

## 1.0.5 - 2026-05-14

### Changed

- Bumped the extension and package metadata to `1.0.5` and regenerated the Chrome/Edge store upload packages.

## 1.0.4 - 2026-05-14

### Fixed

- Restored `app.js` to the Chrome/Edge release package whitelist so the new-tab dashboard boots, reads open tabs, and renders the command dock correctly in store builds.
- Added `app.js` to ZIP artifact validation so packaging cannot pass while omitting the runtime entry script.

## 1.0.3 - 2026-05-12

### Changed

- Replaced the limited local QR encoder with a vendored MIT QR generator that supports standard QR versions locally.
- Added whitelist Chrome/Edge packaging and removed source-only assets and unreachable Side Panel code from release packages.
- Bumped the extension and package metadata to `1.0.3`, with regenerated Chrome/Edge store packages.

## 1.0.2 - 2026-04-30

### Added

- Added schema-aware storage, tabs, search, actions, and metrics services as the first architecture split for the v1.1 foundation.
- Added storage migration for `chrome.storage.local`, quota/error toast handling, and lightweight Node unit tests.
- Added an extension validator for manifest checks, script syntax, service loading order, and store ZIP hygiene.
- Added unified search indexing for open tabs, Chrome group titles, saved-for-later items, and saved sessions.
- Added fuzzy search, match highlighting, and `domain:` / `group:` / `url:` / `saved:` filter syntax.
- Added manifest commands, `sto` omnibox actions, and the optional Side Panel command center.
- Added Side Panel search, jump, save-for-later, close, duplicate cleanup, recent-closed restore, and session save flows.
- Added Chrome Tab Groups actions for creating native groups from domain cards, renaming, recoloring, collapsing/expanding, ungrouping, saving sessions, and restoring saved sessions back into Chrome tab groups from the dashboard.
- Added Tab Health, weekly stats, top domains, achievements, and Side Panel tools for JSON, QR-style encoding, and timestamps.
- Added a FeHelper-inspired local tools registry, compact Command Center tool directory, three-column Tools workbench, tool favorites/recent history, current-tab shortcuts, structured previews, real local QR SVGs, and session export.
- Added icon-button `aria-label`s, keyboard activation for tab chips, visible focus states, `prefers-reduced-motion` support, and an external favicon privacy toggle.

### Changed

- Routed saved-for-later, view mode, privacy settings, tab closing, duplicate cleanup, and open-tab search through shared services.
- Extended the new-tab search pill so it filters both tab cards and saved-for-later/archive entries.
- Updated permissions and privacy documentation for `sidePanel` and `sessions`.
- Updated privacy documentation for the external favicon toggle.
- Updated README screenshot galleries and store screenshots for the current Command Center and Tools UI.
- Bumped the extension, package metadata, validator package targets, and generated Chrome/Edge store packages to `1.0.2`.

## 1.0.1 - 2026-04-22

### Changed

- Bumped the extension manifest version to `1.0.1` for the next store upload.
- Renamed generated Chrome and Edge store packages to `super-tab-out-chrome-1.0.1.zip` and `super-tab-out-edge-1.0.1.zip`.
- Updated English and Simplified Chinese documentation to point to the new package filenames.
- Fixed the theme picker layer so the full palette opens above the tab dashboard.

## 1.0.0 - 2026-04-21

### Added

- Added a Huashu-inspired visual refresh for the new-tab dashboard, with a quieter command-desk layout, tighter information hierarchy, and more polished card surfaces.
- Added text-first page header branding that keeps the product name, greeting, and date visible without showing an extra decorative app icon inside the page.
- Added clearer top-right controls for privacy mode, language switching, and theme selection.
- Added store-ready Chrome and Edge packages in `dist/`.

### Changed

- Refined tab cards, section headers, filter controls, badges, action buttons, and responsive mobile layout.
- Kept the browser extension icon available through the browser UI and package manifest, while removing the in-page header icon.
- Kept the privacy screen free of web search UI to avoid changing the user's search experience.

### Verified

- Validated `manifest.json` as JSON.
- Checked `app.js`, `background.js`, and `theme-init.js` syntax with Node.
- Ran `git diff --check`.
- Loaded the unpacked extension in Chrome for Testing and verified the new page header, viewport fit, and absence of the removed icon.
- Checked generated zip contents to exclude local debug folders and macOS metadata.

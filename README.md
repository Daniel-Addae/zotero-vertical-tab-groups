# Vertical Tab Groups for Zotero

A Zotero 8/9 plugin that turns Zotero's horizontal tab bar into a vertical
sidebar with Microsoft Edge-style tab groups, and keeps your collections
(folders) pinned on the left so they stay visible while you read.

Layout, left to right: **folders | vertical PDF tabs | content (items or reader)**.

## Features

- Vertical list of all open PDF tabs on the left, always visible
- Folders/collections pinned beside the tabs, visible even while a reader is open
- Edge-style tab groups: named, colour-coded, collapsible
- Right-click a tab to add it to a group, start a new group, or remove it
- Right-click a group to rename, recolour, or delete it
- Drag a tab onto a group to move it
- Collapse the whole panel to a slim rail and back
- Click a folder to jump straight to its item list (single click)
- Groups and assignments persist across restarts (stored in Zotero prefs)

## Requirements

- Zotero 8 or 9 (built and tested on Zotero 9.0.x)

## Install

1. Download `vertical-tab-groups.xpi` (from this repo or the Releases page).
2. In Zotero: Tools → Plugins → gear icon → Install Plugin From File.
3. Pick the `.xpi`, then restart Zotero.

## Usage

- Open PDFs as usual; each appears as a row in the left panel.
- Click `+ Group` to make a group. Right-click a tab → choose the group.
- Right-click a group header to rename, recolour (swatches), or delete it.
- Click `«` to collapse the panel to a rail; click the rail to bring it back.

## Build from source

The plugin is plain JS/CSS, no build step required. To package an `.xpi`,
zip the files at the repository root (manifest.json must be at the archive root):

```bash
zip -r vertical-tab-groups.xpi manifest.json bootstrap.js vtabs.js style.css
```

## How it works

Zotero has no public API for the main tab bar, so the plugin hides the native
tabs, watches them with a MutationObserver, and renders its own vertical panel
from `Zotero_Tabs._tabs` using the public `select`/`close` calls. The folders
pane (`#zotero-collections-pane`) is lifted into the always-visible container
that holds `#tabs-deck` so it stays on screen with a reader open; clicking a
folder selects the library tab so its items show.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)

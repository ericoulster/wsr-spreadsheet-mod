# WSR Spreadsheet Export (in-game mod)

A Wall $treet Raider mod that adds two floating **Export to Excel** buttons in-game. Click one and
it produces your balance sheets + cash flow statements as an `.xlsx` workbook - read live from the
game, no external tool. It is read-only: it never changes your game.

- **Export This** - the entity you're currently viewing (you, or a company), as a readable financial
  statement: balance sheet, cash flow, and the itemized 3-month cash-flow projection. Instant.
- **Export Portfolio** - you plus everything you own (any stake), as a single **tidy data table**:
  one row per entity with every field the game exposes per entity (wide; blank = not applicable),
  plus a `holdings` sheet (one row per position - stocks **and** bonds). It flips the view through
  each entity to read it, and encodes the in-game date and save-file name. Built for pandas/analysis.

Export This statements use the game's own industry-specific `Total Liabilities` formula, so the
numbers match the Financials screen, with an `Assets - Liabilities - Equity` check row.

This is the in-game counterpart to the standalone CLI
([wsr-spreadsheet-generator](https://github.com/ericoulster/wsr-spreadsheet-generator)).

## Where the file goes (mode-aware)

The game can run embedded (desktop/Electron) or in "play in your browser" mode. The mod handles both:

- **Desktop / Electron** (Node available): written to **`~/Documents/WSR Statements/`** as
  `wsr_financials_<YYYY>-<MM>...xlsx`.
- **Browser mode** (no Node): **downloaded** through the browser (check your Downloads folder).

## How it works (mod mechanics)

WSR mods are a renderer **file-overlay**: files under `overlay/` shadow/extend the game's
`resources/app/`. This mod ships:
- `overlay/index.html` - the game's `index.html` plus one `<script>` line that loads the mod.
- `overlay/js/wsr-export/main.js` - injects the two buttons, reads the live game store
  (`api.gameStore`), and saves the file (Node `fs` on desktop, or a Blob download in the browser).
- `overlay/js/wsr-export/exporter.js` - builds the statements + the `.xlsx` (mirrors the in-game
  Financials tab field-for-field).
- `overlay/js/lib/xlsx.mjs` - bundled [SheetJS](https://sheetjs.com).

Nothing touches the C++ game engine; the export is pure client-side.

## Install

### Players on Windows - Steam Workshop
Subscribe to the published item (publish `overlay/` with the in-game Mod Uploader). The loader builds
the overlay from your subscription on launch and the buttons appear.

### Linux / Proton (and any setup where the Steam API doesn't load) - direct install
On Linux/Proton the embedded Steam API frequently fails to load, so the Workshop loader sees "zero
installed mods" and **wipes the overlay on every launch** - the overlay path won't stick. Install
directly into the game files instead (the loader never touches `resources/app/`):

```
./deploy.sh --install      # copies the mod into resources/app/ (backs up index.html)
./deploy.sh --uninstall    # restores the original index.html and removes the mod
```

Then launch the game normally (online is fine). Reverted by `--uninstall`, a game update, or Steam ->
Properties -> Installed Files -> **Verify integrity**. Never hand-edit `resources/app/` yourself - let
`--install` manage it, since Verify wipes manual edits.

> The plain `./deploy.sh` (overlay) mode exists for Workshop-style dev on Windows; under Proton it
> gets wiped, so use `--install` there.

### Headless test of the export logic

`exporter.js` is pure (no DOM/store/fs), so its statement-building + both workbook serializations
(desktop buffer and browser array) are tested in Node against a captured gamestate and known-good
numbers:

```
npm test            # node test/test_exporter.mjs
```

(The repo-root `package.json` exists only for this Node test; it is not part of the shipped
`overlay/`.)

## Notes / limitations

- The free SheetJS build writes values but not cell styling (no bold/colors); the data is plain.
- "Export Portfolio" settles ~350ms per company after switching the view to let the financials
  broadcast arrive; if a company sheet ever looks stale, raise `SETTLE_MS` in `main.js`.
- The spreadsheet lists every line item for an entity's industry (including zeros the on-screen view
  hides for space), so columns stay consistent across entities.
- After a game update, re-run `./deploy.sh --install` (an update restores stock files).

## License

[MIT](LICENSE) for this mod's code - use, copy, modify, and redistribute freely with attribution.
The bundled `overlay/js/lib/xlsx.mjs` is [SheetJS](https://sheetjs.com) (community build) under its
own Apache-2.0 license; its copyright header is retained in the file.

A fan-made, unofficial utility - not affiliated with or endorsed by the makers of Wall $treet Raider.

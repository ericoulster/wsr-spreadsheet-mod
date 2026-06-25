# WSR Spreadsheet Export (in-game mod)

A Wall $treet Raider mod that adds two floating **Export to Excel** buttons in-game. Click one and
it writes your balance sheets + cash flow statements to an `.xlsx` workbook - read live from the
game, no external tool. It is read-only: it never changes your game.

- **Export This** - exports the entity you're currently viewing (you, or a company). Instant.
- **Export Portfolio** - exports you plus every company you control. The game has no silent read of
  other entities, so this briefly flips the view through each controlled company and restores yours.

Output goes to **`~/Documents/WSR Statements/`** as `wsr_financials_<YYYY>-<MM>...xlsx` (one file per
game-month). Each workbook has a Summary sheet plus one sheet per entity; company balance sheets use
the game's own industry-specific `Total Liabilities` formula, so the numbers match the Financials
screen, with an `Assets - Liabilities - Equity` check row.

This is the in-game counterpart to the standalone CLI
([wsr-spreadsheet-generator](https://github.com/ericoulster/wsr-spreadsheet-generator)).

## How it works (mod mechanics)

WSR mods are a **renderer file-overlay**: files under `overlay/` shadow/extend the game's
`resources/app/`. This mod ships:
- `overlay/index.html` - the game's `index.html` plus one `<script>` line that loads the mod.
- `overlay/js/wsr-export/main.js` - injects the two buttons, reads the live game store
  (`api.gameStore`), and writes the file with Node's `fs` (the renderer has full Node).
- `overlay/js/wsr-export/exporter.js` - builds the statements + the `.xlsx` (mirrors the in-game
  Financials tab field-for-field).
- `overlay/js/lib/xlsx.mjs` - bundled [SheetJS](https://sheetjs.com) (writes the workbook).

Nothing touches the C++ game engine; the export is pure client-side.

## Install (players)

Subscribe on the Steam Workshop (publish `overlay/` with the in-game Mod Uploader). Once subscribed,
the buttons appear in-game.

## Develop / test locally (no Workshop)

```
./deploy.sh                 # copies overlay/ into the game's local overlay dir
```
Then launch the game in **Steam Offline Mode** and look for the buttons (bottom-right).

> Why Offline Mode: the loader **wipes the local overlay on launch if Steam reports zero installed
> Workshop mods**; it preserves a hand-made overlay only when the Workshop query fails (Steam
> offline). So iterate offline, or publish a private Workshop item and subscribe to it.

Never edit the game's `resources/app/` directly - Steam's "verify integrity" wipes it.

### Headless test of the export logic

`exporter.js` is pure (no DOM/store/fs), so its statement-building + workbook output are tested in
Node against a captured gamestate and known-good numbers:

```
npm test            # node test/test_exporter.mjs  -> writes out/test_export.xlsx
```

(The repo-root `package.json` exists only for this Node test; it is not part of the shipped
`overlay/`.)

## Notes / limitations

- The free SheetJS build writes values but not cell styling (no bold/colors); the data is plain.
- "Export Portfolio" settles ~350ms per company after switching the view to let the financials
  broadcast arrive (mirrors the CLI's settle); if a company sheet ever looks stale, raise `SETTLE_MS`
  in `main.js`.
- The spreadsheet lists every line item for an entity's industry (including zeros the on-screen view
  hides for space), so columns stay consistent across entities.

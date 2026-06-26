// main.js - WSR "Export to Excel" mod entry (loaded by an added <script> in index.html).
//
// Injects two floating buttons and wires them to exporter.js. It reads the same live game store
// the Financials tab uses (api.gameStore) and writes the workbook to disk with Node's fs - the
// renderer has full Node (nodeIntegration:true), as the game itself relies on (MainMenu.js).
//
// "Export This"      -> the entity currently in view (player or company), instant, no view change.
// "Export Portfolio" -> the player + every controlled company. The game has no silent read of
//                       another entity, so this briefly flips the view to each company (settling for
//                       the financials broadcast) and restores the original view at the end.

import * as api from '../api.js';
import {
    companyRows, playerRows, companySummary, playerSummary, buildWorkbook, workbookBuffer,
    workbookArray, monthStr,
} from './exporter.js';

const hasRequire = typeof require !== 'undefined';
const fs = hasRequire ? require('fs') : null;
const path = hasRequire ? require('path') : null;
const os = hasRequire ? require('os') : null;

const PLAYER_ID = 2;     // the human player's entity id (PLAYER1); matches the captures + CLI
const SETTLE_MS = 350;   // wait after setViewAsset for the financials broadcast (CLI used 300ms)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gstate = () => (api.gameStore.getState().gameState || {});
const isPlayerNum = (n) => n > 0 && n <= 10;
const outDir = () => path.join(os.homedir(), 'Documents', 'WSR Statements');

function requireGameLoaded(gs) {
    if (!gs || !gs.currentYear) throw new Error('No game loaded - load a save first.');
}

// One {sheet, rows, summary} descriptor from a store snapshot for the entity currently in view.
function entityFrom(gs) {
    const date = monthStr(gs);
    if (isPlayerNum(gs.activeEntityNum)) {
        const aep = gs.activeEntityPlayerFinancials || {};
        const name = gs.playerName || (gs.activeEntityData || {}).name || 'Player';
        return { sheet: 'PLAYER', rows: playerRows(aep, gs, name, date), summary: playerSummary(aep, gs, name) };
    }
    const aef = gs.activeEntityFinancials || {};
    const aed = gs.activeEntityData || {};
    const ind = gs.activeIndustryId ?? -1;
    const sym = aed.symbol || String(gs.activeEntityNum);
    return { sheet: sym, rows: companyRows(aef, aed, ind, date), summary: companySummary(aef, aed, ind) };
}

// Save the workbook. Desktop (Electron, Node available) -> write to ~/Documents/WSR Statements.
// Browser mode (no Node) -> trigger a browser download. Returns a user-facing status string.
function saveWorkbook(entities, baseName) {
    const wb = buildWorkbook(entities);
    const filename = `${baseName}.xlsx`;
    if (fs && path && os) {
        const dir = outDir();
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, filename);
        fs.writeFileSync(file, workbookBuffer(wb));
        return 'Saved: ' + file;
    }
    // Browser mode: build a Blob and click a temporary download link.
    const blob = new Blob([workbookArray(wb)],
        { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
    return 'Downloaded: ' + filename + ' (check your browser downloads)';
}

async function exportCurrent() {
    const gs = gstate();
    requireGameLoaded(gs);
    const ent = entityFrom(gs);
    const tag = isPlayerNum(gs.activeEntityNum) ? 'player' : ent.sheet;
    return saveWorkbook([ent], `wsr_financials_${monthStr(gs)}_${tag}`);
}

async function exportPortfolio() {
    const gs0 = gstate();
    requireGameLoaded(gs0);
    const original = gs0.activeEntityNum;
    const date = monthStr(gs0);
    const entities = [];

    // Player sheet (view the player so activeEntityPlayerFinancials is populated).
    await api.setViewAsset(PLAYER_ID); await sleep(SETTLE_MS);
    let gs = gstate();
    const aep = gs.activeEntityPlayerFinancials || {};
    const pname = gs.playerName || (gs.activeEntityData || {}).name || 'Player';
    entities.push({ sheet: 'PLAYER', rows: playerRows(aep, gs, pname, date), summary: playerSummary(aep, gs, pname) });

    // One sheet per controlled company (flip the view, settle, read).
    for (const c of (gs0.controlledCompanies || [])) {
        await api.setViewAsset(c.id); await sleep(SETTLE_MS);
        gs = gstate();
        const aef = gs.activeEntityFinancials || {};
        const aed = gs.activeEntityData || {};
        const ind = gs.activeIndustryId ?? -1;
        const sym = aed.symbol || c.name || String(c.id);
        entities.push({ sheet: sym, rows: companyRows(aef, aed, ind, date), summary: companySummary(aef, aed, ind) });
    }

    // Restore the user's original view.
    if (original != null) { await api.setViewAsset(original); await sleep(120); }
    return saveWorkbook(entities, `wsr_financials_${date}`);
}

// ---- UI ----

function toast(msg, isError) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = `position:fixed; right:14px; bottom:112px; z-index:100000; max-width:460px;
        padding:8px 12px; border-radius:6px; font-size:13px; color:#fff; white-space:pre-wrap;
        background:${isError ? '#9a3434' : '#244a66'}; box-shadow:0 2px 10px rgba(0,0,0,.45);`;
    document.body.appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .5s'; t.style.opacity = '0'; }, 5000);
    setTimeout(() => t.remove(), 5600);
}

function mkButton(label, handler) {
    const b = document.createElement('button');
    b.className = 'btn blue';
    b.textContent = label;
    b.style.cssText = 'padding:3px 10px; font-size:12px;';
    b.addEventListener('click', async () => {
        const old = b.textContent;
        b.disabled = true; b.textContent = 'Exporting...';
        try {
            const msg = await handler();
            toast(msg);
        } catch (e) {
            toast('Export failed: ' + (e && e.message ? e.message : String(e)), true);
            console.error('[wsr-export]', e);
        } finally {
            b.disabled = false; b.textContent = old;
        }
    });
    return b;
}

function injectButtons() {
    if (document.getElementById('wsr-export-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'wsr-export-bar';
    bar.style.cssText = `position:fixed; right:14px; bottom:64px; z-index:100000;
        display:none; gap:6px; align-items:center;`;
    bar.appendChild(mkButton('Export This', exportCurrent));
    bar.appendChild(mkButton('Export Portfolio', exportPortfolio));
    document.body.appendChild(bar);

    // Only show in-game: mirror the app's own gameLoaded flag (app.js renders GameUI vs MainMenu
    // on it), so the buttons stay hidden on the title/menu screen.
    let shown = null;
    const sync = () => {
        const loaded = !!(api.gameStore.getState().gameState || {}).gameLoaded;
        if (loaded !== shown) { shown = loaded; bar.style.display = loaded ? 'flex' : 'none'; }
    };
    sync();
    api.gameStore.subscribe(sync);
    console.log('[wsr-export] export buttons injected');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectButtons);
} else {
    injectButtons();
}

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

const PLAYER_ID = api.HUMAN1_ID ?? 2;  // human-player entity id (the game's exported constant); prefer gameState.playerId
const VIEW_TIMEOUT_MS = 4000; // max wait for a view switch to actually land in the engine

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gstate = () => (api.gameStore.getState().gameState || {});
const isPlayerNum = (n) => n > 0 && n <= 10;
const outDir = () => path.join(os.homedir(), 'Documents', 'WSR Statements');

// Wait until the engine has actually switched to `id`. setViewAsset only patches activeEntityNum
// optimistically; the new entity's data arrives on a later broadcast that sets activeEntityData.id.
// Mirrors the game's own OwnershipGraph fix (poll until the response entityId matches).
async function waitForEntity(id, timeoutMs = VIEW_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if ((gstate().activeEntityData || {}).id === id) { await sleep(40); return true; }
        await sleep(50);
    }
    return false;
}

// Flatten a subsidiaries tree to descendant company ids. Children live under `.owners` (the engine's
// field name for both the ownership and subsidiaries trees); companies have entityId > 10.
function flattenTreeIds(tree, acc = []) {
    if (!tree) return acc;
    for (const child of (tree.owners || [])) {
        if (typeof child.entityId === 'number' && child.entityId > 10) acc.push(child.entityId);
        flattenTreeIds(child, acc);
    }
    return acc;
}

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

async function exportPortfolio(setStatus) {
    const gs0 = gstate();
    requireGameLoaded(gs0);
    const playerId = gs0.playerId || PLAYER_ID;
    const original = gs0.activeEntityNum;
    const date = monthStr(gs0);

    // Enumerate every controlled entity: direct holdings (controlledCompanies) PLUS the deeper
    // subsidiary tree - companies held *through* a controlled company are NOT in controlledCompanies.
    const ids = [];
    const seen = new Set();
    const addId = (id) => { if (typeof id === 'number' && id > 10 && !seen.has(id)) { seen.add(id); ids.push(id); } };
    for (const c of (gs0.controlledCompanies || [])) addId(c.id);

    // View the player (also populates aep for the PLAYER sheet), then read its subsidiaries tree.
    if (setStatus) setStatus('Mapping holdings...');
    await api.setViewAsset(playerId);
    const onPlayer = await waitForEntity(playerId);
    let gs = gstate();
    const aep = gs.activeEntityPlayerFinancials || {};
    const pname = gs.playerName || (gs.activeEntityData || {}).name || 'Player';
    let treeOk = false;                  // false => the deep ownership tree couldn't be read (surfaced below)
    try {
        let tree = null;
        for (let i = 0; i < 20 && onPlayer; i++) {     // the tree lags too - poll until it's the player's
            const t = await api.getSubsidiariesTree();
            if (t && t.entityId === playerId) { tree = t; break; }
            await sleep(50);
        }
        if (tree) { treeOk = true; for (const id of flattenTreeIds(tree)) addId(id); }
    } catch (e) { console.warn('[wsr-export] subsidiaries tree unavailable:', e); }

    const entities = [{ sheet: 'PLAYER', rows: playerRows(aep, gs, pname, date), summary: playerSummary(aep, gs, pname) }];
    const missed = [];
    const total = ids.length + 1;
    let done = 1;
    if (setStatus) setStatus(`Exporting 1/${total}...`);

    // One sheet per controlled entity - read ONLY after the engine confirms the switch (no stale
    // reads, no duplicates). Each id is unique already (deduped above).
    for (const id of ids) {
        await api.setViewAsset(id);
        const ok = await waitForEntity(id);
        gs = gstate();
        const aed = gs.activeEntityData || {};
        done += 1;
        if (setStatus) setStatus(`Exporting ${done}/${total}...`);
        if (!ok || aed.id !== id) { missed.push(id); continue; }
        const aef = gs.activeEntityFinancials || {};
        const ind = aed.industryId ?? gs.activeIndustryId ?? -1;
        const sym = aed.symbol || aed.name || String(id);
        entities.push({ sheet: sym, rows: companyRows(aef, aed, ind, date), summary: companySummary(aef, aed, ind) });
    }

    // Restore the user's original view.
    if (original != null) { await api.setViewAsset(original); await waitForEntity(original); }

    let res = saveWorkbook(entities, `wsr_financials_${date}`);
    if (!treeOk) res += `\n(couldn't read your full ownership tree - exported direct holdings only; try again)`;
    if (missed.length) res += `\n(${missed.length} entit${missed.length === 1 ? 'y' : 'ies'} didn't load in time and were skipped - run it again)`;
    return res;
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
        const bar = document.getElementById('wsr-export-bar');
        const btns = bar ? [...bar.querySelectorAll('button')] : [b];
        const old = b.textContent;
        btns.forEach((x) => { x.disabled = true; });   // lock BOTH buttons: a mid-run click can't grab a flipped-to entity
        b.textContent = 'Exporting...';
        try {
            const msg = await handler((s) => { b.textContent = s; });
            toast(msg);
        } catch (e) {
            toast('Export failed: ' + (e && e.message ? e.message : String(e)), true);
            console.error('[wsr-export]', e);
        } finally {
            btns.forEach((x) => { x.disabled = false; });
            b.textContent = old;
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

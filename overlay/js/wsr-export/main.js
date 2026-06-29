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
    workbookArray, monthStr, parseProjection, tidyEntityRecord, buildTidyAoa, buildAoaWorkbook,
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

// Trigger the itemized cash-flow projection report for the entity in view and return its text lines.
// setActiveUIReport recomputes the report for the active entity; the text arrives on a later
// broadcast (like the in-game "View Breakdown"), so poll gameState.cashflowProjection until it's a
// refreshed cash-flow report (changed from before, or whose header names this entity). null on timeout.
async function captureProjectionLines(reportId, name) {
    if (reportId == null) return null;
    const before = (gstate().cashflowProjection || []).join('\n');
    const nameU = String(name || '').toUpperCase();
    try { await api.setActiveUIReport(reportId); } catch (e) { console.warn('[wsr-export] setActiveUIReport failed', e); return null; }
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
        const text = (gstate().cashflowProjection || []).join('\n');
        if (text.trim() && /CASH\s*FLOW/i.test(text) && (text !== before || (nameU && text.toUpperCase().includes(nameU)))) {
            await sleep(40);
            return gstate().cashflowProjection || [];
        }
        await sleep(60);
    }
    return null;
}

// Append the itemized 3-month cash-flow projection as a section on an entity's rows (best-effort;
// a failure just omits the section). `name` is used to confirm the report refreshed for this entity.
async function appendProjection(entity, isPlayer, name) {
    const reportId = isPlayer ? api.UI_PLAYER_CASH_FLOW_PROJECTION : api.UI_CORP_CASH_FLOW_PROJECTION;
    const lines = await captureProjectionLines(reportId, name);
    if (!lines) return;
    const projRows = parseProjection(lines);
    if (!projRows.length) return;
    entity.rows.push(['blank', '', ''], ['section', 'ITEMIZED 3-MONTH CASH FLOW PROJECTION ($M)', '']);
    for (const r of projRows) entity.rows.push(r);
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
function saveBuiltWorkbook(wb, baseName) {
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
function saveWorkbook(entities, baseName) { return saveBuiltWorkbook(buildWorkbook(entities), baseName); }

// Best-effort current save name: the running game doesn't expose the loaded slot, so use the
// most-recently-modified save file from the saves list.
async function currentSaveName() {
    try {
        const saves = await api.listSaves();
        if (Array.isArray(saves) && saves.length) {
            return saves.reduce((a, b) => ((b.modifiedMs || 0) > (a.modifiedMs || 0) ? b : a)).filename || '';
        }
    } catch (e) { console.warn('[wsr-export] listSaves failed', e); }
    return '';
}

// Filename-safe save tag (drop the .DAT extension + illegal/space chars) so each save's exports are
// distinct files in the output folder - lets you compare across saves.
const saveTag = (name) => String(name || 'save').replace(/\.dat$/i, '').replace(/[\\/?*[\]:\s]+/g, '_').slice(0, 40) || 'save';

async function exportCurrent(setStatus) {
    const gs = gstate();
    requireGameLoaded(gs);
    const isP = isPlayerNum(gs.activeEntityNum);
    const ent = entityFrom(gs);
    if (setStatus) setStatus('Reading cash flow...');
    await appendProjection(ent, isP, (gs.activeEntityData || {}).name || gs.playerName);
    const tag = isP ? 'player' : ent.sheet;
    return saveWorkbook([ent], `wsr_${saveTag(await currentSaveName())}_${monthStr(gs)}_${tag}`);
}

// Bulk "Export Portfolio" - tidy / one-row-per-entity. A single workbook with an `entities` sheet
// (every raw API field per entity, wide, NaN where N/A) and a `holdings` sheet (one row per position
// - stocks AND bonds, since portHoldings carries assetType). Encodes the in-game date + save-file
// name. (Replaces the former statement-per-sheet bulk export; single-entity statements are still
// available via "Export This".)
async function exportPortfolio(setStatus) {
    const gs0 = gstate();
    requireGameLoaded(gs0);
    const playerId = gs0.playerId || PLAYER_ID;
    const original = gs0.activeEntityNum;
    const date = monthStr(gs0);
    if (setStatus) setStatus('Reading save info...');
    const meta = { save_file: await currentSaveName(), game_date: date, game_year: gs0.currentYear, game_month: gs0.currentMonth };

    // Enumerate entities (direct holdings + the subsidiary tree), same as Export Portfolio.
    const ids = [];
    const seen = new Set();
    const addId = (id) => { if (typeof id === 'number' && id > 10 && !seen.has(id)) { seen.add(id); ids.push(id); } };
    for (const c of (gs0.controlledCompanies || [])) addId(c.id);

    if (setStatus) setStatus('Mapping holdings...');
    await api.setViewAsset(playerId);
    const onPlayer = await waitForEntity(playerId);
    let gs = gstate();
    let treeOk = false;
    try {
        let tree = null;
        for (let i = 0; i < 20 && onPlayer; i++) {
            const t = await api.getSubsidiariesTree();
            if (t && t.entityId === playerId) { tree = t; break; }
            await sleep(50);
        }
        if (tree) { treeOk = true; for (const id of flattenTreeIds(tree)) addId(id); }
    } catch (e) { console.warn('[wsr-export] subsidiaries tree unavailable:', e); }

    const entityRecords = [];
    const holdingRecords = [];
    const capture = (g, isPlayer) => {
        const aed = g.activeEntityData || {};
        if (isPlayer) {
            const aep = g.activeEntityPlayerFinancials || {};
            const roll = { cash: g.cash, totalAssets: g.totalAssets, totalDebt: g.totalDebt, netWorth: g.netWorth };
            entityRecords.push(tidyEntityRecord('player', aed, aep, Object.assign({}, meta, roll)));
        } else {
            entityRecords.push(tidyEntityRecord('company', aed, g.activeEntityFinancials || {}, meta));
        }
        const owner = { owner_entity_type: isPlayer ? 'player' : 'company', owner_id: aed.id, owner_symbol: aed.symbol || (isPlayer ? 'PLAYER' : '') };
        for (const h of (g.portHoldings || [])) {
            holdingRecords.push(Object.assign({ save_file: meta.save_file, game_date: date }, owner, h));
        }
    };

    capture(gs, true);               // player (already in view)
    const missed = [];
    const total = ids.length + 1;
    let done = 1;
    if (setStatus) setStatus(`Reading 1/${total}...`);

    for (const id of ids) {
        await api.setViewAsset(id);
        const ok = await waitForEntity(id);
        gs = gstate();
        done += 1;
        if (setStatus) setStatus(`Reading ${done}/${total}...`);
        if (!ok || (gs.activeEntityData || {}).id !== id) { missed.push(id); continue; }
        capture(gs, false);
    }

    if (original != null) { await api.setViewAsset(original); await waitForEntity(original); }

    const entLead = ['entity_type', 'id', 'symbol', 'name', 'industryId', 'industryName', 'save_file', 'game_date', 'game_year', 'game_month'];
    const holdLead = ['owner_entity_type', 'owner_id', 'owner_symbol', 'assetType', 'symbol', 'name', 'save_file', 'game_date'];
    const sheets = [{ name: 'entities', aoa: buildTidyAoa(entityRecords, entLead) }];
    if (holdingRecords.length) sheets.push({ name: 'holdings', aoa: buildTidyAoa(holdingRecords, holdLead) });

    let res = saveBuiltWorkbook(buildAoaWorkbook(sheets), `wsr_portfolio_${saveTag(meta.save_file)}_${date}`);
    res += `\n(${entityRecords.length} entities, ${holdingRecords.length} holdings)`;
    if (!treeOk) res += `\n(couldn't read your full ownership tree - direct holdings only; try again)`;
    if (missed.length) res += `\n(${missed.length} entit${missed.length === 1 ? 'y' : 'ies'} didn't load in time - run it again)`;
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

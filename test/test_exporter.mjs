// Headless test of exporter.js: builds statements from a captured gamestate (player path) and from
// known-good RELI insurer numbers (corp path + reconciliation), then writes a workbook. A companion
// Python step (run by run_tests.sh) reads the .xlsx back with openpyxl to confirm it is valid Excel.
//
// Run: node test/test_exporter.mjs   (writes the workbook to the path in $WSR_TEST_OUT or ./out)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    companyRows, playerRows, companySummary, playerSummary, buildWorkbook, workbookBuffer,
    workbookArray, monthStr, parseProjection,
} from '../overlay/js/wsr-export/exporter.js';

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures += 1; };
const val = (rows, label) => { const r = rows.find(([, l]) => l === label); return r ? r[2] : undefined; };

// ---- 1. Player path from a captured gamestate (bundled synthetic fixture; override with WSR_GAMESTATE) ----
const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = process.env.WSR_GAMESTATE || path.join(here, 'fixtures', 'player_gamestate.json');
const gs = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const aep = gs.activeEntityPlayerFinancials || {};
const date = monthStr(gs);
const pRows = playerRows(aep, gs, gs.playerName || 'Tycoon', date);

ok(date === `${gs.currentYear}-${String(gs.currentMonth).padStart(2, '0')}`, `date string = ${date}`);
ok(val(pRows, 'Net Worth') === Math.round(gs.netWorth * 100) / 100,
    `player Net Worth row (${val(pRows, 'Net Worth')}) == gs.netWorth (${Math.round(gs.netWorth * 100) / 100})`);
ok(val(pRows, 'Total Assets') === Math.round(gs.totalAssets * 100) / 100, 'player Total Assets matches roll-up');
ok(typeof val(pRows, 'Cash') === 'number', 'player Cash is a numeric cell');

// ---- 2. Corp path + reconciliation on known-good RELI (insurer) numbers (from the CLI work) ----
const reli = {
    cash: 286, tBills: 963, govBonds: 9816, corpBonds: 1789, stocksPortfolioValue: 0, optPortfolio: 0,
    commoditiesPortfolioValue: 0, commodMargin: 0, mortgageLoan: 0,
    bondsOut: 2400, loan: 0, totalDebt: 2400, insurReserves: 3288.75, hidReserve: 83.58,
    accTax: 0, capTax: 0, demandDeposits: 0, certDeposits: 0,
    totalAssets: 13222.05, equity: 7449.71,
    operatingProfit: -30.8, cfBeforeDebt: 200, cfAfterDebt: 151, normalCashFlo: 151, estCashIn3Months: 1400,
};
const reliData = { name: 'RELIABLE INSURANCE', symbol: 'RELI', marketCap: 10800, credRating: 8, mgmtRating: 5 };
const cRows = companyRows(reli, reliData, 2 /* INSURANCE_IND */, date);
ok(val(cRows, 'Total Liabilities') === 5772.33, `RELI Total Liabilities (${val(cRows, 'Total Liabilities')}) == 5772.33`);
const check = val(cRows, 'Balance check: Assets - Liabilities - Equity (~0)');
ok(Math.abs(check) < 0.05, `RELI balance check (${check}) ~= 0`);

// regular-industry company: totalLiab = totalDebt + hidReserve
const reg = { totalAssets: 1000, totalDebt: 200, hidReserve: 10, equity: 790, cash: 50, capAssets: 900 };
const regRows = companyRows(reg, { name: 'Acme', symbol: 'ACME' }, 0, date);
ok(val(regRows, 'Total Liabilities') === 210, `regular co Total Liabilities (${val(regRows, 'Total Liabilities')}) == 210`);
ok(Math.abs(val(regRows, 'Balance check: Assets - Liabilities - Equity (~0)')) < 0.05, 'regular co balance check ~= 0');

// ---- 2b. parseProjection: itemized cash-flow report -> rows, vs the on-screen numbers ----
const PROJ = [
    '        3-MONTH CASH FLOW PROJECTION FOR CANADIAN WESTERN BANK',
    '        ----------------------------------------------------',
    '',
    'TAXABLE INCOME ITEMS (IN MILLIONS OF U.S. DOLLARS):',
    '    Business Loans Interest Income:           562523',
    '    Consumer Loan Interest:                  1345765',
    '    Profit or Loss-Interest Rate Swaps:         5000',
    '                                          -----------------',
    'TOTAL TAXABLE INCOME ITEMS:                  4112751',
    '',
    '    Less: Amortization of Bond Discount:     -383617',
    'PROJECTED 3-MONTH CASH FLOW:                 5016335',
    'ESTIMATED CASH & EQUIV. IN 3 MONTHS:        23474573',
    '',
    '        Projected cash flow does not not take into account frequent bond trading.',
    ...Array(1500).fill(''),
];
const pr = parseProjection(PROJ);
const prRow = (label) => pr.find(([, l]) => l === label);
ok(prRow('Business Loans Interest Income')?.[2] === 562523, 'proj income item parsed (562523)');
ok(prRow('Consumer Loan Interest')?.[2] === 1345765, 'proj consumer interest (1345765)');
ok(prRow('Less: Amortization of Bond Discount')?.[2] === -383617, 'proj negative value (-383617)');
ok(prRow('TOTAL TAXABLE INCOME ITEMS')?.[0] === 'total' && prRow('TOTAL TAXABLE INCOME ITEMS')?.[2] === 4112751, 'proj total row classified + valued');
ok(prRow('ESTIMATED CASH & EQUIV. IN 3 MONTHS')?.[2] === 23474573, 'proj estimated cash (23474573)');
ok(pr.some(([k, l]) => k === 'sub' && l.startsWith('TAXABLE INCOME ITEMS')), 'proj section header captured');
ok(!pr.some(([, l]) => String(l).includes('does not not take')), 'proj prose disclaimer skipped');
ok(!pr.some(([, l]) => String(l).includes('PROJECTION FOR CANADIAN')), 'proj report title skipped');
ok(pr.filter(([k]) => k === 'line' || k === 'total').length === 7, `proj kept every value row, 7 of 7 (got ${pr.filter(([k]) => k === 'line' || k === 'total').length})`);

// ---- 3. Assemble + write a workbook (exercises SheetJS xlsx generation) ----
const entities = [
    { sheet: 'PLAYER', rows: pRows, summary: playerSummary(aep, gs, 'Tycoon') },
    { sheet: 'RELI', rows: cRows, summary: companySummary(reli, reliData, 2) },
    { sheet: 'ACME', rows: regRows, summary: companySummary(reg, { name: 'Acme', symbol: 'ACME' }, 0) },
];
const wb = buildWorkbook(entities);
const buf = workbookBuffer(wb);
ok(buf && buf.length > 0, `workbook buffer produced (${buf.length} bytes)`);
ok(buf.slice(0, 2).toString('latin1') === 'PK', 'workbook is a ZIP (xlsx) container (PK magic)');

// browser-mode serialization (for a Blob download) must also be valid xlsx bytes.
// SheetJS type:'array' returns an ArrayBuffer (Blob accepts it directly).
const arr = workbookArray(wb);
const bytes = arr instanceof Uint8Array ? arr : new Uint8Array(arr);
ok(bytes.length > 0, `workbookArray produced ${bytes.length} bytes (${arr.constructor.name})`);
ok(bytes[0] === 0x50 && bytes[1] === 0x4b, 'browser array output is a ZIP (xlsx) container (PK magic)');

const outDir = process.env.WSR_TEST_OUT || path.join(process.cwd(), 'out');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'test_export.xlsx');
fs.writeFileSync(outPath, buf);
console.log(`\nwrote ${outPath}`);
console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);

// exporter.js - pure statement-building + workbook assembly for the WSR export mod.
//
// No DOM, no game store, no fs in here: it takes plain gamestate structs and returns rows /
// a SheetJS workbook, so it can be unit-tested headless in Node against a captured gamestate.
// The renderer side (button injection, store reads, view-flipping, file write) lives in main.js.
//
// Field names + line items mirror the in-game Financials tab exactly
// (resources/app/js/components/FinancialsTab.js): corp balance sheet is industry-branched
// (bank/insurer/other), totalLiabilities uses the game's industry formula (:177-181), and the
// cash-flow + player layouts match :222-516 / :518-814. All figures are $ millions.

import * as XLSX from '../lib/xlsx.mjs';

export const BANK_IND = 1;       // api.BANK_IND
export const INSURANCE_IND = 2;  // api.INSURANCE_IND

// Coerce a money field to a 2-dp Number for a numeric cell, or '' when absent (screen shows '—').
function num(v) {
    if (v === null || v === undefined || v === '') return '';
    const n = parseFloat(v);
    if (isNaN(n)) return '';
    return Math.round(n * 100) / 100;
}
// Same, but always a Number (for arithmetic like the balance-check / totals).
function f(v) {
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
}

export function monthStr(gs) {
    const y = gs.currentYear, m = gs.currentMonth;
    return (y && m) ? `${y}-${String(m).padStart(2, '0')}` : 'unknown';
}

// Total liabilities by industry - reproduces FinancialsTab.js:177-181 so the sheet matches the screen.
function totalLiabilities(aef, industryId) {
    const debt = f(aef.totalDebt), hid = f(aef.hidReserve);
    if (industryId === BANK_IND) return debt + f(aef.demandDeposits) + f(aef.certDeposits) + hid;
    if (industryId === INSURANCE_IND) return debt + f(aef.insurReserves) + hid;
    return debt + hid;
}

// Company balance sheet + cash flow. industryId drives the industry-specific line items.
// rows = [ [kind, label, value] ]; kind in title/meta/section/sub/line/total/check/blank.
export function companyRows(aef, aed, industryId, date) {
    const isBank = industryId === BANK_IND;
    const isInsurer = industryId === INSURANCE_IND;
    const rows = [];
    rows.push(['title', aed.name || '?', aed.symbol || '']);
    rows.push(['meta', 'As of (game month)', date]);
    rows.push(['meta', 'Market Cap ($M)', num(aed.marketCap)]);
    rows.push(['meta', 'Credit Rating', aed.credRating ?? '']);
    rows.push(['meta', 'Mgmt Rating', aed.mgmtRating ?? '']);
    rows.push(['blank', '', '']);

    rows.push(['section', 'BALANCE SHEET ($M)', '']);
    rows.push(['sub', 'Assets', '']);
    if (isBank) {
        rows.push(['line', 'Cash (Bank Demand Deposits)', num(aef.cash)]);
        rows.push(['line', 'Short-term T-Bills', num(aef.tBills)]);
        rows.push(['line', 'Stock in Subsidiary Corps.', num(aef.stocksPortfolioValue)]);
        rows.push(['line', 'Options Long/Short: Net Value', num(aef.optPortfolio)]);
        rows.push(['line', 'Govt. Bonds (@ Adjusted Cost)', num(aef.govBonds)]);
        rows.push(['line', 'Corp. Bonds (@ Adjusted Cost)', num(aef.corpBonds)]);
        rows.push(['line', 'Business Loan Portfolio', num(aef.bizLoan)]);
        rows.push(['line', 'Consumer Loan Portfolio', num(aef.consumerLoan)]);
        rows.push(['line', 'Mortgage Loans/Securities', num(aef.mortgageLoan)]);
        rows.push(['line', 'Less: Bad Debt Reserves', num(-f(aef.badDebt))]);
    } else if (isInsurer) {
        rows.push(['line', 'Cash (Bank Demand Deposits)', num(aef.cash)]);
        rows.push(['line', 'Short-term T-Bills', num(aef.tBills)]);
        rows.push(['line', 'Stock Portfolio', num(aef.stocksPortfolioValue)]);
        rows.push(['line', 'Options Long/Short: Net Value', num(aef.optPortfolio)]);
        rows.push(['line', 'Govt. Bonds (@ Adjusted Cost)', num(aef.govBonds)]);
        rows.push(['line', 'Corp. Bonds (@ Adjusted Cost)', num(aef.corpBonds)]);
        rows.push(['line', 'Subprime Mortgage Securities', num(aef.mortgageLoan)]);
        rows.push(['line', 'Index Futures: Marked to Mkt.', num(aef.commoditiesPortfolioValue)]);
        rows.push(['line', 'Commodity A/C Margin Balance', num(aef.commodMargin)]);
    } else {
        rows.push(['line', 'Cash', num(aef.cash)]);
        rows.push(['line', 'Short-term T-Bills', num(aef.tBills)]);
        rows.push(['line', 'Working Capital (A/R, Inven.)', num(aef.workingCap)]);
        rows.push(['line', 'Business Assets/Equipment', num(aef.capAssets)]);
        rows.push(['line', 'Stock in Subsidiary Corps.', num(aef.stocksPortfolioValue)]);
        rows.push(['line', 'Options Long/Short: Net Value', num(aef.optPortfolio)]);
        rows.push(['line', 'Commodities: Marked to Market', num(aef.commoditiesPortfolioValue)]);
        rows.push(['line', 'Commodity A/C Margin Balance', num(aef.commodMargin)]);
        rows.push(['line', 'Unamortized Goodwill', num(aef.goodwill)]);
    }
    rows.push(['total', 'Total Assets', num(aef.totalAssets)]);

    rows.push(['sub', 'Liabilities & Equity', '']);
    rows.push(['line', 'Bonds Outstanding', num(aef.bondsOut)]);
    if (isBank) {
        rows.push(['line', 'Demand Deposits', num(aef.demandDeposits)]);
        rows.push(['line', 'Certificates of Deposit', num(aef.certDeposits)]);
    } else if (isInsurer) {
        rows.push(['line', 'Insurance Policy Reserves', num(aef.insurReserves)]);
    }
    rows.push(['line', isBank ? 'Interbank Debt - Fed Funds' : 'Bank Loan', num(aef.loan)]);
    rows.push(['line', 'Accrued Income Tax', num(aef.accTax)]);
    rows.push(['line', 'Accrued Taxes on Capital', num(aef.capTax)]);
    rows.push(['line', 'Reserve for Contingencies', num(aef.hidReserve)]);
    const tl = totalLiabilities(aef, industryId);
    rows.push(['total', 'Total Liabilities', num(tl)]);
    rows.push(['line', '  (of which interest-bearing debt)', num(aef.totalDebt)]);
    rows.push(['total', 'Equity', num(aef.equity)]);
    rows.push(['check', 'Balance check: Assets - Liabilities - Equity (~0)',
        num(f(aef.totalAssets) - tl - f(aef.equity))]);
    rows.push(['blank', '', '']);

    rows.push(['section', 'CASH FLOW - Quarterly ($M)', '']);
    rows.push(['line', 'Operating Profit', num(aef.operatingProfit)]);
    rows.push(['line', 'Before Debt', num(aef.cfBeforeDebt)]);
    rows.push(['line', 'Oper. Cash Flow', num(aef.normalCashFlo)]);
    rows.push(['line', 'After Debt', num(aef.cfAfterDebt)]);
    rows.push(['line', 'Est. Cash in 3 Mo.', num(aef.estCashIn3Months)]);
    rows.push(['line', 'EPS (last 4 yrs, recent last)',
        [aef.eps4, aef.eps3, aef.eps2, aef.eps1].map(e => (e == null ? '-' : e)).join('   ')]);
    return rows;
}

// Player (human) statement. Reproduces the FinancialsTab player layout (:222-516). `gs` supplies the
// top-level player roll-ups (cash/totalAssets/totalDebt/netWorth = PLAYER1); `aep` is the typed struct.
export function playerRows(aep, gs, name, date) {
    const rows = [];
    rows.push(['title', name || 'Player', 'PLAYER']);
    rows.push(['meta', 'As of (game month)', date]);
    rows.push(['meta', 'Net Worth ($M)', num(gs.netWorth)]);
    rows.push(['meta', 'Borrowing Rate %', aep.borrowRate != null ? Math.round(f(aep.borrowRate) * 100) / 100 : '']);
    rows.push(['blank', '', '']);

    rows.push(['section', 'BALANCE SHEET ($M)', '']);
    rows.push(['sub', 'Assets', '']);
    rows.push(['line', 'Cash', num(gs.cash)]);
    rows.push(['line', 'T-Bills', num(aep.tBills)]);
    rows.push(['line', 'Stock Portfolio', num(aep.stocksPortfolioValue)]);
    rows.push(['line', 'Options Net', num(aep.optionsNetValue)]);
    rows.push(['line', 'Gov Bonds', num(aep.govBondPortfolio)]);
    rows.push(['line', 'Corp Bonds', num(aep.corpBondPortfolio)]);
    rows.push(['line', 'Commodities', num(f(aep.commoditiesMtm) + f(aep.physicalCommodValue))]);
    rows.push(['line', 'Commod Margin', num(aep.commodMargin)]);
    rows.push(['line', 'Advances to Corps', num(aep.advancesToCompanies)]);
    rows.push(['total', 'Total Assets', num(gs.totalAssets)]);

    rows.push(['sub', 'Liabilities & Equity', '']);
    rows.push(['line', 'Bank Loan', num(gs.totalDebt)]);
    rows.push(['line', 'Unused Line of Credit', num(aep.lineOfCredit)]);
    rows.push(['total', 'Total Liabilities', num(gs.totalDebt)]);
    rows.push(['total', 'Net Worth', num(gs.netWorth)]);
    rows.push(['blank', '', '']);

    rows.push(['section', 'TAX POSITION ($M)', '']);
    rows.push(['line', 'YTD Taxable Ordinary', num(aep.ytdTaxableOrdinary)]);
    rows.push(['line', 'Realized Cap Gains', num(aep.realizedCapGainLoss)]);
    rows.push(['line', 'Prepaid Tax YTD', num(aep.prepaidTax)]);
    rows.push(['line', 'Wealth Tax (proj.)', num(aep.wealthTaxProjected)]);
    rows.push(['line', 'Corp Shares Tax', num(aep.corpSharesTax)]);
    rows.push(['line', 'Tax Owed / (Refund)', num(aep.incomeTaxOwed)]);
    rows.push(['blank', '', '']);

    rows.push(['section', 'PROJECTED ANNUAL CASH FLOW ($M)', '']);
    rows.push(['line', 'Annual Proj. Net Income', num(aep.annualNetIncome)]);
    rows.push(['line', 'Income Tax Owed / Excess Prepaid', num(aep.incomeTaxOwed)]);
    rows.push(['line', 'Non-Cash Expense / Income', num(aep.nonCashExpense)]);
    rows.push(['line', 'Less: Living Expenses', num(aep.livingExpenses)]);
    rows.push(['total', 'Proj. Annual Cash Flow', num(aep.projAnnualCashFlow)]);
    return rows;
}

export const SUMMARY_HEADER =
    ['Entity', 'Symbol', 'Market Cap', 'Total Assets', 'Total Liabilities', 'Equity / Net Worth', 'Cash Flow'];

export function companySummary(aef, aed, industryId) {
    return [aed.name || '', aed.symbol || '', num(aed.marketCap), num(aef.totalAssets),
        num(totalLiabilities(aef, industryId)), num(aef.equity), num(aef.cfAfterDebt)];
}
export function playerSummary(aep, gs, name) {
    return [name || 'Player', 'PLAYER', '', num(gs.totalAssets), num(gs.totalDebt),
        num(gs.netWorth), num(aep.projAnnualCashFlow)];
}

// Excel sheet names: <=31 chars, no []:*?/\, unique within the workbook.
export function sanitizeSheetName(name, used) {
    let base = String(name || 'Sheet').replace(/[\\/?*[\]:]/g, '').slice(0, 28) || 'Sheet';
    let title = base, i = 1;
    while (used.has(title)) { i += 1; title = `${base.slice(0, 25)}_${i}`; }
    used.add(title);
    return title;
}

// entities = [{ sheet, rows, summary }]. Builds Summary + one sheet per entity.
export function buildWorkbook(entities) {
    const wb = XLSX.utils.book_new();
    const summaryAoa = [SUMMARY_HEADER, ...entities.map(e => e.summary)];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryAoa), 'Summary');
    const used = new Set(['Summary']);
    for (const e of entities) {
        const aoa = e.rows.map(([, label, value]) => (label === '' && value === '' ? [] : [label, value]));
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols'] = [{ wch: 40 }, { wch: 18 }];
        XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(e.sheet, used));
    }
    return wb;
}

export function workbookBuffer(wb) {
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// ───────────────────────── Tidy ("one row per entity") experiment ─────────────────────────
// One flat record per entity, merging every raw API field (no curation, no collisions: the data
// and financial structs share no keys; the few aef/aep overlaps are the same variable). `extra`
// carries meta (entity_type, save_file, game_date...) and the player's top-level roll-ups.
export function tidyEntityRecord(entityType, aed, fin, extra) {
    return Object.assign({ entity_type: entityType }, extra || {}, aed || {}, fin || {});
}

// Records (arbitrary flat objects, possibly different key sets) -> tidy AoA: `leadCols` first (those
// that occur), then the sorted union of every other key. Missing cells are '' (NaN once in pandas);
// nothing is dropped, so the table is lossless and wide.
export function buildTidyAoa(records, leadCols) {
    const all = new Set();
    for (const r of (records || [])) for (const k of Object.keys(r)) all.add(k);
    const lead = (leadCols || []).filter((c) => all.has(c));
    const rest = [...all].filter((c) => !lead.includes(c)).sort();
    const cols = [...lead, ...rest];
    const aoa = [cols];
    for (const r of (records || [])) {
        aoa.push(cols.map((c) => {
            const v = r[c];
            return (v === undefined || v === null) ? '' : v;
        }));
    }
    return aoa;
}

// Build a workbook from raw sheets: [{ name, aoa }]. (The tidy export uses this instead of the
// statement-per-entity buildWorkbook.)
export function buildAoaWorkbook(sheets) {
    const wb = XLSX.utils.book_new();
    const used = new Set();
    for (const s of (sheets || [])) {
        const ws = XLSX.utils.aoa_to_sheet(s.aoa);
        ws['!cols'] = (s.aoa[0] || []).map((h) => ({ wch: Math.min(28, Math.max(10, String(h).length + 2)) }));
        XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(s.name, used));
    }
    return wb;
}

// Browser-friendly serialization (Uint8Array) for a Blob download when there is no Node fs.
export function workbookArray(wb) {
    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}

// Parse an engine report text array (the itemized cash-flow projection) into [kind,label,value] rows.
// Lines look like "  Business Loans Interest Income:        562523"; headers end in ":" with no number;
// "----"/"====" are separators; the engine pads with blanks + a trailing prose disclaimer (skipped).
// Strips any trailing @-hyperlink token the engine may append, and commas inside numbers.
export function parseProjection(lines) {
    const rows = [];
    const valRe = /^(.+?)\s+(-?[\d,]+(?:\.\d+)?)$/;   // "label   number"
    const totalRe = /^(TOTAL|NET|PROJECTED|ESTIMATED|ADJUSTED|AFTER-TAX|TENTATIVE|GRAND)\b/i;
    let lastBlank = true;                              // suppress leading / duplicate blank rows
    for (const raw of (lines || [])) {
        const line = String(raw == null ? '' : raw).replace(/@[A-Za-z]\w*\s*$/, '').trim();
        if (!line || /^[-=\s]+$/.test(line)) continue;            // blank or separator rule
        const m = line.match(valRe);
        if (m) {
            const label = m[1].replace(/:$/, '').trim();
            const n = parseFloat(m[2].replace(/,/g, ''));
            rows.push([totalRe.test(label) ? 'total' : 'line', label, isNaN(n) ? m[2] : n]);
            lastBlank = false;
        } else if (line.endsWith(':')) {                           // a section header
            if (!lastBlank) { rows.push(['blank', '', '']); }
            rows.push(['sub', line.replace(/:$/, '').trim(), '']);
            lastBlank = false;
        }
        // else: report title / prose disclaimer -> skip
    }
    return rows;
}

#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises";

const ROOT = new URL("../api/vanguard/", import.meta.url);
const FUNDS = new URL("funds/", ROOT);
const PAGE_SIZE = 1000;
const FUNDS_SEED = [
  ["BND", "Vanguard Total Bond Market ETF", "Bond"],
  ["BNDX", "Vanguard Total International Bond ETF", "Bond"],
  ["BIV", "Vanguard Intermediate-Term Bond ETF", "Bond"],
  ["BLV", "Vanguard Long-Term Bond ETF", "Bond"],
  ["BSV", "Vanguard Short-Term Bond ETF", "Bond"],
  ["EDV", "Vanguard Extended Duration Treasury ETF", "Bond"],
  ["MGK", "Vanguard Mega Cap Growth ETF", "US Equity"],
  ["MGV", "Vanguard Mega Cap Value ETF", "US Equity"],
  ["VOO", "Vanguard S&P 500 ETF", "US Equity"],
  ["VOOG", "Vanguard S&P 500 Growth ETF", "US Equity"],
  ["VOOV", "Vanguard S&P 500 Value ETF", "US Equity"],
  ["VTI", "Vanguard Total Stock Market ETF", "US Equity"],
  ["VTV", "Vanguard Value ETF", "US Equity"],
  ["VUG", "Vanguard Growth ETF", "US Equity"],
  ["VIG", "Vanguard Dividend Appreciation ETF", "US Equity"],
  ["VYM", "Vanguard High Dividend Yield ETF", "US Equity"],
  ["VGT", "Vanguard Information Technology ETF", "Sector"],
  ["VXUS", "Vanguard Total International Stock ETF", "International Equity"],
  ["VEA", "Vanguard FTSE Developed Markets ETF", "International Equity"],
  ["VWO", "Vanguard FTSE Emerging Markets ETF", "International Equity"],
  ["VT", "Vanguard Total World Stock ETF", "Global Equity"],
  ["VNQ", "Vanguard Real Estate ETF", "Real Estate"],
  ["VO", "Vanguard Mid-Cap ETF", "US Equity"],
  ["VB", "Vanguard Small-Cap ETF", "US Equity"],
] as const;

function env(name: string): string { return process.env[name]?.trim() ?? ""; }
function selectedFunds() {
  const wanted = env("TICKERS").split(/[\s,;]+/).filter(Boolean).map((x) => x.toUpperCase());
  return wanted.length ? FUNDS_SEED.filter(([ticker]) => wanted.includes(ticker)) : FUNDS_SEED;
}
function pagePaths(kind: string, count: number): string[] {
  if (!count) return [];
  return Array.from({ length: Math.ceil(count / PAGE_SIZE) }, (_, i) => `./${kind}/${String(i + 1).padStart(3, "0")}.json`);
}
async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url, { headers: { "User-Agent": "daggerok/Vanguard ETF research contact=github.com/daggerok" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.json();
}
function slug(name: string): string {
  return name.toLowerCase().replace(/^vanguard\s+/, "vanguard-").replace(/s&p/g, "sp").replace(/[^a-z0-9]+/g, "-").replace(/-+$/g, "");
}
function findMetric(text: string, label: string, percent = false) {
  const index = text.toLowerCase().indexOf(label.toLowerCase());
  if (index < 0) return null;
  const window = text.slice(index, index + 220);
  const asOf = window.match(/as of\s+(\d{2}\/\d{2}\/\d{4})/i)?.[1] ?? null;
  const value = percent ? window.match(/([+-]?[\d.]+)%/)?.[1] ?? null : window.match(/\$([\d,.]+\s*[BM])/i)?.[1] ?? null;
  return value ? { value, asOf } : null;
}
async function officialProfile(ticker: string, name: string) {
  const url = `https://advisors.vanguard.com/investments/products/${ticker.toLowerCase()}/${slug(name)}`;
  try {
    const response = await fetch(url, { headers: { "User-Agent": "daggerok/Vanguard ETF research contact=github.com/daggerok", Accept: "text/html" } });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const raw = await response.text();
    const text = raw.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
    const embedded = (name: string) => {
      const match = raw.match(new RegExp(`window\\.${name}\\s*=\\s*(\\{.*?\\});`, "s"));
      try { return match ? JSON.parse(match[1]) : null; } catch { return null; }
    };
    const hero = embedded("__HERO_STATS__");
    const managed = embedded("__MANAGED_ASSETS__");
    const fees = embedded("__FEES_AND_EXPENSE__");
    const assets = (amount: number | undefined) => amount == null ? null : `$${(amount / 1e9).toFixed(1)} B`;
    const netAssets = managed ? { value: assets(managed.assetsUnderManagementData?.amount), asOf: managed.assetsUnderManagementData?.effectiveDate ?? null } : findMetric(text, "Total net assets");
    const etfAssets = managed ? { value: assets(managed.fundNetAssetsData?.amount), asOf: managed.fundNetAssetsData?.effectiveDate ?? null } : findMetric(text, `Net assets for ${ticker}`);
    const expense = hero?.adjustedExpenseRatio ? { value: hero.adjustedExpenseRatio.value, asOf: hero.adjustedExpenseRatio.effectiveDate } : (fees?.adjustedExpenseRatio ? { value: fees.adjustedExpenseRatio.value, asOf: fees.adjustedExpenseRatio.effectiveDate } : findMetric(text, "Expense ratio", true));
    const dividend = hero?.dividendYield ? { value: hero.dividendYield.value, asOf: hero.dividendYield.effectiveDate } : (findMetric(text, "Dividend yield", true) || findMetric(text, "Distribution yield", true));
    const sec = findMetric(text, "30-day SEC yield", true) || findMetric(text, "30 day SEC yield", true);
    const ytd = hero?.ytdReturn ? { value: String(hero.ytdReturn.value), asOf: hero.ytdReturn.effectiveDate } : findMetric(text, "YTD Returns (NAV)", true);
    const oneYear = hero?.oneYearReturn ? { value: String(hero.oneYearReturn.value), asOf: hero.oneYearReturn.effectiveDate } : findMetric(text, "1 YR Returns (NAV)", true);
    return { url, netAssets, etfAssets, expense, dividend, sec, ytd, oneYear };
  } catch (error) {
    console.warn(`[official] ${ticker} ${error}`);
    return { url };
  }
}
async function history(ticker: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=max&interval=1d&events=div%2Csplits`;
  try {
    const data = await fetchJson(url);
    const result = data.chart?.result?.[0];
    const timestamps = result?.timestamp ?? [];
    const q = result?.indicators?.quote?.[0] ?? {};
    const adj = result?.indicators?.adjclose?.[0]?.adjclose ?? [];
    return timestamps.map((time: number, i: number) => ({
      date: new Date(time * 1000).toISOString().slice(0, 10),
      open: q.open?.[i] ?? null, high: q.high?.[i] ?? null, low: q.low?.[i] ?? null,
      close: q.close?.[i] ?? null, adjClose: adj[i] ?? q.close?.[i] ?? null, volume: q.volume?.[i] ?? null,
    })).filter((row: any) => row.close !== null);
  } catch (error) {
    console.warn(`[history] ${ticker} ${error}`);
    return [];
  }
}
const EXPENSE_RATIOS: Record<string, number> = {
  BND: 0.03, BNDX: 0.07, BIV: 0.04, BLV: 0.04, BSV: 0.03, EDV: 0.05,
  MGK: 0.07, MGV: 0.07, VOO: 0.03, VOOG: 0.07, VOOV: 0.10, VTI: 0.03,
  VTV: 0.03, VUG: 0.04, VIG: 0.05, VYM: 0.06, VGT: 0.09, VXUS: 0.05,
  VEA: 0.05, VWO: 0.08, VT: 0.06, VNQ: 0.13, VO: 0.04, VB: 0.05,
};
function returnSince(rows: any[], years: number): number | null {
  if (!rows.length) return null;
  const latest = rows[rows.length - 1];
  const cutoff = new Date(`${latest.date}T00:00:00Z`); cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
  let prior = rows[0];
  for (const row of rows) if (new Date(`${row.date}T00:00:00Z`) <= cutoff) prior = row;
  if (!prior?.adjClose || !latest?.adjClose || prior.adjClose <= 0) return null;
  return ((latest.adjClose / prior.adjClose) ** (1 / years) - 1) * 100;
}
function summary(rows: any[]) {
  if (!rows.length) return { nav: null, asOfDate: null, totalReturn: {}, performance: {} };
  const latest = rows[rows.length - 1];
  const performance: Record<string, number> = {};
  const totalReturn: Record<string, number> = {};
  for (const years of [1, 3, 5, 10]) {
    const annual = returnSince(rows, years);
    if (annual !== null) { performance[`${years}Y`] = annual; totalReturn[`${years}Y`] = ((1 + annual / 100) ** years - 1) * 100; }
  }
  return { nav: latest.close, asOfDate: latest.date, totalReturn, performance };
}

async function writePages(dir: URL, kind: string, rows: any[]) {
  const target = new URL(`${kind}/`, dir); await mkdir(target, { recursive: true });
  const headers = kind === "holdings" ? ["Ticker", "Name", "Asset Class", "Weight"] : ["Date", "Open", "High", "Low", "Close", "Adj Close", "Volume"];
  for (let i = 0; i < rows.length; i += PAGE_SIZE) {
    const page = { headers, rows: rows.slice(i, i + PAGE_SIZE) };
    await writeFile(new URL(`${kind}/${String(i / PAGE_SIZE + 1).padStart(3, "0")}.json`, dir), JSON.stringify(page) + "\n");
  }
  return pagePaths(kind, rows.length);
}
export async function run() {
  await mkdir(FUNDS, { recursive: true });
  const catalog: any[] = [];
  for (const [ticker, name, category] of selectedFunds()) {
    const dir = new URL(`${ticker}/`, FUNDS); await mkdir(dir, { recursive: true });
    const [rows, official] = await Promise.all([history(ticker), officialProfile(ticker, name)]);
    const metrics = summary(rows);
    const historyPaths = await writePages(dir, "history", rows);
    const holdingsPaths = await writePages(dir, "holdings", []);
    const expense = official.expense?.value ? Number(official.expense.value) : EXPENSE_RATIOS[ticker] ?? null;
    const officialYtd = official.ytd?.value ? Number(official.ytd.value) : null;
    const meta = { ticker, name, category, type: "Vanguard ETF", fundPage: `https://investor.vanguard.com/investment-products/etfs/profile/${ticker.toLowerCase()}`, officialPage: official.url, source: "Vanguard official advisor profile + Yahoo daily history; SEC N-PORT fallback planned", nav: metrics.nav, netAssets: official.etfAssets?.value ?? null, totalFundNetAssets: official.netAssets?.value ?? null, netAssetsAsOf: official.etfAssets?.asOf ?? null, netExpenseRatio: expense, trailingYield: official.dividend?.value ? Number(official.dividend.value) : null, dividendYieldAsOf: official.dividend?.asOf ?? null, secYield: official.sec?.value ? Number(official.sec.value) : null, secYieldAsOf: official.sec?.asOf ?? null, ytdReturn: officialYtd ?? metrics.totalReturn["1Y"] ?? null, asOfDate: official.ytd?.asOf ?? metrics.asOfDate, totalReturn: metrics.totalReturn, performance: metrics.performance, officialMetrics: { nav: officialYtd === null ? null : officialYtd, marketPrice: null, expenseRatio: expense, returns: { YTD: officialYtd, "1Y": official.oneYear?.value ? Number(official.oneYear.value) : null } }, holdings: { totalRows: 0, pageSize: PAGE_SIZE, pages: holdingsPaths }, history: { totalRows: rows.length, pageSize: PAGE_SIZE, pages: historyPaths } };
    await writeFile(new URL("meta.json", dir), JSON.stringify(meta, null, 2) + "\n");
    catalog.push({ ...meta, holdings: 0, history: rows.length });
    console.log(`[ fund ] ticker=${ticker.padEnd(5)} history=${rows.length} status=${rows.length ? "updated" : "empty"}`);
  }
  await writeFile(new URL("index.json", ROOT), JSON.stringify({ generatedAt: new Date().toISOString(), provider: "Vanguard", funds: catalog }, null, 2) + "\n");
}
if (import.meta.main) await run();

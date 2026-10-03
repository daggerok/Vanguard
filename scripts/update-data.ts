#!/usr/bin/env bun
// Checked-in scripts/update-data.config.json is the runtime default; see resolveControls for the layering.
/// <reference types="bun" />
import { readFile as outputReadFile, readdir as outputReadDir } from 'node:fs/promises';
import { createHash as outputCreateHash } from 'node:crypto';
import { join as outputJoin } from 'node:path';
import { fileURLToPath as outputFileURLToPath } from 'node:url';

// Console presentation; no changes to provider requests or persisted data.
/** Presentation only: no requests, writes, filtering, or changes to updater state. */

const outputClean = (value: unknown): string => String(value ?? 'null').replace(/[\r\n\t]+/g, ' ');
/** Presentation only: per-fund retry and fallback notices are printed when VERBOSE is enabled. */
const outputVerbose = (): boolean => /^(1|true|yes|on)$/i.test((globalThis as any).process?.env?.VERBOSE ?? '');
function outputNote(message: string): void { if (outputVerbose()) console.warn(message); }
/** Names are the canonical environment knobs, not internal parser properties. */
function outputConfigEntries(config: Record<string, any>): [string, string][] {
  const values = new Map<string, string>();
  const aliases: Record<string, string> = {
    requestSleepSeconds: 'REQUEST_SLEEP', categories: 'CATEGORY',
    aumRange: 'AUM', terRange: 'TER', dividendYieldRange: 'DIVIDEND_YIELD', secYieldRange: 'SEC_YIELD',
    performanceRanges: 'PERFORMANCE', totalReturnRanges: 'TOTAL_RETURN',
    skipVanEck: 'SKIP_VANECK', skipProShares: 'SKIP_PROSHARES',
    skipWisdomTree: 'SKIP_WISDOMTREE', skipGoldmanSachs: 'SKIP_GOLDMANSACHS',
  };
  const range = (v: any): string => typeof v === 'string' ? v : v?.source ?? `${Number.isFinite(v?.min) ? v.min : ''}:${Number.isFinite(v?.max) ? v.max : ''}`;
  for (const [key, value] of Object.entries(config)) {
    const name = aliases[key] ?? (/^[A-Z0-9_]+$/.test(key) ? key : key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase());
    if (name === 'PERFORMANCE' || name === 'TOTAL_RETURN') {
      for (const period of ['YTD', '1Y', '3Y', '5Y', '10Y']) values.set(`${name}_${period}`, range(value?.[period]));
    } else if (['AUM', 'TER', 'DIVIDEND_YIELD', 'SEC_YIELD'].includes(name)) {
      values.set(name, range(value));
    } else {
      values.set(name, value instanceof Set ? [...value].join(',') || 'all' : Array.isArray(value) ? value.join(',') || 'all' : outputClean(value));
    }
  }
  const first = ['MAX_FETCHES', 'REQUEST_SLEEP', 'CONCURRENCY'];
  return [...values].sort(([a], [b]) => {
    const ai = first.indexOf(a), bi = first.indexOf(b);
    return (ai < 0 ? first.length : ai) - (bi < 0 ? first.length : bi) || a.localeCompare(b);
  });
}
function outputPrintConfig(brand: string, config: Record<string, any>): void {
  const entries: [string, string][] = [...outputConfigEntries(config), ['VERBOSE', String(outputVerbose())]];
  console.log(`[ config   ] ${brand} updater:\n${entries.map(([key, value]) => `              ${key}=${/TOKEN|PASSWORD|SECRET|COOKIE|^SEC_UA$/i.test(key) ? '<redacted>' : outputClean(value)}`).join('\n')}`);
}
function outputHasOutputFilters(config: Record<string, any>): boolean {
  return outputConfigEntries(config).some(([name, value]) =>
    /^(TICKERS|CATEGORY|AUM|TER|DIVIDEND_YIELD|SEC_YIELD|PERFORMANCE_|TOTAL_RETURN_)/.test(name) &&
    !['', ':', 'null', 'all'].includes(value));
}
function outputPrintFilter(selected: number, total: number, deferred = false): void {
  console.log(`[ filter   ] ${selected} of ${total} funds ${deferred ? 'selected for evaluation (data-dependent filters applied per fund)' : 'pass filters'}`);
}
function outputStable(value: any): any {
  if (Array.isArray(value)) return value.map(outputStable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => !['generatedAt', 'catalogReadAt'].includes(key)).map(key => [key, outputStable(value[key])]));
  return value;
}
function outputContentKey(value: unknown): string { return JSON.stringify(outputStable(value)) ?? 'null'; }
async function outputInspectFund(root: URL | string, ticker: string): Promise<{ digest: string; meta: any }> {
  const dir = outputJoin(root instanceof URL ? outputFileURLToPath(root) : root, 'funds', ticker);
  const hash = outputCreateHash('sha256');
  async function visit(path: string): Promise<void> {
    const entries = await outputReadDir(path, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) await visit(outputJoin(path, entry.name));
      else if (entry.name.endsWith('.json')) {
        const text = await outputReadFile(outputJoin(path, entry.name), 'utf8').catch(() => '');
        hash.update(outputJoin(path.slice(dir.length), entry.name));
        try { hash.update(outputContentKey(JSON.parse(text))); } catch { hash.update(text); }
      }
    }
  }
  await visit(dir);
  const meta = await outputReadFile(outputJoin(dir, 'meta.json'), 'utf8').then(JSON.parse).catch(() => ({}));
  return { digest: hash.digest('hex'), meta };
}
const outputCount = (value: any): unknown => typeof value === 'number' ? value : Array.isArray(value) ? value.length : value?.totalRows ?? value?.rows?.length ?? null;
const outputScalar = (value: any): any => value && typeof value === 'object' ? value.display ?? value.value ?? null : value;
function outputMoney(value: any): string {
  const raw = outputScalar(value);
  if (raw === null || raw === undefined || raw === '—' || raw === '--') return 'null';
  const text = String(raw).replace(/[$,\s]/g, '');
  const match = text.match(/^([+-]?[\d.]+)([KMBT])?$/i);
  if (!match) return outputClean(raw);
  const number = Number(match[1]) * ({ K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[match[2]?.toUpperCase() as 'K' | 'M' | 'B' | 'T'] ?? 1);
  if (!Number.isFinite(number)) return 'null';
  for (const [unit, scale] of [['T', 1e12], ['B', 1e9], ['M', 1e6], ['K', 1e3]] as const) {
    if (Math.abs(number) >= scale) return `$${(number / scale).toFixed(1)}${unit}`;
  }
  return `$${number.toFixed(2)}`;
}
function outputFundLine(index: number, total: number, ticker: string, status: string, data: any = {}, reason?: unknown): string {
  const width = Math.max(2, String(total).length);
  const metrics = data.metrics ?? {};
  // Presentation only. Keep valid zero/false values; omit unavailable fields.
  // outputMoney returns the string 'null' for an unavailable monetary value.
  const field = (key: string, value: unknown): string =>
    value === null || value === undefined || value === 'null' ? '' : `${key}=${outputClean(value)}`;
  const sources = [
    field('official', data.officialHistoryCount),
    field('yahoo', data.yahooHistoryCount),
  ].filter(part => part !== '').join(' ');
  const detail = [
    field('port', data.portId ?? data.portfolioId),
    field('history', outputCount(data.history ?? data.historyCount)),
    sources ? `(${sources})` : '',
    field('holdings', outputCount(data.holdings ?? data.holdingsCount)),
    field('divs', outputCount(data.worksheets?.Distributions ?? data.distributions)),
    field('netAssets', outputMoney(data.netAssets ?? data.aum)),
    field('total', outputMoney(data.totalFundNetAssets ?? data.totalNetAssets)),
    field('div', outputScalar(data.trailingYield ?? data.yields?.effectiveYield ?? data.yields?.dividendYield ?? data.dividendYield ?? metrics.dividendYield)),
    field('sec', outputScalar(data.secYield ?? data.yields?.secYield ?? metrics.secYield)),
    field('wp', data.workplaceRaw),
  ].filter(part => part !== '').join(' ');
  return `[ ${String(index).padStart(width)}/${String(total).padEnd(width)}  ] ${outputClean(ticker).padEnd(5)} ${status.padEnd(9)}${detail ? ` ${detail}` : ''}${reason ? ` reason=${outputClean(reason)}` : ''}`;
}
function outputCreateReporter(root: URL | string, total: number) {
  let completed = 0;
  return {
    before: (ticker: string) => outputInspectFund(root, ticker),
    async result(ticker: string, before: { digest: string }, status?: string, reason?: unknown, extra: any = {}) {
      const after = await outputInspectFund(root, ticker);
      console.log(outputFundLine(++completed, total, ticker, status ?? (before.digest === after.digest ? 'unchanged' : 'updated'), { ...after.meta, ...extra }, reason));
    },
  };
}
// Same bounded worker-pool shape as the iShares/ProShares/Franklin/JPMorgan updaters.
async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= values.length) return;
      results[index] = await worker(values[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";

const DEFAULT_ROOT = new URL("../api/vanguard/", import.meta.url);
let ROOT = DEFAULT_ROOT;
let FUNDS = new URL("funds/", ROOT);
export const DEFAULT_SEC_UA = "daggerok ETF feed daggerok@gmail.com";
const UA = DEFAULT_SEC_UA;

const HISTORY_HEADERS = [
  "Date",
  "Open",
  "High",
  "Low",
  "Close",
  "Adj Close",
  "Volume",
  "NAV",
  "Market Price",
  "Premium/Discount (%)",
  "Source",
];
export const HOLDINGS_HEADERS_BASE = [
  "Name",
  "Ticker",
  "Identifier",
  "Weight",
  "Market Value",
  "Shares Held",
  "Asset Category",
  "Sector",
  "Exchange",
  "Location",
  "CUSIP",
  "ISIN",
  "Currency",
];
export const DISTRIBUTION_HEADERS = [
  "Frequency",
  "Ex-Date",
  "Record Date",
  "Payable Date",
  "Dividend",
  "ST Cap Gains",
  "LT Cap Gains",
];

const YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart";
const VANGUARD_IRR_URL = "https://investor.vanguard.com/irr/funds/profile";
const SEC_SITE = "https://www.sec.gov";
const SEC_BROWSE_URL = `${SEC_SITE}/cgi-bin/browse-edgar`;
const SEC_ARCHIVES = `${SEC_SITE}/Archives/edgar/data`;
const SEC_FUND_TICKERS_URL = `${SEC_SITE}/files/company_tickers_mf.json`;
const SEC_COMPANY_TICKERS_URL = `${SEC_SITE}/files/company_tickers.json`;
const FUNDS_SEED = [
  ["BIV", "Vanguard Intermediate-Term Bond ETF", "Bond"],
  ["BLV", "Vanguard Long-Term Bond ETF", "Bond"],
  ["BND", "Vanguard Total Bond Market ETF", "Bond"],
  ["BNDP", "Vanguard Core-Plus Bond Index ETF", "Bond"],
  ["BNDW", "Vanguard Total World Bond ETF", "Bond"],
  ["BNDX", "Vanguard Total International Bond ETF", "Bond"],
  ["BSV", "Vanguard Short-Term Bond ETF", "Bond"],
  ["EDV", "Vanguard Extended Duration Treasury ETF", "Bond"],
  ["ESGV", "Vanguard ESG U.S. Stock ETF", "US Equity"],
  ["IVOG", "Vanguard S&P Mid-Cap 400 Growth ETF", "US Equity"],
  ["IVOO", "Vanguard S&P Mid-Cap 400 ETF", "US Equity"],
  ["IVOV", "Vanguard S&P Mid-Cap 400 Value ETF", "US Equity"],
  ["MGC", "Vanguard Mega Cap ETF", "US Equity"],
  ["MGK", "Vanguard Mega Cap Growth ETF", "US Equity"],
  ["MGV", "Vanguard Mega Cap Value ETF", "US Equity"],
  ["MUNY", "Vanguard New York Tax-Exempt Bond ETF", "Bond"],
  ["VAW", "Vanguard Materials ETF", "Sector"],
  ["VB", "Vanguard Small-Cap ETF", "US Equity"],
  ["VBCA", "Vanguard Target Maturity 2027 Corporate Bond ETF", "Bond"],
  ["VBCB", "Vanguard Target Maturity 2028 Corporate Bond ETF", "Bond"],
  ["VBCC", "Vanguard Target Maturity 2029 Corporate Bond ETF", "Bond"],
  ["VBCD", "Vanguard Target Maturity 2030 Corporate Bond ETF", "Bond"],
  ["VBCE", "Vanguard Target Maturity 2031 Corporate Bond ETF", "Bond"],
  ["VBCF", "Vanguard Target Maturity 2032 Corporate Bond ETF", "Bond"],
  ["VBCG", "Vanguard Target Maturity 2033 Corporate Bond ETF", "Bond"],
  ["VBCH", "Vanguard Target Maturity 2034 Corporate Bond ETF", "Bond"],
  ["VBCI", "Vanguard Target Maturity 2035 Corporate Bond ETF", "Bond"],
  ["VBCJ", "Vanguard Target Maturity 2036 Corporate Bond ETF", "Bond"],
  ["VBIL", "Vanguard 0-3 Month Treasury Bill ETF", "Bond"],
  ["VBK", "Vanguard Small-Cap Growth ETF", "US Equity"],
  ["VBR", "Vanguard Small-Cap Value ETF", "US Equity"],
  ["VCEB", "Vanguard ESG U.S. Corporate Bond ETF", "Bond"],
  ["VCHY", "Vanguard U.S. High-Yield Corporate Bond Index ETF", "Bond"],
  ["VCIT", "Vanguard Intermediate-Term Corporate Bond ETF", "Bond"],
  ["VCLT", "Vanguard Long-Term Corporate Bond ETF", "Bond"],
  ["VCR", "Vanguard Consumer Discretionary ETF", "Sector"],
  ["VCRB", "Vanguard Core Bond ETF", "Bond"],
  ["VCRM", "Vanguard Core Tax-Exempt Bond ETF", "Bond"],
  ["VCSH", "Vanguard Short-Term Corporate Bond ETF", "Bond"],
  ["VDC", "Vanguard Consumer Staples ETF", "Sector"],
  ["VDE", "Vanguard Energy ETF", "Sector"],
  ["VDG", "Vanguard Developed Markets ex-US Growth Index ETF", "International Equity"],
  ["VDIG", "Vanguard Wellington Dividend Growth Active ETF", "US Equity"],
  ["VDV", "Vanguard Developed Markets ex-US Value Index ETF", "International Equity"],
  ["VEA", "Vanguard FTSE Developed Markets ETF", "International Equity"],
  ["VEU", "Vanguard FTSE All-World ex-US ETF", "International Equity"],
  ["VEXC", "Vanguard Emerging Markets ex-China ETF", "International Equity"],
  ["VFH", "Vanguard Financials ETF", "Sector"],
  ["VFMF", "Vanguard U.S. Multifactor ETF", "US Equity"],
  ["VFMO", "Vanguard U.S. Momentum Factor ETF", "US Equity"],
  ["VFMV", "Vanguard U.S. Minimum Volatility ETF", "US Equity"],
  ["VFQY", "Vanguard U.S. Quality Factor ETF", "US Equity"],
  ["VFVA", "Vanguard U.S. Value Factor ETF", "US Equity"],
  ["VGHY", "Vanguard High-Yield Active ETF", "Bond"],
  ["VGIT", "Vanguard Intermediate-Term Treasury ETF", "Bond"],
  ["VGK", "Vanguard FTSE Europe ETF", "International Equity"],
  ["VGLT", "Vanguard Long-Term Treasury ETF", "Bond"],
  ["VGMS", "Vanguard Multi-Sector Income Bond ETF", "Bond"],
  ["VGSH", "Vanguard Short-Term Treasury ETF", "Bond"],
  ["VGT", "Vanguard Information Technology ETF", "Sector"],
  ["VGUS", "Vanguard Ultra-Short Treasury ETF", "Bond"],
  ["VGVT", "Vanguard Government Securities Active ETF", "Bond"],
  ["VHT", "Vanguard Health Care ETF", "Sector"],
  ["VIG", "Vanguard Dividend Appreciation ETF", "US Equity"],
  ["VIGI", "Vanguard International Dividend Appreciation ETF", "International Equity"],
  ["VIOG", "Vanguard S&P Small-Cap 600 Growth ETF", "US Equity"],
  ["VIOO", "Vanguard S&P Small-Cap 600 ETF", "US Equity"],
  ["VIOV", "Vanguard S&P Small-Cap 600 Value ETF", "US Equity"],
  ["VIS", "Vanguard Industrials ETF", "Sector"],
  ["VMBS", "Vanguard Mortgage-Backed Securities ETF", "Bond"],
  ["VNQ", "Vanguard Real Estate ETF", "Real Estate"],
  ["VNQI", "Vanguard Global ex-U.S. Real Estate ETF", "Real Estate"],
  ["VO", "Vanguard Mid-Cap ETF", "US Equity"],
  ["VOE", "Vanguard Mid-Cap Value ETF", "US Equity"],
  ["VONE", "Vanguard Russell 1000 ETF", "US Equity"],
  ["VONG", "Vanguard Russell 1000 Growth ETF", "US Equity"],
  ["VONV", "Vanguard Russell 1000 Value ETF", "US Equity"],
  ["VOO", "Vanguard S&P 500 ETF", "US Equity"],
  ["VOOG", "Vanguard S&P 500 Growth ETF", "US Equity"],
  ["VOOV", "Vanguard S&P 500 Value ETF", "US Equity"],
  ["VOT", "Vanguard Mid-Cap Growth ETF", "US Equity"],
  ["VOX", "Vanguard Communication Services ETF", "Sector"],
  ["VPL", "Vanguard FTSE Pacific ETF", "International Equity"],
  ["VPLS", "Vanguard Core-Plus Bond ETF", "Bond"],
  ["VPU", "Vanguard Utilities ETF", "Sector"],
  ["VSDB", "Vanguard Short Duration Bond ETF", "Bond"],
  ["VSDM", "Vanguard Short Duration Tax-Exempt Bond ETF", "Bond"],
  ["VSGX", "Vanguard ESG International Stock ETF", "International Equity"],
  ["VSS", "Vanguard FTSE All-World ex-US Small-Cap ETF", "International Equity"],
  ["VT", "Vanguard Total World Stock ETF", "Global Equity"],
  ["VTC", "Vanguard Total Corporate Bond ETF", "Bond"],
  ["VTEB", "Vanguard Tax-Exempt Bond ETF", "Bond"],
  ["VTEC", "Vanguard California Tax-Exempt Bond ETF", "Bond"],
  ["VTEI", "Vanguard Intermediate-Term Tax-Exempt Bond ETF", "Bond"],
  ["VTEL", "Vanguard Long-Term Tax-Exempt Bond ETF", "Bond"],
  ["VTES", "Vanguard Short-Term Tax-Exempt Bond ETF", "Bond"],
  ["VTG", "Vanguard Total Treasury ETF", "Bond"],
  ["VTHR", "Vanguard Russell 3000 ETF", "US Equity"],
  ["VTI", "Vanguard Total Stock Market ETF", "US Equity"],
  ["VTIP", "Vanguard Short-Term Inflation-Protected Securities ETF", "Bond"],
  ["VTP", "Vanguard Total Inflation-Protected Securities ETF", "Bond"],
  ["VTV", "Vanguard Value ETF", "US Equity"],
  ["VTWG", "Vanguard Russell 2000 Growth ETF", "US Equity"],
  ["VTWO", "Vanguard Russell 2000 ETF", "US Equity"],
  ["VTWV", "Vanguard Russell 2000 Value ETF", "US Equity"],
  ["VUG", "Vanguard Growth ETF", "US Equity"],
  ["VUSB", "Vanguard Ultra-Short Bond ETF", "Bond"],
  ["VUSG", "Vanguard Wellington U.S. Growth Active ETF", "US Equity"],
  ["VUSV", "Vanguard Wellington U.S. Value Active ETF", "US Equity"],
  ["VV", "Vanguard Large-Cap ETF", "US Equity"],
  ["VWO", "Vanguard FTSE Emerging Markets ETF", "International Equity"],
  ["VWOB", "Vanguard Emerging Markets Government Bond ETF", "Bond"],
  ["VXF", "Vanguard Extended Market ETF", "US Equity"],
  ["VXUS", "Vanguard Total International Stock ETF", "International Equity"],
  ["VYM", "Vanguard High Dividend Yield ETF", "US Equity"],
  ["VYMI", "Vanguard International High Dividend Yield ETF", "International Equity"],
] as const;

// ---------------------------------------------------------------------------
// Controls: strict parsing of the resolved (string) control values
// ---------------------------------------------------------------------------

export type Range = { min: number; max: number; source: string };
export type ReturnPeriod = "YTD" | "1Y" | "3Y" | "5Y" | "10Y";
const RETURN_PERIODS: readonly ReturnPeriod[] = ["YTD", "1Y", "3Y", "5Y", "10Y"];
const AUM_PRESETS = {
  nano: { min: 0, max: 10_000_000 },
  micro: { min: 10_000_000, max: 300_000_000 },
  small: { min: 300_000_000, max: 2_000_000_000 },
  mid: { min: 2_000_000_000, max: 10_000_000_000 },
  large: { min: 10_000_000_000, max: Number.POSITIVE_INFINITY },
} as const;
type AumPreset = keyof typeof AUM_PRESETS;
const AMOUNT_SUFFIXES: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

export type UpdaterConfig = {
  maxFetches: number;
  requestSleepSeconds: number;
  concurrency: number;
  tickers: string[];
  category: string;
  holdingsPageSize: number;
  historyPageSize: number;
  maxRetries: number;
  historyRange: string;
  secUa: string;
  skipYahoo: boolean;
  edgarFallback: boolean;
  aumRange?: Range;
  terRange?: Range;
  dividendYieldRange?: Range;
  secYieldRange?: Range;
  performanceRanges: Partial<Record<ReturnPeriod, Range>>;
  totalReturnRanges: Partial<Record<ReturnPeriod, Range>>;
};

function parseInteger(label: string, raw: string | undefined, min: number, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const text = raw.trim();
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) < min) throw new Error(`${label}: expected integer >= ${min}`);
  return Number(text);
}

function parseMaxRetries(raw: string | undefined): number {
  const value = parseInteger("MAX_RETRIES", raw, 1, 2);
  if (value > 5) throw new Error("MAX_RETRIES: expected integer between 1 and 5");
  return value;
}

function parseBoolean(label: string, raw: string | undefined, fallback: boolean): boolean {
  const text = (raw ?? "").trim();
  if (!text) return fallback;
  if (/^(1|true|yes|y|on)$/i.test(text)) return true;
  if (/^(0|false|no|n|off)$/i.test(text)) return false;
  throw new Error(`${label}: expected boolean`);
}

export function parseHistoryRange(raw: string | undefined): string {
  const text = (raw ?? "").trim();
  if (!text) return "max";
  if (!/^(max|[1-9]\d*y)$/i.test(text)) throw new Error("HISTORY_RANGE: use max or Ny (e.g. 5y)");
  return text.toLowerCase();
}

export function parseRange(raw: string | undefined, label = "range"): Range | undefined {
  const text = cleanText(raw);
  if (!text || text === ":") return undefined;
  const parts = text.split(":");
  if (parts.length !== 2) throw new Error(`${label}: expected min:max with exactly one colon`);
  const bound = (value: string, lower: boolean): number => {
    const cleaned = value.replace(/[$,%\s]/g, "");
    if (!cleaned) return lower ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed)) throw new Error(`${label}: invalid numeric bound ${value}`);
    return parsed;
  };
  const range = { min: bound(parts[0], true), max: bound(parts[1], false), source: text };
  if (range.min > range.max) throw new Error(`${label}: minimum exceeds maximum`);
  return range;
}

function parseAumBound(raw: string): number | undefined {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (!cleaned) return undefined;
  const match = /^(-?\d+(?:\.\d+)?)([KMBT])?$/i.exec(cleaned);
  if (!match) throw new Error(`AUM: invalid bound ${raw}`);
  return Number(match[1]) * (match[2] ? AMOUNT_SUFFIXES[match[2].toUpperCase()] : 1);
}

export function parseAumRange(raw: string | undefined): Range | undefined {
  const text = cleanText(raw);
  if (!text || text === ":") return undefined;
  const wholePreset = AUM_PRESETS[text.toLowerCase() as AumPreset];
  if (wholePreset) return { ...wholePreset, source: text };
  const parts = text.split(":");
  if (parts.length !== 2) throw new Error("AUM: expected min:max with exactly one colon");
  const left = AUM_PRESETS[parts[0].replace(/[$,\s]/g, "").toLowerCase() as AumPreset];
  const right = AUM_PRESETS[parts[1].replace(/[$,\s]/g, "").toLowerCase() as AumPreset];
  const min = left ? left.min : (parseAumBound(parts[0]) ?? Number.NEGATIVE_INFINITY);
  const max = right ? right.max : (parseAumBound(parts[1]) ?? Number.POSITIVE_INFINITY);
  if (min > max) throw new Error("AUM: minimum exceeds maximum");
  return { min, max, source: text };
}

function parseReturnRanges(controls: Record<string, string | undefined>, prefix: "PERFORMANCE" | "TOTAL_RETURN") {
  const result: Partial<Record<ReturnPeriod, Range>> = {};
  for (const period of RETURN_PERIODS) {
    const range = parseRange(controls[`${prefix}_${period}`], `${prefix}_${period}`);
    if (range) result[period] = range;
  }
  return result;
}

export function readConfig(controls: Record<string, string | undefined> = {}): UpdaterConfig {
  const sleepText = (controls.REQUEST_SLEEP ?? "").trim();
  if (sleepText && (!Number.isFinite(Number(sleepText)) || Number(sleepText) < 0)) throw new Error("REQUEST_SLEEP: expected nonnegative seconds");
  return {
    maxFetches: parseInteger("MAX_FETCHES", controls.MAX_FETCHES, 0, 0),
    requestSleepSeconds: sleepText ? Number(sleepText) : 0,
    concurrency: parseInteger("CONCURRENCY", controls.CONCURRENCY, 1, 4),
    tickers: (controls.TICKERS ?? "").split(/[\s,;]+/).filter(Boolean).map((x) => x.toUpperCase()),
    category: cleanText(controls.CATEGORY),
    holdingsPageSize: parseInteger("HOLDINGS_PAGE_SIZE", controls.HOLDINGS_PAGE_SIZE, 1, 250),
    historyPageSize: parseInteger("HISTORY_PAGE_SIZE", controls.HISTORY_PAGE_SIZE, 1, 1000),
    maxRetries: parseMaxRetries(controls.MAX_RETRIES),
    historyRange: parseHistoryRange(controls.HISTORY_RANGE),
    secUa: (controls.SEC_UA ?? "").trim() || DEFAULT_SEC_UA,
    skipYahoo: parseBoolean("SKIP_YAHOO", controls.SKIP_YAHOO, false),
    edgarFallback: parseBoolean("EDGAR_FALLBACK", controls.EDGAR_FALLBACK, true),
    aumRange: parseAumRange(controls.AUM),
    terRange: parseRange(controls.TER, "TER"),
    dividendYieldRange: parseRange(controls.DIVIDEND_YIELD, "DIVIDEND_YIELD"),
    secYieldRange: parseRange(controls.SEC_YIELD, "SEC_YIELD"),
    performanceRanges: parseReturnRanges(controls, "PERFORMANCE"),
    totalReturnRanges: parseReturnRanges(controls, "TOTAL_RETURN"),
  };
}

// Active run configuration (set by run(); defaults apply to direct helper calls and tests).
let activeConfig: UpdaterConfig = readConfig({});

export function hasDeferredFilters(config: UpdaterConfig): boolean {
  return Boolean(config.aumRange || config.terRange || config.dividendYieldRange || config.secYieldRange ||
    Object.keys(config.performanceRanges).length || Object.keys(config.totalReturnRanges).length);
}

/** Numeric dollar amount from Vanguard strings such as "$1.0T", "$123.4 B" or "1234567". */
export function parseAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const match = /^(-?\d+(?:\.\d+)?)([KMBT])?$/i.exec(String(value ?? "").replace(/[$,\s]/g, ""));
  if (!match) return null;
  return Number(match[1]) * (match[2] ? AMOUNT_SUFFIXES[match[2].toUpperCase()] : 1);
}

export type FilterMetrics = {
  aum: number | null;
  ter: number | null;
  dividendYield: number | null;
  secYield: number | null;
  performance: Partial<Record<ReturnPeriod, number | null>>;
  totalReturn: Partial<Record<ReturnPeriod, number | null>>;
};

function withinRange(value: number | null | undefined, range: Range | undefined, missingPasses = false): boolean {
  if (!range) return true;
  if (value === null || value === undefined || !Number.isFinite(value)) return missingPasses;
  return value >= range.min && value <= range.max;
}

/** AUM, TER and yield filters drop funds without the value; return filters keep funds whose return is unavailable. */
export function passesMetricFilters(metrics: FilterMetrics, config: UpdaterConfig): boolean {
  if (!withinRange(metrics.aum, config.aumRange)) return false;
  if (!withinRange(metrics.ter, config.terRange)) return false;
  if (!withinRange(metrics.dividendYield, config.dividendYieldRange)) return false;
  if (!withinRange(metrics.secYield, config.secYieldRange)) return false;
  for (const period of RETURN_PERIODS) {
    if (!withinRange(metrics.performance[period], config.performanceRanges[period], true)) return false;
    if (!withinRange(metrics.totalReturn[period], config.totalReturnRanges[period], true)) return false;
  }
  return true;
}

export type BatchState = { cursor?: unknown; tickers?: unknown } | null;

/** MAX_FETCHES batch: 0 selects every fund, a positive value resumes at the saved cursor and wraps to 0 after the last fund. */
export function selectBatch<T extends readonly [string, ...unknown[]]>(
  funds: readonly T[],
  maxFetches: number,
  state: BatchState,
): { selected: T[]; startCursor: number; nextCursor: number | null } {
  if (maxFetches <= 0) return { selected: [...funds], startCursor: 0, nextCursor: null };
  const tickers = funds.map((fund) => fund[0]);
  const prior = Array.isArray(state?.tickers) ? (state!.tickers as unknown[]).map(String) : [];
  const saved = numberOrNull(state?.cursor) ?? 0;
  const sameScope = tickers.length === prior.length && tickers.every((ticker, index) => ticker === prior[index]);
  const startCursor = sameScope && tickers.length ? Math.min(Math.max(0, Math.floor(saved)), tickers.length - 1) : 0;
  const selected = funds.slice(startCursor, startCursor + maxFetches);
  const nextCursor = tickers.length && startCursor + selected.length < tickers.length ? startCursor + selected.length : 0;
  return { selected, startCursor, nextCursor };
}

/** First epoch second of the Yahoo request window: `max` -> 0, `Ny` -> N years before now. */
export function historyWindowStartEpoch(historyRange: string, nowEpochSeconds: number): number {
  const years = /^([1-9]\d*)y$/i.exec(historyRange.trim());
  return years ? Math.max(0, Math.floor(nowEpochSeconds - Number(years[1]) * 365.25 * 86_400)) : 0;
}

/** Always explicit period1/period2 with interval=1d: Yahoo answers `range=max` with monthly bars, never daily. `max` starts at epoch 0. */
export function yahooChartUrl(ticker: string, historyRange = "max", nowEpochSeconds = Math.floor(Date.now() / 1000)): string {
  const query = new URLSearchParams({
    period1: String(historyWindowStartEpoch(historyRange, nowEpochSeconds)),
    period2: String(Math.floor(nowEpochSeconds)),
    interval: "1d",
    events: "div,splits",
    includeAdjustedClose: "true",
  });
  return `${YAHOO_CHART_URL}/${ticker}?${query.toString()}`;
}

/** ISO date of the first published history row for the range, or "" for `max`. */
export function historyWindowStartDate(historyRange: string, nowEpochSeconds: number): string {
  return historyRange === "max" ? "" : new Date(historyWindowStartEpoch(historyRange, nowEpochSeconds) * 1000).toISOString().slice(0, 10);
}

export function passesStaticFilters(fund: readonly [string, string, string], config: UpdaterConfig): boolean {
  if (config.tickers.length && !config.tickers.includes(fund[0])) return false;
  if (config.category && !fund[2].toLowerCase().includes(config.category.toLowerCase())) return false;
  return true;
}
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// One paced request lane per worker. The slot is reserved synchronously BEFORE awaiting, so
// concurrent callers can never pick the same slot (REQUEST_SLEEP seconds between request starts per lane).
let requestLanes: number[] = [0];
let laneSleepMs = 0;
export function configureLanes(concurrency: number, sleepSeconds: number): void {
  requestLanes = new Array(Math.max(1, concurrency)).fill(0);
  laneSleepMs = Math.max(0, sleepSeconds * 1000);
}
export async function paceRequest(clock: () => number = Date.now, pause: (ms: number) => Promise<void> = sleep): Promise<void> {
  const now = clock();
  let lane = 0;
  for (let i = 1; i < requestLanes.length; i += 1) if (requestLanes[i] < requestLanes[lane]) lane = i;
  const start = Math.max(now, requestLanes[lane]);
  requestLanes[lane] = start + laneSleepMs;
  if (start > now) await pause(start - now);
}
export const REQUEST_TIMEOUT_MS = 45_000;
const TRANSIENT_STATUSES = [408, 425, 429, 500, 502, 503, 504];
/** Every network call: paced lane, 45 s timeout covering headers and body, MAX_RETRIES retries on network errors and transient statuses. */
export async function httpFetch(url: string, init: RequestInit = {}, retries: number = activeConfig.maxRetries): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    await paceRequest();
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (response.ok || !TRANSIENT_STATUSES.includes(response.status) || attempt >= retries) return response;
      await response.body?.cancel();
    } catch (error) {
      if (attempt >= retries) throw error;
    }
    await sleep(Math.min(30_000, 2 ** attempt * 1000));
  }
}
async function writeAtomic(url: URL, text: string): Promise<void> {
  const tmp = new URL(`${url.href}.tmp-${process.pid}`);
  await writeFile(tmp, text);
  await rename(tmp, url);
}
async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  const response = await httpFetch(url, { headers: { "User-Agent": UA, ...headers } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.json();
}
function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/^vanguard\s+/, "vanguard-")
    .replace(/s&p/g, "sp")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+$/g, "");
}
function findMetric(text: string, label: string, percent = false) {
  const index = text.toLowerCase().indexOf(label.toLowerCase());
  if (index < 0) return null;
  const window = text.slice(index, index + 320);
  const asOf = window.match(/as of\s+(\d{2}\/\d{2}\/\d{4})/i)?.[1] ?? null;
  const value = percent ? window.match(/([+-]?[\d.]+)%/)?.[1] ?? null : window.match(/\$([\d,]+\s*[BM])/i)?.[1] ?? null;
  return value ? { value, asOf } : null;
}

// ---------------------------------------------------------------------------
// Small pure helpers (shared by holdings / distributions / history shaping)
// ---------------------------------------------------------------------------

function cleanText(value: unknown): string {
  return String(value ?? "")
    .replace(/®/g, "") // ®
    .replace(/™/g, "") // ™
    .replace(/\s+/g, " ")
    .trim();
}

export function numberOrNull(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value ?? "").trim().replace(/[$,%\s]/g, "").replace(/,/g, "");
  if (!text || text === "-" || text === "—") return null;
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function toIsoDate(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const mdy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function sanitizeTicker(value: unknown): string {
  return String(value ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function paymentsPerYear(frequency: unknown): number | null {
  const normalized = String(frequency ?? "").trim().toLowerCase();
  if (normalized === "monthly") return 12;
  if (normalized === "quarterly") return 4;
  if (normalized === "semi-annual" || normalized === "semi-annually" || normalized === "semiannual") return 2;
  if (normalized === "annual" || normalized === "annually") return 1;
  return null;
}

async function getPortId(ticker: string): Promise<string | null> {
  const url = `https://advisors.vanguard.com/investments/products/${ticker.toLowerCase()}`;
  try {
    const res = await httpFetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" } });
    if (!res.ok) return null;
    const txt = await res.text();
    const m = txt.match(/"portId"\s*:\s*"([^"]+)"/);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

async function fetchWorkplaceFundDetails(portId: string) {
  const url = `https://workplace.vanguard.com/investments/product-details/fund/api/fundDetails?portIds=${portId}`;
  try {
    const res = await httpFetch(url, {
      headers: {
        "User-Agent": UA,
        Referer: `https://workplace.vanguard.com/investments/product-details/fund/${portId}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    return data;
  } catch (e) {
    outputNote(`[ ${'workplace'.padEnd(9)}] ${portId} ${e}`);
    return null;
  }
}

async function officialProfile(ticker: string, name: string) {
  const advisorUrl = `https://advisors.vanguard.com/investments/products/${ticker.toLowerCase()}/${slug(name)}`;
  let portId: string | null = null;
  let hero: any = null;
  let managed: any = null;
  let fees: any = null;
  let productDetails: any = null;
  let text = "";
  let raw = "";

  // Step 1: get advisor page for portId and fallback metrics
  try {
    const response = await httpFetch(advisorUrl, {
      headers: { "User-Agent": UA, Accept: "text/html" },
    });
    if (response.ok) {
      raw = await response.text();
      text = raw.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
      const embedded = (key: string) => {
        const match = raw.match(new RegExp(`window\\.${key}\\s*=\\s*(\\{.*?\\});`, "s"));
        if (!match) return null;
        try {
          return JSON.parse(match[1]);
        } catch {
          try {
            const start = raw.indexOf(`window.${key}`);
            const braceStart = raw.indexOf("{", start);
            let depth = 0;
            let end = -1;
            for (let i = braceStart; i < raw.length; i++) {
              if (raw[i] === "{") depth++;
              else if (raw[i] === "}") {
                depth--;
                if (depth === 0) {
                  end = i;
                  break;
                }
              }
            }
            if (end > 0) {
              const jsonStr = raw.slice(braceStart, end + 1);
              return JSON.parse(jsonStr);
            }
          } catch {}
          return null;
        }
      };
      hero = embedded("__HERO_STATS__");
      managed = embedded("__MANAGED_ASSETS__");
      fees = embedded("__FEES_AND_EXPENSE__");
      productDetails = embedded("__PRODUCT_DETAILS__") || embedded("__PRODUCT_DETAILS") || null;
      // try portId from raw
      const m = raw.match(/"portId"\s*:\s*"([^"]+)"/);
      if (m) portId = m[1];
    }
  } catch (e) {
    outputNote(`[ ${'official'.padEnd(9)}] ${ticker} ${e}`);
  }

  // If still no portId, try direct advisors products page (without slug)
  if (!portId) {
    portId = await getPortId(ticker);
  }

  // Step 2: fetch workplace fundDetails API (primary source for yields and assets)
  let workplace: any = null;
  if (portId) {
    workplace = await fetchWorkplaceFundDetails(portId);
  }

  // Parse workplace data
  let wpNetAssets: { value: string | null; asOf: string | null } | null = null;
  let wpTotalAssets: { value: string | null; asOf: string | null } | null = null;
  let wpExpense: { value: string | null; asOf: string | null } | null = null;
  let wpDividend: { value: string | null; asOf: string | null } | null = null;
  let wpSec: { value: string | null; asOf: string | null } | null = null;
  let wpYtd: { value: string | null; asOf: string | null } | null = null;

  if (workplace?.investmentsData?.body) {
    const body = workplace.investmentsData.body;
    const yields = body.yields?.funds ?? {};
    const assets = body.assets ?? {};
    const market = workplace.marketData?.body;

    // assets: { totalAssets: {amount, asOfDate}, shareClassAssets: {amount, asOfDate} }
    if (assets.totalAssets?.amount) {
      wpTotalAssets = { value: `$${assets.totalAssets.amount}`, asOf: assets.totalAssets.asOfDate ?? null };
    }
    if (assets.shareClassAssets?.amount) {
      wpNetAssets = { value: `$${assets.shareClassAssets.amount}`, asOf: assets.shareClassAssets.asOfDate ?? null };
    }
    // fallback to valuationAnalytics if assets missing
    if (!wpNetAssets && body.valuationAnalytics?.content?.[0]?.assets) {
      const arr = body.valuationAnalytics.content[0].assets;
      const tna = arr.find((a: any) => a.assetTypeCode === "TNA");
      const aum = arr.find((a: any) => a.assetTypeCode === "AUM");
      if (tna) wpNetAssets = { value: `$${tna.fundAssetAmount}`, asOf: tna.effectiveDate ?? null };
      if (aum) wpTotalAssets = { value: `$${aum.fundAssetAmount}`, asOf: aum.effectiveDate ?? null };
    }

    // expense ratio
    if (market?.feeExpenses?.[0]?.expenseRatio?.percent) {
      wpExpense = {
        value: market.feeExpenses[0].expenseRatio.percent,
        asOf: market.feeExpenses[0].expenseRatio.asOfDate ?? null,
      };
    }

    // dividend / distribution / SEC
    // SEC-Yield, Dividend, Distribution
    const secObj = yields["SEC-Yield"];
    if (secObj?.percent) {
      wpSec = { value: secObj.percent, asOf: secObj.effectiveDate ?? null };
    }
    const divObj = yields["Dividend"] ?? yields["Distribution"];
    if (divObj?.percent) {
      wpDividend = { value: divObj.percent, asOf: divObj.effectiveDate ?? null };
    }

    // ytd from market performance
    if (market?.performance?.ytdReturnDailyPercentage != null) {
      wpYtd = {
        value: String(market.performance.ytdReturnDailyPercentage),
        asOf: market.performance.ytdReturnDailyAsOfDate ?? null,
      };
    }
  }

  // Vanguard's own payout-cadence label. Independent of the investmentsData.body
  // block above — it lives under marketData.body.fundCharacteristics instead.
  const distributionFrequency: string | null =
    workplace?.marketData?.body?.fundCharacteristics?.fundDistributionFrequency ?? null;

  // Fallback to advisor parsing if workplace missing
  const assetsFmt = (amount: number | undefined) => (amount == null ? null : `$${(amount / 1e9).toFixed(1)} B`);
  const netAssets = wpTotalAssets ??
    (managed ? { value: assetsFmt(managed.assetsUnderManagementData?.amount), asOf: managed.assetsUnderManagementData?.effectiveDate ?? null } : findMetric(text, "Total net assets"));
  const etfAssets = wpNetAssets ??
    (managed ? { value: assetsFmt(managed.fundNetAssetsData?.amount), asOf: managed.fundNetAssetsData?.effectiveDate ?? null } : findMetric(text, `Net assets for ${ticker}`));
  const expense = wpExpense ??
    (hero?.adjustedExpenseRatio ? { value: hero.adjustedExpenseRatio.value, asOf: hero.adjustedExpenseRatio.effectiveDate } : fees?.adjustedExpenseRatio ? { value: fees.adjustedExpenseRatio.value, asOf: fees.adjustedExpenseRatio.effectiveDate } : findMetric(text, "Expense ratio", true));
  const dividend = wpDividend ??
    (hero?.dividendYield ? { value: hero.dividendYield.value, asOf: hero.dividendYield.effectiveDate } : findMetric(text, "Dividend yield", true) || findMetric(text, "Distribution yield", true));
  let sec: any = wpSec;
  if (!sec) {
    if (hero?.secYield) sec = { value: hero.secYield.value, asOf: hero.secYield.effectiveDate };
    else if (productDetails?.secYield) sec = { value: productDetails.secYield.value, asOf: productDetails.secYield.effectiveDate };
    else sec = findMetric(text, "30-day SEC yield", true) || findMetric(text, "30 day SEC yield", true) || findMetric(text, "SEC yield", true);
  }
  const ytd = wpYtd ?? (hero?.ytdReturn ? { value: String(hero.ytdReturn.value), asOf: hero.ytdReturn.effectiveDate } : findMetric(text, "YTD Returns (NAV)", true));
  const oneYear = hero?.oneYearReturn ? { value: String(hero.oneYearReturn.value), asOf: hero.oneYearReturn.effectiveDate } : findMetric(text, "1 YR Returns (NAV)", true);

  const wpBody = workplace?.marketData?.body;
  const wpCusip = typeof wpBody?.fundIdentifiers?.cusip === "string" && /^[0-9A-Z]{9}$/i.test(wpBody.fundIdentifiers.cusip) ? wpBody.fundIdentifiers.cusip.toUpperCase() : null;
  const wpInception = /^\d{4}-\d{2}-\d{2}$/.test(String(wpBody?.fundCharacteristics?.fundInceptionDate ?? "")) ? String(wpBody.fundCharacteristics.fundInceptionDate) : null;
  const wpExchange = typeof wpBody?.exchange === "string" && wpBody.exchange.trim() ? wpBody.exchange.trim() : null;
  // ok: at least one official page answered; a fund whose official profile is unreachable keeps its published state
  const ok = workplace !== null || raw !== "";
  return { url: advisorUrl, ok, netAssets, etfAssets, expense, dividend, sec, ytd, oneYear, portId, distributionFrequency, workplaceRaw: workplace ? true : false, cusip: wpCusip, inceptionDate: wpInception, exchange: wpExchange };
}

export type ChartDividend = { epoch: number; amount: number };

async function chart(ticker: string): Promise<{ rows: any[]; dividends: ChartDividend[]; ok: boolean }> {
  if (activeConfig.skipYahoo) return { rows: [], dividends: [], ok: true };
  const url = yahooChartUrl(ticker, activeConfig.historyRange);
  try {
    const data = await fetchJson(url, { Accept: "*/*" });
    const result = data.chart?.result?.[0];
    const timestamps = result?.timestamp ?? [];
    const q = result?.indicators?.quote?.[0] ?? {};
    const adj = result?.indicators?.adjclose?.[0]?.adjclose ?? [];
    const rows = timestamps
      .map((time: number, i: number) => ({
        date: new Date(time * 1000).toISOString().slice(0, 10),
        open: q.open?.[i] ?? null,
        high: q.high?.[i] ?? null,
        low: q.low?.[i] ?? null,
        close: q.close?.[i] ?? null,
        // Yahoo recomputes the split/dividend-adjusted close on every
        // request; the raw float jitters in the last digit or two between
        // otherwise identical requests, making every history row (and the
        // fund) look "updated" on every single run. Round to 2 decimals,
        // well past any meaningful price precision, to absorb that jitter.
        adjClose: typeof (adj[i] ?? q.close?.[i]) === "number" ? round(adj[i] ?? q.close?.[i], 2) : null,
        volume: q.volume?.[i] ?? null,
      }))
      .filter((row: any) => row.close !== null);
    const dividends: ChartDividend[] = [];
    for (const [keyEpoch, item] of Object.entries(result?.events?.dividends ?? {})) {
      const amount = numberOrNull((item as any)?.amount);
      // Yahoo key epoch is declaration date; inner `date` is true ex-date (~21d later)
      const inner = (item as any)?.date;
      const epoch = typeof inner === "number" && Number.isFinite(inner) ? inner : Number(keyEpoch);
      if (amount !== null && Number.isFinite(epoch)) dividends.push({ epoch, amount });
    }
    dividends.sort((a, b) => a.epoch - b.epoch);
    return { rows, dividends, ok: rows.length > 0 };
  } catch (error) {
    outputNote(`[ ${'history'.padEnd(9)}] ${ticker} ${error}`);
    return { rows: [], dividends: [], ok: false };
  }
}

/**
 * One calendar date's worth of Vanguard's own official NAV / market-price /
 * premium-discount data, merged from `historicalPrice` (NAV only) and
 * `premiumDiscountDetails` (NAV + market price + premium/discount %) — the
 * two other top-level keys of the same `…/irr/funds/profile/{TICKER}-
 * AdditionalFundData` response `parseVanguardHoldingDetails` already reads
 * for holdings. See `parseVanguardOfficialHistory`.
 */
export type OfficialPricePoint = {
  date: string;
  nav: number | null;
  marketPrice: number | null;
  premiumDiscountPct: number | null;
};

/**
 * Parses the `historicalPrice` and `premiumDiscountDetails` blocks of the
 * AdditionalFundData response into one official NAV/market-price/premium-
 * discount point per calendar date, sorted ascending.
 *
 * `historicalPrice` is `{ ticker, "3m"|"6m"|"1Y"|"3Y"|"5Y"|"10Y": { nav: [{
 * asOfDate: "MM/DD/YYYY", price: "$123.45" }] } }` — NAV only. The 3m/6m/1Y
 * windows are true daily trading-day series (each nested inside the next);
 * 3Y/5Y/10Y are month-end only (36/60/120 points). Verified live against
 * VOO and BND on 2026-09-24.
 *
 * `premiumDiscountDetails` is an array of ~6 overlapping buckets (current
 * quarter-to-date, the prior four quarters, and one full prior-calendar-year
 * bucket that duplicates two of those quarters), each
 * `{ pdDetails: [{ nav, marketPrice, premiumDiscountPercentage,
 * premiumDiscountAmount, effectiveDate: "MM/DD/YYYY" }], periodQualifier,
 * prdLabel, asOfDt }` — true daily, covering roughly the trailing 21 months,
 * and carrying NAV *and* market price *and* the premium/discount percentage
 * for the same date. Duplicate dates across overlapping buckets carry
 * identical values, so last-write-wins de-duplication is safe.
 *
 * Where both blocks cover the same date, `premiumDiscountDetails` wins for
 * NAV too (it is at least as fresh and additionally confirms the market
 * price), but either source alone is sufficient.
 */
export function parseVanguardOfficialHistory(data: any): OfficialPricePoint[] {
  const root = data && typeof data === "object" ? data : null;
  if (!root) return [];
  const points = new Map<string, OfficialPricePoint>();

  const historicalPrice = (root as any).historicalPrice;
  if (historicalPrice && typeof historicalPrice === "object") {
    for (const key of ["10Y", "5Y", "3Y", "1Y", "6m", "3m"]) {
      const nav = (historicalPrice as any)[key]?.nav;
      if (!Array.isArray(nav)) continue;
      for (const item of nav) {
        const date = toIsoDate(item?.asOfDate);
        const value = numberOrNull(item?.price);
        if (!date || value === null) continue;
        const existing = points.get(date);
        points.set(date, {
          date,
          nav: value,
          marketPrice: existing?.marketPrice ?? null,
          premiumDiscountPct: existing?.premiumDiscountPct ?? null,
        });
      }
    }
  }

  const premiumDiscountDetails = (root as any).premiumDiscountDetails;
  if (Array.isArray(premiumDiscountDetails)) {
    for (const bucket of premiumDiscountDetails) {
      const details = (bucket as any)?.pdDetails;
      if (!Array.isArray(details)) continue;
      for (const item of details) {
        const date = toIsoDate(item?.effectiveDate);
        if (!date) continue;
        const nav = numberOrNull(item?.nav);
        const marketPrice = numberOrNull(item?.marketPrice);
        const premiumDiscountPct = numberOrNull(item?.premiumDiscountPercentage);
        const existing = points.get(date);
        points.set(date, {
          date,
          nav: nav ?? existing?.nav ?? null,
          marketPrice: marketPrice ?? existing?.marketPrice ?? null,
          premiumDiscountPct: premiumDiscountPct ?? existing?.premiumDiscountPct ?? null,
        });
      }
    }
  }

  return [...points.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Maps internal (lowercase-keyed) Yahoo OHLCV rows and Vanguard's official
 * NAV/market-price/premium-discount points to the exact header-keyed shape
 * the static pages store. Page rows MUST be keyed by the literal header
 * strings (same contract as the SPDR / WisdomTree feeds) — the table renderer
 * looks values up by header, so lowercase keys render as empty cells.
 *
 * House policy: official issuer data wins whenever it exists for a date.
 * Yahoo is strictly supplementary — it is the only source for OHLC/Volume
 * (the official feed never carries those), and it is the sole source for any
 * date the official windows don't cover at all. Rows are merged by calendar
 * date (a union, not an overwrite), and each row is stamped with a `Source`
 * of `"vanguard-official"` (NAV/market-price/premium-discount present for
 * that date) or `"yahoo-fallback"` (no official coverage for that date, so
 * only whatever Yahoo has — typically OHLCV — is present).
 */
export function historyPageRows(rows: any[], officialHistory: OfficialPricePoint[] = []): Record<string, unknown>[] {
  const byDate = new Map<string, Record<string, unknown>>();
  for (const row of rows ?? []) {
    const date = row?.date ?? row?.Date ?? null;
    if (!date) continue;
    byDate.set(date, {
      Date: date,
      Open: row?.open ?? row?.Open ?? null,
      High: row?.high ?? row?.High ?? null,
      Low: row?.low ?? row?.Low ?? null,
      Close: row?.close ?? row?.Close ?? null,
      "Adj Close": row?.adjClose ?? row?.["Adj Close"] ?? null,
      Volume: row?.volume ?? row?.Volume ?? null,
      NAV: null,
      "Market Price": null,
      "Premium/Discount (%)": null,
      Source: "yahoo-fallback",
    });
  }
  for (const point of officialHistory ?? []) {
    if (!point?.date) continue;
    const existing = byDate.get(point.date) ?? {
      Date: point.date,
      Open: null,
      High: null,
      Low: null,
      Close: null,
      "Adj Close": null,
      Volume: null,
      NAV: null,
      "Market Price": null,
      "Premium/Discount (%)": null,
      Source: "yahoo-fallback",
    };
    byDate.set(point.date, {
      ...existing,
      NAV: point.nav ?? existing.NAV ?? null,
      "Market Price": point.marketPrice ?? existing["Market Price"] ?? null,
      "Premium/Discount (%)": point.premiumDiscountPct ?? existing["Premium/Discount (%)"] ?? null,
      Source: "vanguard-official",
    });
  }
  return [...byDate.values()].sort((a: any, b: any) => (a.Date < b.Date ? -1 : a.Date > b.Date ? 1 : 0));
}

/**
 * Reconstructs official NAV/market-price/premium-discount points from a
 * previously written History page (used when this run's AdditionalFundData
 * fetch fails but a prior run's official data is still on disk).
 */
function officialPointsFromPreviousRows(rows: any[]): OfficialPricePoint[] {
  return (rows ?? [])
    .filter((row: any) => row?.NAV != null || row?.["Market Price"] != null || row?.["Premium/Discount (%)"] != null)
    .map((row: any) => ({
      date: String(row?.Date ?? row?.date ?? ""),
      nav: numberOrNull(row?.NAV),
      marketPrice: numberOrNull(row?.["Market Price"]),
      premiumDiscountPct: numberOrNull(row?.["Premium/Discount (%)"]),
    }))
    .filter((point: OfficialPricePoint) => point.date);
}

export function internalHistoryRows(pageRows: any[]): any[] {
  return (pageRows ?? [])
    .map((row: any) => ({
      date: row?.Date ?? row?.date ?? null,
      open: numberOrNull(row?.Open ?? row?.open),
      high: numberOrNull(row?.High ?? row?.high),
      low: numberOrNull(row?.Low ?? row?.low),
      close: numberOrNull(row?.Close ?? row?.close),
      adjClose: numberOrNull(row?.["Adj Close"] ?? row?.adjClose ?? row?.Close ?? row?.close),
      volume: numberOrNull(row?.Volume ?? row?.volume),
    }))
    .filter((row: any) => row.date && row.close !== null);
}

/**
 * Builds the Distributions worksheet rows (latest first) in the same
 * array-row shape the SPDR feed uses. Yahoo dividend events only carry the
 * ex-date and the per-share amount; record/payable dates and capital gains
 * are not published there and stay "—" placeholders.
 */
export function distributionRows(frequency: unknown, dividends: ChartDividend[]): string[][] {
  const label = String(frequency ?? "").trim() || "—";
  return [...(dividends ?? [])]
    .sort((a, b) => b.epoch - a.epoch)
    .map((item) => [
      label,
      new Date(item.epoch * 1000).toISOString().slice(0, 10),
      "—",
      "—",
      String(item.amount),
      "—",
      "—",
    ]);
}

function dividendsFromPrevious(meta: any): ChartDividend[] {
  const rows = meta?.distributions?.rows;
  if (!Array.isArray(rows)) return [];
  const out: ChartDividend[] = [];
  for (const row of rows) {
    const cells = Array.isArray(row) ? row : [row?.Frequency, row?.["Ex-Date"], null, null, row?.Dividend];
    const epoch = Math.floor(new Date(`${cells[1]}T00:00:00Z`).getTime() / 1000);
    const amount = numberOrNull(cells[4]);
    if (Number.isFinite(epoch) && amount !== null) out.push({ epoch, amount });
  }
  return out.sort((a, b) => a.epoch - b.epoch);
}

function returnSince(rows: any[], years: number, strict = true): number | null {
  if (!rows.length) return null;
  const latest = rows[rows.length - 1];
  const cutoff = new Date(`${latest.date}T00:00:00Z`);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
  // A series that starts after the period (a young fund or a bounded HISTORY_RANGE) cannot give that period: report unavailable instead of a wrong CAGR.
  if (strict && new Date(`${rows[0].date}T00:00:00Z`).getTime() > cutoff.getTime() + 7 * 86_400_000) return null;
  let prior = rows[0];
  for (const row of rows) if (new Date(`${row.date}T00:00:00Z`) <= cutoff) prior = row;
  if (!prior?.adjClose || !latest?.adjClose || prior.adjClose <= 0) return null;
  return ((latest.adjClose / prior.adjClose) ** (1 / years) - 1) * 100;
}
/** Year-to-date return in percent from adjusted closes (last close of the prior calendar year as the base). */
export function ytdFromRows(rows: any[]): number | null {
  if (!rows.length) return null;
  const latest = rows[rows.length - 1];
  const year = String(latest.date).slice(0, 4);
  let base: any = null;
  for (const row of rows) if (String(row.date).slice(0, 4) < year) base = row;
  if (!base?.adjClose || !latest?.adjClose || base.adjClose <= 0) return null;
  return (latest.adjClose / base.adjClose - 1) * 100;
}
export function summary(rows: any[], strict = true) {
  if (!rows.length) return { nav: null, asOfDate: null, totalReturn: {}, performance: {} };
  const latest = rows[rows.length - 1];
  const performance: Record<string, number> = {};
  const totalReturn: Record<string, number> = {};
  for (const years of [1, 3, 5, 10]) {
    const annual = returnSince(rows, years, strict);
    if (annual !== null) {
      performance[`${years}Y`] = annual;
      totalReturn[`${years}Y`] = ((1 + annual / 100) ** years - 1) * 100;
    }
  }
  return { nav: latest.close, asOfDate: latest.date, totalReturn, performance };
}

// ---------------------------------------------------------------------------
// Standard feed shapes (the same catalog row, per-fund meta and metrics object
// in every ETF repo, so one hub app can sort and search all brands alike)
// ---------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-30" -> "Sep 30 2026"; anything that is not an ISO date becomes the "—" placeholder. */
export function formatDisplayDate(iso: unknown): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return match ? `${MONTHS[Number(match[2]) - 1] ?? match[2]} ${match[3]} ${match[1]}` : "—";
}

/** Inverse of formatDisplayDate: "Sep 30 2026" -> "2026-09-30" (no Date parsing, so no timezone shift); "" when unknown. */
export function isoFromDisplayDate(display: unknown): string {
  const match = /^([A-Z][a-z]{2}) (\d{2}) (\d{4})$/.exec(String(display ?? ""));
  const month = match ? MONTHS.indexOf(match[1]) : -1;
  return match && month >= 0 ? `${match[3]}-${String(month + 1).padStart(2, "0")}-${match[2]}` : "";
}

/** "09/01/2026" style date used by the catalog `distributions.exDate`; "—" when unknown. */
export function formatUsDate(iso: unknown): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return match ? `${match[2]}/${match[3]}/${match[1]}` : "—";
}

export function percentText(value: number | null | undefined, minDecimals = 2): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const decimals = (String(round(value, 4)).split(".")[1] ?? "").length;
  return `${value.toFixed(Math.max(minDecimals, decimals))}%`;
}

export function moneyText(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `$${value.toFixed(2)}` : "—";
}

const ID_PLACEHOLDERS = new Set(["", "-", "—"]);

/** Watchlist identifier of a holding: its CUSIP, else its ISIN, else the "—" placeholder. */
export function holdingIdentifier(cusip: unknown, isin: unknown): string {
  for (const value of [cusip, isin]) {
    const text = String(value ?? "").trim();
    if (!ID_PLACEHOLDERS.has(text)) return text;
  }
  return "—";
}

/** Maps a holdings row written under the legacy headers (Weight (%), Shares, Asset Class) onto the standard ones. */
export function standardHoldingRow(row: Record<string, unknown>): Record<string, unknown> {
  if (!("Weight (%)" in row) && !("Shares" in row) && !("Asset Class" in row)) return row;
  const { Coupon, Maturity } = row as any;
  return {
    Name: row.Name ?? "—",
    Ticker: row.Ticker ?? "—",
    Identifier: row.Identifier ?? holdingIdentifier(row.CUSIP, row.ISIN),
    Weight: row["Weight (%)"] ?? row.Weight ?? "—",
    "Market Value": row["Market Value"] ?? "—",
    "Shares Held": row.Shares ?? row["Shares Held"] ?? "—",
    "Asset Category": row["Asset Class"] ?? row["Asset Category"] ?? "—",
    Sector: row.Sector ?? "—",
    Exchange: row.Exchange ?? "—",
    Location: row.Location ?? "—",
    CUSIP: row.CUSIP ?? "—",
    ISIN: row.ISIN ?? "—",
    Currency: row.Currency ?? "—",
    ...(Coupon !== undefined || Maturity !== undefined ? { Coupon: Coupon ?? "-", Maturity: Maturity ?? "-" } : {}),
  };
}

/** Header list of a holdings sheet: the standard headers, plus Coupon and Maturity when any row has them. */
export function standardHoldingHeaders(rows: Record<string, unknown>[]): string[] {
  return rows.some((row) => "Coupon" in row || "Maturity" in row) ? [...HOLDINGS_HEADERS_BASE, "Coupon", "Maturity"] : [...HOLDINGS_HEADERS_BASE];
}

export type LatestQuote = {
  nav: { value: number; date: string } | null;
  price: { value: number; date: string } | null;
  premiumDiscount: number | null;
};

/**
 * Latest NAV, market price and premium/discount of a history sheet (rows keyed by
 * HISTORY_HEADERS, ascending by date). NAV only ever comes from Vanguard's official
 * series; the market price is Vanguard's too and falls back to the last Yahoo close.
 * The premium/discount is the one Vanguard published for the market-price day, never
 * computed across different days.
 */
export function latestQuote(pageRows: Record<string, unknown>[]): LatestQuote {
  let nav: LatestQuote["nav"] = null;
  let official: { value: number; date: string; premium: number | null } | null = null;
  let close: { value: number; date: string } | null = null;
  for (const row of pageRows ?? []) {
    const date = String(row?.Date ?? "");
    if (!date) continue;
    const navValue = numberOrNull(row?.NAV);
    if (navValue !== null) nav = { value: navValue, date };
    const price = numberOrNull(row?.["Market Price"]);
    if (price !== null) official = { value: price, date, premium: numberOrNull(row?.["Premium/Discount (%)"]) };
    const closeValue = numberOrNull(row?.Close);
    if (closeValue !== null) close = { value: closeValue, date };
  }
  const price = official ?? close;
  return { nav, price: price ? { value: price.value, date: price.date } : null, premiumDiscount: official?.premium ?? null };
}

export type MetricsInput = {
  officialYtd: number | null;
  officialOneYear: number | null;
  /** ISO date Vanguard attached to the official figures, if any. */
  officialAsOf: string | null;
  /** Annualized and cumulative returns derived from Yahoo adjusted closes (see `summary`). */
  derived: ReturnType<typeof summary>;
  derivedYtd: number | null;
  dividendYield: number | null;
  secYield: number | null;
};

export type StandardMetrics = {
  ytd: number | null;
  tr1y: number | null;
  tr3y: number | null;
  tr5y: number | null;
  tr10y: number | null;
  cagr3y: number | null;
  cagr5y: number | null;
  cagr10y: number | null;
  siAnn: number | null;
  dividendYield: number | null;
  dividendYieldText: string;
  secYield: number | null;
  secYieldText: string;
  returnsBasis: string;
  performanceAsOf: string | null;
};

const rounded = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? round(value, 2) : null;

function joinWords(items: string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * ytd and tr1y are cumulative total returns in percent (Vanguard's own figure when
 * published, else derived); tr3y/tr5y/tr10y are cumulative and cagr3y/cagr5y/cagr10y
 * annualized, both derived from Yahoo adjusted market-price closes and left null when
 * the history does not cover the period. siAnn is null: no source publishes it here.
 */
export function buildMetrics(input: MetricsInput): StandardMetrics {
  const ytd = rounded(input.officialYtd ?? input.derivedYtd);
  const tr1y = rounded(input.officialOneYear ?? input.derived.totalReturn["1Y"]);
  const longer = [3, 5, 10].map((years) => ({
    total: rounded(input.derived.totalReturn[`${years}Y`]),
    cagr: rounded(input.derived.performance[`${years}Y`]),
  }));
  const official: string[] = [];
  if (input.officialYtd !== null) official.push("YTD");
  if (input.officialOneYear !== null) official.push("1-year");
  const derived: string[] = [];
  if (input.officialYtd === null && ytd !== null) derived.push("YTD");
  if (input.officialOneYear === null && tr1y !== null) derived.push("1-year");
  if (longer.some((item) => item.cagr !== null)) derived.push("3-, 5- and 10-year annualized");
  const returnsBasis = [
    official.length ? `official Vanguard ${joinWords(official)} returns` : "",
    derived.length ? `${joinWords(derived)} returns derived from Yahoo Finance adjusted market-price closes (not NAV)` : "",
  ].filter(Boolean).join("; ") || "unavailable";
  const hasReturns = ytd !== null || tr1y !== null || longer.some((item) => item.cagr !== null);
  const dividendYield = rounded(input.dividendYield);
  const secYield = rounded(input.secYield);
  return {
    ytd,
    tr1y,
    tr3y: longer[0].total,
    tr5y: longer[1].total,
    tr10y: longer[2].total,
    cagr3y: longer[0].cagr,
    cagr5y: longer[1].cagr,
    cagr10y: longer[2].cagr,
    siAnn: null,
    dividendYield,
    dividendYieldText: dividendYield === null ? "—" : `${dividendYield.toFixed(2)}%`,
    secYield,
    secYieldText: secYield === null ? "—" : `${secYield.toFixed(2)}%`,
    returnsBasis,
    performanceAsOf: hasReturns ? (input.officialAsOf || input.derived.asOfDate || null) : null,
  };
}

/** The values the metric filters (AUM, TER, yields, PERFORMANCE_*, TOTAL_RETURN_*) look at, read off the standard catalog fields. */
export function filterMetricsOf(row: { aumValue: number | null; terValue: number | null; metrics: StandardMetrics }): FilterMetrics {
  const m = row.metrics;
  return {
    aum: row.aumValue,
    ter: row.terValue,
    dividendYield: m.dividendYield,
    secYield: m.secYield,
    performance: { YTD: m.ytd, "1Y": m.tr1y, "3Y": m.cagr3y, "5Y": m.cagr5y, "10Y": m.cagr10y },
    totalReturn: { YTD: m.ytd, "1Y": m.tr1y, "3Y": m.tr3y, "5Y": m.tr5y, "10Y": m.tr10y },
  };
}

export type FundInputs = {
  ticker: string;
  name: string;
  category: string;
  officialPage: string | null;
  portId: string | null;
  frequency: string | null;
  distributionRows: string[][];
  netAssets: string | null;
  netAssetsAsOf: string | null;
  totalFundNetAssets: string | null;
  expense: number | null;
  dividendYield: number | null;
  dividendYieldAsOf: string | null;
  secYield: number | null;
  secYieldAsOf: string | null;
  officialYtd: number | null;
  officialOneYear: number | null;
  officialAsOf: string | null;
  cusip?: string | null;
  exchange?: string | null;
  inceptionDate?: string | null;
  /** Yahoo rows (lowercase keys, ascending) the derived returns are computed from. */
  yahooRows: any[];
  /** The merged history sheet as published (header-keyed rows, ascending). */
  pageRows: Record<string, unknown>[];
  holdings: { pages: string[]; pageSize: number; totalRows: number; asOfDate: string | null; source: string };
  history: { pages: string[]; pageSize: number; totalRows: number; asOfDate: string | null; source: string };
};

export function fundMetrics(input: FundInputs): StandardMetrics {
  return buildMetrics({
    officialYtd: input.officialYtd,
    officialOneYear: input.officialOneYear,
    officialAsOf: toIsoDate(input.officialAsOf) || null,
    derived: summary(input.yahooRows),
    derivedYtd: ytdFromRows(input.yahooRows),
    dividendYield: input.dividendYield,
    secYield: input.secYield,
  });
}

const ME_KEYS = ["ytd", "yr1", "yr3", "yr5", "yr10", "sinceInception"] as const;

/** One fund's standard per-fund meta.json and catalog row, built from the same inputs by the updater and by any offline migration. */
export function assembleFund(input: FundInputs): { meta: any; row: any } {
  const { ticker, name, category } = input;
  const metrics = fundMetrics(input);
  const quote = latestQuote(input.pageRows);
  const fundPage = `https://investor.vanguard.com/investment-products/etfs/profile/${ticker.toLowerCase()}`;
  const aumValue = parseAmount(input.netAssets);
  const premium = quote.premiumDiscount;
  const asOf = metrics.performanceAsOf ? formatDisplayDate(metrics.performanceAsOf) : "";
  const returnValues = [metrics.ytd, metrics.tr1y, metrics.cagr3y, metrics.cagr5y, metrics.cagr10y, metrics.siAnn];
  const monthEnd: Record<string, unknown> = { asOfDate: asOf };
  ME_KEYS.forEach((key, index) => { monthEnd[key] = returnValues[index]; });
  const quarterEnd: Record<string, unknown> = { asOfDate: "" };
  ME_KEYS.forEach((key) => { quarterEnd[key] = null; });
  const latestDividend = input.distributionRows[0];
  const meta = {
    ticker,
    name,
    category,
    categoryPath: category,
    source: {
      fundPage,
      catalog: "https://investor.vanguard.com/etf/list (fund list embedded in the updater)",
      officialPage: input.officialPage,
      holdingsDownload: `${VANGUARD_IRR_URL}/${ticker}-AdditionalFundData`,
      holdingsSource: input.holdings.source,
      historySource: input.history.source,
      yahooChart: `${YAHOO_CHART_URL}/${ticker}`,
      provider:
        "Vanguard workplace fundDetails API and investor profile (IRR) data + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance market-history/dividend data",
    },
    providerIds: { fundPage, officialPage: input.officialPage, portId: input.portId },
    legalStructure: null,
    identifiers: { cusip: input.cusip ?? null, isin: isinFromCusip(input.cusip ?? null), indexTicker: null },
    inception: { fundInceptionDate: input.inceptionDate ?? null, shareClassInceptionDate: null, exchange: input.exchange ?? "" },
    expenseRatio: { display: percentText(input.expense), value: input.expense, gross: null, net: input.expense },
    nav: { display: moneyText(quote.nav?.value), value: quote.nav ? round(quote.nav.value, 4) : null, asOfDate: formatDisplayDate(quote.nav?.date) },
    marketPrice: { display: moneyText(quote.price?.value), value: quote.price ? round(quote.price.value, 4) : null, asOfDate: formatDisplayDate(quote.price?.date) },
    premiumDiscount: { display: percentText(premium), value: premium },
    aum: {
      display: input.netAssets ?? "—",
      value: aumValue,
      asOfDate: formatDisplayDate(input.netAssetsAsOf),
      source: "Vanguard workplace fundDetails API (ETF share class net assets)",
      totalFundNetAssets: { display: input.totalFundNetAssets ?? "—", value: parseAmount(input.totalFundNetAssets) },
    },
    yields: {
      dividendYield: metrics.dividendYield,
      dividendYieldText: metrics.dividendYieldText,
      dividendYieldKind: "Vanguard published distribution yield",
      dividendYieldAsOf: input.dividendYieldAsOf,
      secYield: metrics.secYield,
      secYieldText: metrics.secYieldText,
      secYieldKind: metrics.secYield === null ? "not published" : "official 30-day SEC yield",
      secYieldAsOf: input.secYieldAsOf,
      unsubsidizedSecYield: null,
    },
    returns: { monthEnd, quarterEnd, derivedFrom: metrics.returnsBasis },
    distributions: {
      frequency: input.frequency,
      paymentsPerYear: paymentsPerYear(input.frequency),
      headers: DISTRIBUTION_HEADERS,
      rows: input.distributionRows,
    },
    holdings: { ...input.holdings, asOf: formatDisplayDate(input.holdings.asOfDate) },
    history: { ...input.history, asOf: formatDisplayDate(input.history.asOfDate) },
  };
  const row = {
    ticker,
    name,
    category,
    fundPage,
    dataFile: `./funds/${ticker}/meta.json`,
    cusip: meta.identifiers.cusip,
    isin: meta.identifiers.isin,
    ter: meta.expenseRatio.display,
    terValue: input.expense,
    nav: meta.nav.display,
    navValue: meta.nav.value,
    aum: meta.aum.display,
    aumValue,
    asOfDate: meta.nav.asOfDate,
    inceptionDate: input.inceptionDate ? formatDisplayDate(input.inceptionDate) : "—",
    exchange: input.exchange ?? "",
    closePrice: meta.marketPrice.display,
    closePriceValue: meta.marketPrice.value,
    premiumDiscount: meta.premiumDiscount.display,
    premiumDiscountValue: premium,
    distributions: {
      frequency: input.frequency,
      exDate: latestDividend ? formatUsDate(latestDividend[1]) : "—",
      dividend: latestDividend ? latestDividend[4] : "—",
    },
    returns: meta.returns,
    metrics,
    holdings: input.holdings.totalRows,
    history: input.history.totalRows,
  };
  return { meta, row };
}

/** US ISIN from a 9-character CUSIP: "US" + CUSIP + Luhn check digit over the letters-as-numbers expansion; null for anything else. */
export function isinFromCusip(cusip: string | null): string | null {
  if (!cusip || !/^[0-9A-Z]{9}$/i.test(cusip)) return null;
  const body = `US${cusip.toUpperCase()}`;
  const digits = [...body].map((ch) => (/[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch)).join("");
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return `${body}${(10 - (sum % 10)) % 10}`;
}

/** The standard catalog envelope: generatedAt, source and counts on top of the fund rows. */
export function buildIndex(funds: any[], generatedAt: string = new Date().toISOString()) {
  return {
    generatedAt,
    source: {
      provider: "Vanguard",
      site: "https://investor.vanguard.com",
      catalog: "https://investor.vanguard.com/etf/list (fund list embedded in the updater)",
      holdings: "Vanguard investor profile holdings (IRR AdditionalFundData); SEC EDGAR N-PORT-P fallback",
      history: "Vanguard official NAV/market-price/premium-discount history merged by date with Yahoo Finance daily chart",
    },
    counts: {
      funds: funds.length,
      holdings: funds.reduce((sum, fund) => sum + (Number(fund.holdings) || 0), 0),
      history: funds.reduce((sum, fund) => sum + (Number(fund.history) || 0), 0),
    },
    funds,
  };
}

// ---------------------------------------------------------------------------
// Holdings source 1 (primary): Vanguard investor-profile holdings feed
// ---------------------------------------------------------------------------

export type VanguardHoldings = { rows: Record<string, unknown>[]; asOf: string | null };

/**
 * Parses the `holdingDetails` payload of Vanguard's investor-profile
 * `…/irr/funds/profile/{TICKER}-AdditionalFundData` endpoint (the same JSON
 * the profile page itself renders: `equityHoldings[].ticker` /
 * `marketValuePercentage`, `asOfDate` as MM/DD/YYYY). Defensive on purpose:
 * any `*holdings` array under `holdingDetails` is accepted and bond buckets
 * are labeled from the key name, so equity and bond funds map alike.
 */
export function parseVanguardHoldingDetails(data: any): VanguardHoldings | null {
  const root = data && typeof data === "object" ? data : null;
  if (!root) return null;
  const details = (root as any).holdingDetails ?? (root as any).holdings ?? null;
  if (!details || typeof details !== "object") return null;
  const rawAsOf = (details as any).asOfDate ?? (details as any).asOfDt ?? null;
  const buckets: Array<{ label: string; items: any[] }> = [];
  for (const [key, value] of Object.entries(details as Record<string, unknown>)) {
    if (!Array.isArray(value) || !/holding/i.test(key)) continue;
    const label = /bond|fixed/i.test(key) ? "Bond" : /equit|stock/i.test(key) ? "Equity" : "—";
    buckets.push({ label, items: value as any[] });
  }
  if (!buckets.length) return null;
  const rows = buckets.flatMap(({ label, items }) =>
    items.map((item: any) => {
      const cusip = item?.cusip ?? item?.securityId ?? "—";
      const isin = item?.isin ?? "—";
      return {
        Name:
          item?.holdingName ??
          item?.securityLongDescription ??
          item?.securityShortDescription ??
          item?.name ??
          item?.ticker ??
          "—",
        Ticker: item?.ticker ?? item?.holdingTicker ?? item?.symbol ?? "—",
        Identifier: holdingIdentifier(cusip, isin),
        Weight: item?.marketValuePercentage ?? item?.weight ?? item?.percentOfAssets ?? "—",
        "Market Value": item?.marketValueBaseCurrency ?? item?.marketValue ?? item?.value ?? "—",
        "Shares Held": item?.shareQuantity ?? item?.shares ?? item?.numberOfShares ?? item?.quantity ?? "—",
        "Asset Category": label,
        Sector: item?.sector ?? item?.gicsSector ?? "—",
        Exchange: item?.exchange ?? "—",
        Location: item?.location ?? item?.country ?? "—",
        CUSIP: cusip,
        ISIN: isin,
        Currency: item?.currency ?? "—",
      };
    }),
  );
  if (!rows.length) return null;
  const asOf = toIsoDate(rawAsOf);
  return { rows, asOf: asOf || (typeof rawAsOf === "string" ? rawAsOf : null) };
}

export type VanguardAdditionalFundData = {
  holdings: VanguardHoldings | null;
  officialHistory: OfficialPricePoint[];
  ok: boolean;
};

/**
 * Fetches Vanguard's investor-profile `…/irr/funds/profile/{TICKER}-
 * AdditionalFundData` endpoint ONCE and parses all three top-level keys it
 * carries: `holdingDetails` (holdings), plus `historicalPrice` and
 * `premiumDiscountDetails` (official NAV/market-price/premium-discount
 * history) — previously fetched but discarded save for `holdingDetails`.
 */
async function vanguardAdditionalFundData(ticker: string): Promise<VanguardAdditionalFundData> {
  const url = `${VANGUARD_IRR_URL}/${ticker}-AdditionalFundData`;
  try {
    const response = await httpFetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
        Referer: `https://investor.vanguard.com/investment-products/etfs/profile/${ticker.toLowerCase()}`,
      },
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const data = await response.json();
    return { holdings: parseVanguardHoldingDetails(data), officialHistory: parseVanguardOfficialHistory(data), ok: true };
  } catch (error) {
    outputNote(`[ ${'holdings'.padEnd(9)}] ${ticker} ${error}`);
    return { holdings: null, officialHistory: [], ok: false };
  }
}

// ---------------------------------------------------------------------------
// Holdings source 2 (fallback): SEC EDGAR Form N-PORT-P, same pipeline as the
// WisdomTree updater. Every US ETF series files N-PORT-P; the filing carries
// the full reported portfolio (name, CUSIP/ISIN, USD value, weight %, balance,
// asset category, plus coupon/maturity for debt positions).
// ---------------------------------------------------------------------------

export type SecSeriesRef = { cik: string; seriesId: string; classId: string };
export type NportAccession = { accession: string; filed: string; reportDate: string; url: string };
export type ParsedNport = {
  regName: string;
  regCik: string;
  seriesName: string;
  seriesId: string;
  repPdDate: string;
  holdings: Record<string, unknown>[];
  totalValue: number;
  netAssets: number | null;
};

function secHeaders(): Record<string, string> {
  return { "User-Agent": activeConfig.secUa, Accept: "application/json, application/xml, text/xml, text/plain" };
}

async function fetchSecText(url: string, label: string): Promise<string> {
  const response = await httpFetch(url, { headers: secHeaders() });
  if (response.ok) return response.text();
  throw new Error(`${response.status} ${response.statusText} for ${label}`);
}

export function parseFundTickerMap(payload: any): Map<string, SecSeriesRef> {
  const result = new Map<string, SecSeriesRef>();
  const fields = Array.isArray(payload?.fields) ? payload.fields.map(String) : [];
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const at = (field: string) => String(row[fields.indexOf(field)] ?? "");
    const ticker = sanitizeTicker(at("symbol"));
    const cik = at("cik").replace(/\D/g, "");
    const seriesId = at("seriesId").toUpperCase();
    const classId = at("classId").toUpperCase();
    if (ticker && cik && seriesId && !result.has(ticker)) {
      result.set(ticker, { cik: cik.padStart(10, "0"), seriesId, classId });
    }
  }
  return result;
}

function unescapeXml(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function tagValue(xml: string, tag: string): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`<(?:(?:[A-Za-z0-9_.-]+):)?${escaped}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[A-Za-z0-9_.-]+):)?${escaped}>`, "i").exec(xml);
  return match ? cleanText(unescapeXml(match[1].replace(/<[^>]+>/g, " "))) : "";
}

function tagAttribute(xml: string, tag: string, attribute: string): string {
  const match = new RegExp(`<(?:(?:[A-Za-z0-9_.-]+):)?${tag}\\b[^>]*\\b${attribute}="([^"]*)"`, "i").exec(xml);
  return match ? cleanText(unescapeXml(match[1])) : "";
}

export function nportUrlFor(cik: string, accession: string): string {
  const digits = String(cik).replace(/\D/g, "").replace(/^0+/, "") || "0";
  const acc = String(accession).replace(/-/g, "");
  // The raw submission text is the stable machine-readable public document;
  // primary_doc.xml is often only the EDGAR submission header.
  return `${SEC_ARCHIVES}/${digits}/${acc}/${accession}.txt`;
}

export function parseEdgarAtomFilings(xml: string): NportAccession[] {
  const result: NportAccession[] = [];
  for (const match of String(xml ?? "").matchAll(/<entry>([\s\S]*?)<\/entry>/gi)) {
    const body = match[1];
    const type = (tagValue(body, "filing-type") || "").toUpperCase();
    if (type && type !== "NPORT-P") continue;
    if (/<amend>/i.test(body)) continue;
    const accession = tagValue(body, "accession-number");
    if (!accession) continue;
    const href = /<filing-href>([\s\S]*?)<\/filing-href>/i.exec(body)?.[1] || "";
    const cik = /\/data\/(\d+)\//i.exec(unescapeXml(href))?.[1] || "";
    result.push({ accession, filed: tagValue(body, "filing-date"), reportDate: tagValue(body, "period"), url: nportUrlFor(cik, accession) });
  }
  return result;
}

export function parseNport(xml: string): ParsedNport {
  const text = String(xml ?? "");
  const genInfo = /<genInfo\b[^>]*>([\s\S]*?)<\/genInfo>/i.exec(text)?.[1] || text.slice(0, 5000);
  const fundInfo = /<fundInfo\b[^>]*>([\s\S]*?)<\/fundInfo>/i.exec(text)?.[1] || "";
  const holdings: Record<string, unknown>[] = [];
  let totalValue = 0;
  for (const match of text.matchAll(/<invstOrSec\b[^>]*>([\s\S]*?)<\/invstOrSec>/gi)) {
    const body = match[1];
    const name = tagValue(body, "name") || tagValue(body, "title") || "-";
    const cusip = tagValue(body, "cusip");
    const isin = tagAttribute(body, "isin", "value");
    const identifier = cusip && !/^n\/?a$/i.test(cusip) ? cusip : isin || tagAttribute(body, "other", "value") || "-";
    const value = numberOrNull(tagValue(body, "valUSD"));
    const weight = numberOrNull(tagValue(body, "pctVal"));
    if (value !== null) totalValue += value;
    const debt = /<debtSec\b[^>]*>([\s\S]*?)<\/debtSec>/i.exec(body)?.[1] || "";
    const cusipValue = cusip && !/^n\/?a$/i.test(cusip) ? cusip : identifier;
    holdings.push({
      Name: name,
      Ticker: "-",
      Identifier: holdingIdentifier(cusipValue, isin),
      Weight: weight === null ? "—" : String(weight),
      "Market Value": value === null ? "—" : String(value),
      "Shares Held": tagValue(body, "balance") || "-",
      "Asset Category": tagValue(body, "assetCat") || "-",
      Sector: "—",
      Exchange: "—",
      Location: "—",
      CUSIP: cusipValue,
      ISIN: isin || "—",
      Currency: tagValue(body, "curCd") || "—",
      ...(debt ? { Coupon: tagValue(debt, "annualizedRt") || "-", Maturity: tagValue(debt, "maturityDt") || "-" } : {}),
    });
  }
  return {
    regName: tagValue(genInfo, "regName"),
    regCik: tagValue(genInfo, "regCik"),
    seriesName: tagValue(genInfo, "seriesName"),
    seriesId: tagValue(genInfo, "seriesId"),
    repPdDate: toIsoDate(tagValue(genInfo, "repPdDate")),
    holdings,
    totalValue: round(totalValue, 2),
    netAssets: numberOrNull(tagValue(fundInfo, "netAssets")),
  };
}

export function normalizeHoldingName(value: unknown): string {
  let text = cleanText(value).toUpperCase().replace(/[’']/g, "").replace(/&/g, " AND ").replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  text = text.replace(/\bCLASS\s+([A-Z])\b/g, "CL $1").replace(/\bCL\.?\s*([A-Z])\b/g, "CL $1");
  const keepClass = text.match(/\bCL\s+[A-Z]\b/gi)?.[0] || "";
  text = text.replace(/\b(THE|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|PLC|SA|NV|AG|SE|SPA|ORDINARY|COMMON|STOCK|SHS|SHARES|ADR|DEPOSITARY|RECEIPT|USD|US|REG|REGISTERED)\b/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  if (keepClass && !/\bCL\s+[A-Z]\b/.test(text)) text = `${text} ${keepClass}`.trim();
  return text;
}

export function normalizeHoldingNameCore(value: unknown): string {
  return normalizeHoldingName(value).replace(/\s+CL\s+[A-Z]\b/g, "").trim();
}

export function cleanHoldingTicker(value: unknown): string {
  const raw = cleanText(value).toUpperCase();
  if (!raw || ["-", "--", "N/A", "NA", "NONE", "NULL", "SEE FILE"].includes(raw)) return "";
  return raw.replace(/\s+/g, "");
}

function parseCompanyTickerMap(payload: any): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of Object.values(payload || {})) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const ticker = cleanHoldingTicker(row.ticker);
    const title = cleanText(row.title);
    if (!ticker || !title) continue;
    for (const key of [normalizeHoldingName(title), normalizeHoldingNameCore(title)]) {
      if (key && !map.has(key)) map.set(key, ticker);
    }
  }
  return map;
}

let fundTickerMap: Map<string, SecSeriesRef> | null = null;
let fundTickerMapPromise: Promise<Map<string, SecSeriesRef>> | null = null;
let companyTickerMap: Map<string, string> | null = null;
let companyTickerMapPromise: Promise<Map<string, string>> | null = null;

async function loadFundTickerTable(): Promise<Map<string, SecSeriesRef>> {
  if (fundTickerMap) return fundTickerMap;
  if (fundTickerMapPromise) return fundTickerMapPromise;
  fundTickerMapPromise = (async () => {
    const payload = JSON.parse(await fetchSecText(SEC_FUND_TICKERS_URL, "[edgar] fund ticker table"));
    fundTickerMap = parseFundTickerMap(payload);
    outputNote(`[ ${'edgar'.padEnd(9)}] SEC fund ticker table: ${fundTickerMap.size} share classes`);
    return fundTickerMap;
  })();
  try {
    return await fundTickerMapPromise;
  } finally {
    fundTickerMapPromise = null;
  }
}

async function loadCompanyTickerTable(): Promise<Map<string, string>> {
  if (companyTickerMap) return companyTickerMap;
  if (companyTickerMapPromise) return companyTickerMapPromise;
  companyTickerMapPromise = (async () => {
    const payload = JSON.parse(await fetchSecText(SEC_COMPANY_TICKERS_URL, "[edgar] company ticker table"));
    companyTickerMap = parseCompanyTickerMap(payload);
    outputNote(`[ ${'edgar'.padEnd(9)}] SEC company ticker table: ${companyTickerMap.size} issuer names`);
    return companyTickerMap;
  })();
  try {
    return await companyTickerMapPromise;
  } finally {
    companyTickerMapPromise = null;
  }
}

function fillNportTickers(rows: Record<string, unknown>[], names: Map<string, string>): Record<string, unknown>[] {
  return rows.map((row) => {
    if (cleanHoldingTicker(row.Ticker)) return row;
    const ticker = names.get(normalizeHoldingName(row.Name)) || names.get(normalizeHoldingNameCore(row.Name)) || "";
    return ticker ? { ...row, Ticker: ticker } : row;
  });
}

async function resolveNportFiling(ticker: string): Promise<{ ref: SecSeriesRef; accession: NportAccession } | null> {
  const table = await loadFundTickerTable();
  const ref = table.get(ticker);
  if (!ref) return null;
  const params = new URLSearchParams({ action: "getcompany", CIK: ref.seriesId, type: "NPORT-P", owner: "include", count: "10", output: "atom" });
  const atom = await fetchSecText(`${SEC_BROWSE_URL}?${params.toString()}`, `[edgar] ${ticker} filings`);
  const [accession] = parseEdgarAtomFilings(atom);
  return accession ? { ref, accession } : null;
}

// ---------------------------------------------------------------------------
// Static feed writer (same paginated envelope as the SPDR / WisdomTree feeds)
// ---------------------------------------------------------------------------

async function readPreviousMeta(ticker: string): Promise<any | null> {
  try {
    return JSON.parse(await readFile(new URL(`funds/${ticker}/meta.json`, ROOT), "utf8"));
  } catch {
    return null;
  }
}

/** Last published values a failed or partial fetch falls back to, read from a standard-shape meta.json. */
export function previousValues(meta: any) {
  const text = (value: unknown): string | null => (typeof value === "string" && value && value !== "—" ? value : null);
  return {
    portId: text(meta?.providerIds?.portId),
    frequency: text(meta?.distributions?.frequency),
    netAssets: text(meta?.aum?.display),
    netAssetsAsOf: isoFromDisplayDate(meta?.aum?.asOfDate) || null,
    totalFundNetAssets: text(meta?.aum?.totalFundNetAssets?.display),
    expense: numberOrNull(meta?.expenseRatio?.value),
    dividendYield: numberOrNull(meta?.yields?.dividendYield),
    dividendYieldAsOf: text(meta?.yields?.dividendYieldAsOf),
    secYield: numberOrNull(meta?.yields?.secYield),
    secYieldAsOf: text(meta?.yields?.secYieldAsOf),
    cusip: text(meta?.identifiers?.cusip),
    exchange: text(meta?.inception?.exchange),
    inceptionDate: text(meta?.inception?.fundInceptionDate),
  };
}

async function readPreviousSheet(ticker: string, kind: string): Promise<{ headers: string[]; rows: any[] }> {
  try {
    const meta = await readPreviousMeta(ticker);
    const pages: string[] = meta?.[kind]?.pages ?? [];
    const rows: any[] = [];
    let headers: string[] = [];
    for (const page of pages) {
      const clean = String(page).replace(/^\.\/+/g, "");
      try {
        const data = JSON.parse(await readFile(new URL(`funds/${ticker}/${clean}`, ROOT), "utf8"));
        if (!headers.length && Array.isArray(data.headers)) headers = data.headers;
        if (Array.isArray(data.rows)) rows.push(...data.rows);
      } catch {}
    }
    if (kind === "holdings") {
      const standard = rows.map(standardHoldingRow);
      return { headers: standardHoldingHeaders(standard), rows: standard };
    }
    return { headers, rows };
  } catch {
    return { headers: [], rows: [] };
  }
}

/** Writes the pages atomically and returns the manifest plus a cleanup that removes stale pages (call it only after meta.json is written). */
async function writePages(dir: URL, ticker: string, kind: string, headers: string[], rows: any[], pageSize: number) {
  const target = new URL(`${kind}/`, dir);
  await mkdir(target, { recursive: true });
  const pageCount = rows.length ? Math.ceil(rows.length / pageSize) : 0;
  const kept = new Set<string>();
  for (let page = 0; page < pageCount; page += 1) {
    const name = `${String(page + 1).padStart(3, "0")}.json`;
    kept.add(name);
    const payload = {
      ticker,
      page: page + 1,
      pageSize,
      totalRows: rows.length,
      headers,
      rows: rows.slice(page * pageSize, (page + 1) * pageSize),
    };
    await writeAtomic(new URL(name, target), JSON.stringify(payload) + "\n");
  }
  const removeStale = async () => {
    try {
      for (const name of await readdir(target)) {
        if (!kept.has(name) && (name.endsWith(".json") || name.includes(".tmp-"))) await rm(new URL(name, target), { force: true });
      }
    } catch {}
  };
  return { pages: [...kept].sort().map((name) => `${kind}/${name}`), pageSize, totalRows: rows.length, removeStale };
}

function configLogEntries(config: UpdaterConfig): Record<string, string> {
  const entries: Record<string, string> = {
    MAX_FETCHES: String(config.maxFetches),
    REQUEST_SLEEP: String(config.requestSleepSeconds),
    CONCURRENCY: String(config.concurrency),
    AUM: config.aumRange?.source ?? ":",
    TER: config.terRange?.source ?? ":",
    DIVIDEND_YIELD: config.dividendYieldRange?.source ?? ":",
    SEC_YIELD: config.secYieldRange?.source ?? ":",
    TICKERS: config.tickers.join(","),
    CATEGORY: config.category,
    HOLDINGS_PAGE_SIZE: String(config.holdingsPageSize),
    HISTORY_PAGE_SIZE: String(config.historyPageSize),
    MAX_RETRIES: String(config.maxRetries),
    HISTORY_RANGE: config.historyRange,
    SEC_UA: config.secUa,
    SKIP_YAHOO: String(config.skipYahoo),
    EDGAR_FALLBACK: String(config.edgarFallback),
  };
  for (const period of RETURN_PERIODS) {
    entries[`PERFORMANCE_${period}`] = config.performanceRanges[period]?.source ?? ":";
    entries[`TOTAL_RETURN_${period}`] = config.totalReturnRanges[period]?.source ?? ":";
  }
  return entries;
}

async function readJsonOrNull(url: URL): Promise<any | null> {
  try {
    return JSON.parse(await readFile(url, "utf8"));
  } catch {
    return null;
  }
}

/** `outputRoot` redirects every read and write (tests); the published feed is always `api/vanguard`. */
export const SOFT_DEADLINE_MS = 25 * 60_000;

export async function run(config: UpdaterConfig = readConfig({}), outputRoot: URL = DEFAULT_ROOT, softDeadlineMs: number = SOFT_DEADLINE_MS) {
  ROOT = outputRoot;
  FUNDS = new URL("funds/", ROOT);
  try {
    await runUpdate(config, softDeadlineMs);
  } finally {
    ROOT = DEFAULT_ROOT;
    FUNDS = new URL("funds/", ROOT);
  }
}

async function runUpdate(config: UpdaterConfig, softDeadlineMs: number) {
  activeConfig = config;
  configureLanes(config.concurrency, config.requestSleepSeconds);
  const deadline = Date.now() + softDeadlineMs;
  await mkdir(FUNDS, { recursive: true });
  const holdingsPageSize = config.holdingsPageSize;
  const historyPageSize = config.historyPageSize;
  const concurrency = config.concurrency;
  outputPrintConfig('Vanguard', configLogEntries(config));
  const staticSelection = FUNDS_SEED.filter((fund) => passesStaticFilters(fund, config));
  outputPrintFilter(staticSelection.length, FUNDS_SEED.length, hasDeferredFilters(config));
  const stateFile = new URL("update-state.json", ROOT);
  const previousState = config.maxFetches > 0 ? await readJsonOrNull(stateFile) : null;
  const batch = selectBatch(staticSelection, config.maxFetches, previousState);
  const selected = batch.selected;
  if (config.maxFetches > 0) {
    console.log(`[ ${'cursor'.padEnd(9)}] starting at ${staticSelection.length ? batch.startCursor + 1 : 0} of ${staticSelection.length}; processing ${selected.length}; next ${staticSelection.length ? (batch.nextCursor ?? 0) + 1 : 0}`);
  } else {
    await rm(stateFile, { force: true });
  }
  const previousIndex = await readJsonOrNull(new URL("index.json", ROOT));
  const output = outputCreateReporter(ROOT, selected.length);
  let failedCount = 0;
  const perFundResults = await mapWithConcurrency(selected, concurrency, async ([ticker, name, category]) => {
    const before = await output.before(ticker);
    if (Date.now() > deadline) {
      await output.result(ticker, before, 'skipped', 'soft deadline reached; published data kept');
      return null;
    }
    try {
    const dir = new URL(`${ticker}/`, FUNDS);
    const [chartData, official, vgAdditional] = await Promise.all([
      chart(ticker),
      officialProfile(ticker, name),
      vanguardAdditionalFundData(ticker),
    ]);
    const vgHoldings = vgAdditional.holdings;
    // Fund-level consistency: a fund is either fully refreshed or fully kept. When a required source failed and the
    // fund already has published data, nothing is rewritten (no new returns next to stale other columns).
    const failedSources = [
      ...(official.ok ? [] : ["official profile"]),
      ...(vgAdditional.ok ? [] : ["Vanguard AdditionalFundData"]),
      ...(chartData.ok ? [] : ["Yahoo chart"]),
    ];
    if (failedSources.length && (await readPreviousMeta(ticker))) {
      await output.result(ticker, before, 'failed', `${failedSources.join(", ")} unavailable; published data kept`);
      failedCount += 1;
      return null;
    }

    // --- Holdings: Vanguard official feed -> SEC N-PORT-P -> previous sheet ---
    let holdingsRows: Record<string, unknown>[] = vgHoldings?.rows ?? [];
    let holdingsAsOf: string | null = vgHoldings?.asOf ?? null;
    let holdingsSource = holdingsRows.length
      ? "Vanguard investor profile holdings (IRR AdditionalFundData)"
      : "not available from current public sources";
    if (!holdingsRows.length && config.edgarFallback) {
      try {
        const filing = await resolveNportFiling(ticker);
        if (filing) {
          const parsed = parseNport(await fetchSecText(filing.accession.url, `[nport] ${ticker}`));
          const seriesMatches = !parsed.seriesId || parsed.seriesId.toUpperCase() === filing.ref.seriesId.toUpperCase();
          if (seriesMatches && parsed.holdings.length) {
            const names = await loadCompanyTickerTable();
            holdingsRows = fillNportTickers(parsed.holdings, names);
            holdingsAsOf = parsed.repPdDate || null;
            holdingsSource = `SEC EDGAR Form N-PORT-P (accession ${filing.accession.accession}, report period ${parsed.repPdDate || "n/a"})`;
          }
        }
      } catch (error) {
        outputNote(`[ ${'nport'.padEnd(9)}] ${ticker} ${error}`);
      }
    }
    const prevMeta = await readPreviousMeta(ticker);
    if (!holdingsRows.length) {
      const prev = await readPreviousSheet(ticker, "holdings");
      if (prev.rows.length) {
        holdingsRows = prev.rows;
        holdingsAsOf = prevMeta?.holdings?.asOfDate ?? null;
        holdingsSource = prevMeta?.holdings?.source ?? "previous run";
      }
    }
    const holdingsHeaders = standardHoldingHeaders(holdingsRows);

    // --- History (+ dividends): Vanguard official NAV/market-price/premium-
    // discount (historicalPrice + premiumDiscountDetails) as the primary
    // source, Yahoo chart OHLCV as a strictly supplementary source (it's the
    // only place Open/High/Low/Volume come from, and the only source for any
    // date range the official windows don't cover) -> previous sheet ---
    let historyRows = chartData.rows;
    let dividends = chartData.dividends;
    let officialHistory = vgAdditional.officialHistory;
    if (!historyRows.length || !officialHistory.length) {
      const prev = await readPreviousSheet(ticker, "history");
      if (!historyRows.length) historyRows = internalHistoryRows(prev.rows);
      if (!officialHistory.length) officialHistory = officialPointsFromPreviousRows(prev.rows);
    }
    if (!dividends.length && prevMeta) {
      dividends = dividendsFromPrevious(prevMeta);
    }

    const allHistoryRows = historyPageRows(historyRows, officialHistory);
    const windowStart = historyWindowStartDate(config.historyRange, Math.floor(Date.now() / 1000));
    const windowedHistoryRows = windowStart ? allHistoryRows.filter((row) => String(row.Date) >= windowStart) : allHistoryRows;
    const mergedHistoryRows = windowedHistoryRows.length ? windowedHistoryRows : allHistoryRows;
    const historyAsOfDate = mergedHistoryRows.length
      ? String(mergedHistoryRows[mergedHistoryRows.length - 1].Date)
      : (historyRows.length ? String(historyRows[historyRows.length - 1].date) : null);

    const prev = previousValues(prevMeta);
    const frequency = official.distributionFrequency ?? prev.frequency;
    const inputs: FundInputs = {
      ticker,
      name,
      category,
      officialPage: official.url,
      portId: (official as any).portId ?? prev.portId,
      frequency,
      distributionRows: distributionRows(frequency, dividends),
      netAssets: official.etfAssets?.value ?? prev.netAssets,
      netAssetsAsOf: toIsoDate(official.etfAssets?.asOf) || prev.netAssetsAsOf,
      totalFundNetAssets: official.netAssets?.value ?? prev.totalFundNetAssets,
      expense: official.expense?.value ? Number(official.expense.value) : prev.expense,
      dividendYield: official.dividend?.value ? numberOrNull(official.dividend.value) : prev.dividendYield,
      dividendYieldAsOf: toIsoDate(official.dividend?.asOf) || prev.dividendYieldAsOf,
      secYield: official.sec?.value ? numberOrNull(official.sec.value) : prev.secYield,
      secYieldAsOf: toIsoDate(official.sec?.asOf) || prev.secYieldAsOf,
      officialYtd: official.ytd?.value ? numberOrNull(official.ytd.value) : null,
      officialOneYear: official.oneYear?.value ? numberOrNull(official.oneYear.value) : null,
      officialAsOf: official.ytd?.asOf ?? null,
      cusip: official.cusip ?? prev.cusip,
      exchange: official.exchange ?? prev.exchange,
      inceptionDate: official.inceptionDate ?? prev.inceptionDate,
      yahooRows: historyRows,
      pageRows: mergedHistoryRows,
      holdings: { pages: [], pageSize: holdingsPageSize, totalRows: holdingsRows.length, asOfDate: holdingsAsOf, source: holdingsSource },
      history: {
        pages: [],
        pageSize: historyPageSize,
        totalRows: mergedHistoryRows.length,
        asOfDate: historyAsOfDate,
        source:
          "Vanguard IRR AdditionalFundData historicalPrice + premiumDiscountDetails (official NAV/market price/premium-discount, primary) " +
          "+ Yahoo Finance public chart API (OHLC/adjusted close/volume, and any date range the official windows don't cover; per-row provenance in the `Source` column)",
      },
    };
    if (!passesMetricFilters(filterMetricsOf({ aumValue: parseAmount(inputs.netAssets), terValue: inputs.expense, metrics: fundMetrics(inputs) }), config)) {
      // Filtered funds keep their previously published data and catalog row untouched.
      await output.result(ticker, before, 'filtered', 'metric filters', { yahooHistoryCount: historyRows.length });
      return null;
    }
    await mkdir(dir, { recursive: true });
    // Ordered writes: pages first, then meta.json, then stale pages are removed; the index row is written at the end of the run.
    const { removeStale: removeStaleHistory, ...historyManifest } = await writePages(dir, ticker, "history", HISTORY_HEADERS, mergedHistoryRows, historyPageSize);
    const { removeStale: removeStaleHoldings, ...holdingsManifest } = await writePages(dir, ticker, "holdings", holdingsHeaders, holdingsRows, holdingsPageSize);
    const { meta, row } = assembleFund({
      ...inputs,
      holdings: { ...inputs.holdings, ...holdingsManifest },
      history: { ...inputs.history, ...historyManifest },
    });
    await writeAtomic(new URL("meta.json", dir), JSON.stringify(meta, null, 2) + "\n");
    await removeStaleHistory();
    await removeStaleHoldings();
    await output.result(ticker, before, undefined, undefined, {
      officialHistoryCount: officialHistory.length,
      yahooHistoryCount: historyRows.length,
      workplaceRaw: (official as any).workplaceRaw,
      portId: meta.providerIds.portId,
    });
    return row;
    } catch (error) {
      // Continue past a single fund's failure instead of aborting the whole run
      // (same convention as the iShares/ProShares/Franklin/JPMorgan updaters):
      // mark it failed and keep its last successfully published data and catalog row.
      await output.result(ticker, before, 'failed', String(error));
      failedCount += 1;
      return null;
    }
  });
  // Funds outside this run (TICKERS, category or MAX_FETCHES batch) keep their previously published catalog row.
  const fresh = new Map<string, any>();
  selected.forEach(([ticker], index) => { if (perFundResults[index]) fresh.set(ticker, perFundResults[index]); });
  const previousRows = new Map<string, any>((Array.isArray(previousIndex?.funds) ? previousIndex.funds : []).map((entry: any) => [String(entry?.ticker), entry]));
  const catalog = FUNDS_SEED.map(([ticker]) => fresh.get(ticker) ?? previousRows.get(ticker)).filter((entry) => entry != null);
  const nextIndex = buildIndex(catalog);
  const nextText = JSON.stringify(nextIndex, null, 2) + "\n";
  // Comparing raw text would treat a run that only refreshed generatedAt (with
  // every fund's actual data unchanged) as a real change and rewrite the file
  // every time. Compare with generatedAt stripped from both sides instead.
  const previousText = await readFile(new URL("index.json", ROOT), "utf8").catch(() => null);
  let previousWithoutStamp: unknown;
  try { previousWithoutStamp = previousText ? { ...JSON.parse(previousText), generatedAt: undefined } : undefined; } catch { previousWithoutStamp = undefined; }
  const nextWithoutStamp = { ...nextIndex, generatedAt: undefined };
  if (previousText === null || JSON.stringify(previousWithoutStamp) !== JSON.stringify(nextWithoutStamp)) {
    await writeAtomic(new URL("index.json", ROOT), nextText);
  }
  if (config.maxFetches > 0) {
    const nextState = { cursor: batch.nextCursor ?? 0, tickers: staticSelection.map(([ticker]) => ticker) };
    const sameState = previousState && previousState.cursor === nextState.cursor && JSON.stringify(previousState.tickers) === JSON.stringify(nextState.tickers);
    if (!sameState) await writeAtomic(stateFile, JSON.stringify({ ...nextState, generatedAt: new Date().toISOString() }, null, 2) + "\n");
  }  if (selected.length > 0 && failedCount === selected.length) throw new Error(`every selected fund failed (${failedCount}); published data kept`);
}

// --- TLS trust store (identical in every ETF repo) ---
const SYSTEM_CA_MARKER = 'ETF_UPDATER_SYSTEM_CA';
const CERT_ERROR = /UNABLE_TO_GET_ISSUER_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT|CERT_HAS_EXPIRED|unable to get (?:local )?issuer certificate|self[- ]signed certificate|certificate has expired/i;

export function isCertError(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown; cause?: unknown } | null;
  return CERT_ERROR.test(`${String(e?.code ?? '')} ${String(e?.message ?? '')}`) || (e?.cause ? isCertError(e.cause) : false);
}

export function systemCaActive(env: Record<string, string | undefined> = process.env, execArgv: string[] = process.execArgv): boolean {
  return execArgv.includes('--use-system-ca') || env.NODE_USE_SYSTEM_CA === '1' || env[SYSTEM_CA_MARKER] === '1';
}

export function reexecWithSystemCa(): never {
  const child = Bun.spawnSync([process.execPath, '--use-system-ca', ...process.argv.slice(1)], {
    env: { ...process.env, [SYSTEM_CA_MARKER]: '1' },
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  process.exit(child.exitCode ?? 1);
}

/** mode: auto (restart once on an untrusted-certificate error), true (restart now), false (never). */
export function installSystemCa(mode: string, reexec: () => never = reexecWithSystemCa, active: boolean = systemCaActive()): void {
  if (mode === 'false' || active) return;
  if (mode === 'true') reexec();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    try { return await realFetch(...args); }
    catch (error) {
      if (!isCertError(error)) throw error;
      console.error('[ notice   ] TLS certificate not trusted; restarting once with --use-system-ca');
      return reexec();
    }
  }) as typeof fetch;
}

// File defaults and explicit overrides, one mechanism for the CLI and GitHub Actions: allowlisted
// scalar controls only, so the workflow can resolve them without interpolating user input into bash.
// Precedence: config file < advanced JSON < nonblank named inputs < environment (an explicitly set
// environment variable wins even when empty) < protected Actions variables (workflow only).
export const CONTROL_NAMES = [
  "MAX_FETCHES", "REQUEST_SLEEP", "CONCURRENCY", "AUM", "TER", "DIVIDEND_YIELD", "SEC_YIELD", "TICKERS",
  "CATEGORY", "HOLDINGS_PAGE_SIZE", "HISTORY_PAGE_SIZE", "MAX_RETRIES", "HISTORY_RANGE", "SEC_UA",
  "SKIP_YAHOO", "EDGAR_FALLBACK", "VERBOSE", "USE_SYSTEM_CA",
  ...["PERFORMANCE", "TOTAL_RETURN"].flatMap((prefix) => ["YTD", "1Y", "3Y", "5Y", "10Y"].map((period) => `${prefix}_${period}`)),
] as const;
export type ControlName = (typeof CONTROL_NAMES)[number];
export const CONFIG_FILE_URL = new URL("./update-data.config.json", import.meta.url);

export function resolveControls(
  file: unknown = {},
  advanced: unknown = {},
  inputs: unknown = {},
  env: Record<string, string | undefined> = {},
): Record<string, string> {
  const result: Record<string, string> = {};
  const known = new Set<string>(CONTROL_NAMES);
  const apply = (value: unknown, skipEmpty = false): void => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Configuration must be a JSON object");
    for (const [key, raw] of Object.entries(value)) {
      if (!known.has(key)) throw new Error(`Unknown updater control: ${key}`);
      if (skipEmpty && (raw === "" || raw === undefined || raw === null)) continue;
      if (!["string", "number", "boolean"].includes(typeof raw)) throw new Error(`${key}: expected string, number or boolean`);
      const text = String(raw);
      if (/[\r\n\0]/.test(text)) throw new Error(`${key}: multiline/control characters are not allowed`);
      result[key] = text;
    }
  };
  apply(file);
  apply(advanced);
  apply(inputs, true);
  for (const key of CONTROL_NAMES) {
    const value = env[key];
    if (value !== undefined) apply({ [key]: value });
  }
  if (result.VERBOSE && !/^(0|1|true|false|yes|no|y|n|on|off)$/i.test(result.VERBOSE)) throw new Error("VERBOSE: expected boolean");
  if (result.USE_SYSTEM_CA !== undefined) {
    const mode = result.USE_SYSTEM_CA.toLowerCase();
    if (!["auto", "true", "false"].includes(mode)) throw new Error("USE_SYSTEM_CA: expected auto, true or false");
    result.USE_SYSTEM_CA = mode;
  }
  readConfig(result); // validate every integer, boolean, range and min:max filter before any request or write
  return result;
}

export async function runtimeControls(env: Record<string, string | undefined> = process.env): Promise<Record<string, string>> {
  const file: unknown = JSON.parse(await readFile(CONFIG_FILE_URL, "utf8"));
  return resolveControls(file, {}, {}, env);
}

export const USAGE = `Usage: bun scripts/update-data.ts [-h|--help]

Controls (defaults in scripts/update-data.config.json; precedence: file < advanced JSON < nonblank inputs < environment):
  MAX_FETCHES          0 means all selected funds; a positive value updates that many funds and resumes at the saved cursor next run
  REQUEST_SLEEP        seconds between fund updates (nonnegative number)
  CONCURRENCY          parallel fund update workers (integer >= 1)
  AUM                  fund net assets in dollars, min:max; K/M/B/T suffixes or nano/micro/small/mid/large presets
  TER                  expense ratio percent, min:max
  DIVIDEND_YIELD       Vanguard trailing dividend yield percent, min:max
  SEC_YIELD            30-day SEC yield percent, min:max
  TICKERS              only update these tickers, separated by spaces, commas or semicolons; empty means all
  CATEGORY             keep funds whose category contains this text (case-insensitive), e.g. Bond or Sector
  HOLDINGS_PAGE_SIZE   rows in each generated current-holdings JSON page (integer >= 1)
  HISTORY_PAGE_SIZE    rows in each generated daily-history JSON page (integer >= 1)
  MAX_RETRIES          retries after the initial request of every source (integer 1-5, anything else is an error)
  HISTORY_RANGE        Yahoo request window and published history rows: max or Ny (e.g. 5y)
  SEC_UA               SEC and Vanguard User-Agent (default daggerok ETF feed daggerok@gmail.com)
  SKIP_YAHOO           do not request Yahoo Finance; previously published history and distributions are kept (true/false)
  EDGAR_FALLBACK       use SEC N-PORT-P holdings when the Vanguard feed has none (true/false)
  VERBOSE              print per-fund retry and fallback notices (true/false)
  USE_SYSTEM_CA        TLS trust store: auto restarts once with Bun's --use-system-ca on an untrusted-certificate error, true always uses the system CA store, false never restarts
  PERFORMANCE_YTD|1Y|3Y|5Y|10Y   annualized return percent, min:max
  TOTAL_RETURN_YTD|1Y|3Y|5Y|10Y  cumulative return percent, min:max

Filters use min:max with exactly one colon; an empty side is unbounded. All filters are ANDed.
AUM, TER and yield filters skip funds without the value; return filters keep funds whose return is unavailable.
Filtered funds keep their previously published data.

Examples:
  TICKERS="VTI VOO BND VUG" bun scripts/update-data.ts
  CONCURRENCY=2 REQUEST_SLEEP=1 bun scripts/update-data.ts
  AUM="10B:" TER=":0.1" bun scripts/update-data.ts
`;

export async function main(argv: string[] = process.argv.slice(2), env: Record<string, string | undefined> = process.env): Promise<void> {
  if (argv.some((arg) => arg === "--help" || arg === "-h")) {
    console.log(USAGE);
    return;
  }
  if (argv.length) throw new Error(`unsupported argument(s): ${argv.join(" ")}. Use --help for usage.`);
  const controls = await runtimeControls(env);
  if (controls.VERBOSE !== undefined && env === process.env) process.env.VERBOSE = controls.VERBOSE;
  installSystemCa(controls.USE_SYSTEM_CA ?? "auto");
  await run(readConfig(controls));
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(`[ error    ] ${cleanText(error instanceof Error ? error.message : error)}`);
    process.exitCode = 1;
  });
}

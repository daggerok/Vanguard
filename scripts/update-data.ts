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
    skipGlobalX: 'SKIP_GLOBALX', skipNorthernTrust: 'SKIP_NORTHERNTRUST',
  };
  const range = (v: any): string => typeof v === 'string' ? v : v?.source ?? `${Number.isFinite(v?.min) ? v.min : ''}:${Number.isFinite(v?.max) ? v.max : ''}`;
  for (const [key, value] of Object.entries(config)) {
    if (['proxyGapMs', 'fetchTimeoutMs', 'retryDelayMs'].includes(key)) continue;
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
function outputConfigValue(key: string, value: string): string {
  if (/TOKEN|PASSWORD|SECRET|COOKIE|SEC_UA/i.test(key)) return '<redacted>';
  if (key === 'TICKERS' && ['', 'null', 'undefined'].includes(value)) return 'all';
  return outputClean(value);
}
function outputPrintConfig(brand: string, config: Record<string, any>): void {
  const entries: [string, string][] = [...outputConfigEntries(config), ['VERBOSE', String(outputVerbose())]];
  console.log(`[ config   ] ${brand} updater:\n${entries.map(([key, value]) => `              ${key}=${outputConfigValue(key, value)}`).join('\n')}`);
}
function outputHasOutputFilters(config: Record<string, any>): boolean {
  return outputConfigEntries(config).some(([name, value]) =>
    /^(CATEGORY|AUM|TER|DIVIDEND_YIELD|SEC_YIELD|PERFORMANCE_|TOTAL_RETURN_)/.test(name) &&
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
const outputUnits: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12, THOUSAND: 1e3, MILLION: 1e6, BILLION: 1e9, TRILLION: 1e12 };
function outputMoney(value: any): string {
  const raw = value && typeof value === 'object' && typeof value.value === 'number' && Number.isFinite(value.value) ? value.value : outputScalar(value);
  if (raw === null || raw === undefined || raw === '—' || raw === '--') return 'null';
  const text = String(raw).replace(/[$,\s]/g, '');
  const match = text.match(/^([+-]?[\d.]+)(K|M|B|T|Thousand|Million|Billion|Trillion)?$/i);
  if (!match) return outputClean(raw);
  const number = Number(match[1]) * (outputUnits[match[2]?.toUpperCase() ?? ''] ?? 1);
  if (!Number.isFinite(number)) return 'null';
  for (const [unit, scale] of [['T', 1e12], ['B', 1e9], ['M', 1e6], ['K', 1e3]] as const) {
    if (Math.abs(number) >= scale) return `$${(number / scale).toFixed(1)}${unit}`;
  }
  return `$${number.toFixed(2)}`;
}
/** Yields: rounded to 2 decimals without trailing zeros; placeholders are omitted like null. */
function outputPercent(value: any): unknown {
  const raw = outputScalar(value);
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? Number(raw.toFixed(2)) : null;
  const text = String(raw).trim().replace(/%$/, '').trim();
  if (['', '-', '—', '--', 'n/a'].includes(text.toLowerCase())) return null;
  const number = Number(text.replace(/,/g, ''));
  return Number.isFinite(number) ? Number(number.toFixed(2)) : outputClean(raw);
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
    field('div', outputPercent(data.trailingYield ?? data.yields?.effectiveYield ?? data.yields?.dividendYield ?? data.dividendYield ?? metrics.dividendYield)),
    field('sec', outputPercent(data.secYield ?? data.yields?.secYield ?? metrics.secYield)),
    field('wp', data.workplaceRaw),
  ].filter(part => part !== '').join(' ');
  return `[ ${`${String(index).padStart(width)}/${total}`.padEnd(8)} ] ${outputClean(ticker).padEnd(5)} ${status.padEnd(9)}${detail ? ` ${detail}` : ''}${reason ? ` reason=${outputClean(reason)}` : ''}`;
}
function outputCreateReporter(root: URL | string, total: number) {
  let completed = 0;
  const tally = new Map<string, number>();
  return {
    before: (ticker: string) => outputInspectFund(root, ticker),
    async result(ticker: string, before: { digest: string }, status?: string, reason?: unknown, extra: any = {}) {
      const after = await outputInspectFund(root, ticker);
      const final = status ?? (before.digest === after.digest ? 'unchanged' : 'updated');
      tally.set(final, (tally.get(final) ?? 0) + 1);
      console.log(outputFundLine(++completed, total, ticker, final, { ...after.meta, ...extra }, reason));
    },
    /** First [ done ] line: the statuses of every fund line this reporter printed. */
    summary(startedAt: number): string {
      const order = ['updated', 'unchanged', 'kept', 'skipped', 'failed'];
      const statuses = [...order, ...[...tally.keys()].filter(status => !order.includes(status))];
      return `[ done     ] ${completed} fund${completed === 1 ? '' : 's'}: ${statuses.map(status => `${tally.get(status) ?? 0} ${status}`).join(', ')} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
    },
  };
}
/** Second [ done ] line: published totals. */
function outputCounts(funds: number, holdings: number, history: number): string {
  return `[ done     ] counts: ${funds.toLocaleString('en-US')} funds / ${holdings.toLocaleString('en-US')} holdings rows / ${history.toLocaleString('en-US')} history rows`;
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
import { appendFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";

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
/** Funds whose holdings legitimately fail a holdingsGuard check (geared, futures, look-through, top-N lists): ticker, or '*' for every fund -> relaxed checks. */
export const HOLDINGS_GUARD_RELAX: Record<string, string[]> = {};
/** Funds the issuer closed, each confirmed from an SEC filing or the issuer notice (`source`): never fetched or guarded, last published data kept, index row marked closed. */
export const CLOSED_FUNDS: ClosedFund[] = [];
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
/** Writes only on real change: identical content leaves the file (and its mtime) alone. Returns true when written. */
async function writeAtomic(url: URL, text: string): Promise<boolean> {
  if ((await readFile(url, "utf8").catch(() => null)) === text) return false;
  const tmp = new URL(`${url.href}.tmp-${process.pid}`);
  await writeFile(tmp, text);
  await rename(tmp, url);
  return true;
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
  // Month-name and other calendar dates: pure text, the same day in every time zone (shared calendar-dates block)
  return calendarIso(text) ?? "";
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
    outputNote(`[ ${'workplc'.padEnd(8)} ] ${portId} ${e}`);
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
    outputNote(`[ ${'official'.padEnd(8)} ] ${ticker} ${e}`);
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
        // Unrounded value, only used to tell float noise from a real change (never published).
        adjCloseRaw: typeof (adj[i] ?? q.close?.[i]) === "number" ? adj[i] ?? q.close?.[i] : null,
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
    outputNote(`[ ${'history'.padEnd(8)} ] ${ticker} ${error}`);
    return { rows: [], dividends: [], ok: false };
  }
}

/**
 * A HISTORY_RANGE window never shrinks the published history, and with it the 3y, 5y and 10y returns (open-items etfs Q25,
 * shared windowed-chart block): the published rows older than the first fresh Yahoo day go in front of it (Open, High, Low
 * and Volume as published, Adj Close rescaled by the overlapping days) and older published distributions are kept. A window
 * that cannot be joined counts as a failed chart, so the fund is kept as published.
 */
async function withPublishedHistory(ticker: string, fetched: { rows: any[]; dividends: ChartDividend[]; ok: boolean }): Promise<{ rows: any[]; dividends: ChartDividend[]; ok: boolean }> {
  if (activeConfig.historyRange === "max" || !fetched.rows.length) return fetched;
  const published = (await readPreviousSheet(ticker, "history")).rows;
  const distributions = dividendsFromPrevious(await readPreviousMeta(ticker)).map((item) => [new Date(item.epoch * 1000).toISOString().slice(0, 10), item.amount]);
  const merged = mergeWindowedChart({ days: fetched.rows, dividends: fetched.dividends }, published, distributions);
  if (!merged) {
    outputNote(`[ ${'history'.padEnd(8)} ] ${ticker} chart window does not join the published history (${activeConfig.historyRange})`);
    return { rows: [], dividends: [], ok: false };
  }
  const byDate = new Map<string, any>(published.map((row: any) => [String(row?.Date), row] as [string, any]));
  const firstFresh = String(fetched.rows[0].date);
  const rows = merged.days.map((day: any) => {
    if (day.date >= firstFresh) return day;
    const row = byDate.get(day.date);
    return { ...day, open: numberOrNull(row?.Open), high: numberOrNull(row?.High), low: numberOrNull(row?.Low), volume: numberOrNull(row?.Volume) };
  });
  return { rows, dividends: merged.dividends, ok: true };
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

// Yahoo's adjusted close is float32 and its last digits move with the request's period2, so a value
// sitting on a cent boundary (31.544998 vs 31.545001) flips between runs. Within that noise the
// published cent is kept: a rerun with the same source data changes nothing. Only the Yahoo rows
// pass through here; official NAV / market price / premium are merged afterwards.
export const ADJ_CLOSE_NOISE = 1e-4;
export function keepPublishedAdjClose(fresh: any[], publishedRows: any[]): any[] {
  const published = new Map<string, number>();
  for (const row of publishedRows ?? []) {
    const date = row?.Date ?? row?.date ?? null;
    const adjClose = numberOrNull(row?.["Adj Close"] ?? row?.adjClose);
    if (date && adjClose !== null) published.set(String(date), adjClose);
  }
  return (fresh ?? []).map((row: any) => {
    const prior = published.get(String(row?.date));
    const raw = typeof row?.adjCloseRaw === "number" ? row.adjCloseRaw : row?.adjClose;
    if (prior === undefined || typeof row?.adjClose !== "number" || row.adjClose === prior || typeof raw !== "number") return row;
    return Math.abs(raw - prior) <= 0.005 + ADJ_CLOSE_NOISE ? { ...row, adjClose: prior } : row;
  });
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

/** Which definition stands behind `dividendYield`: null exactly when the yield is null. */
export type DividendYieldBasis =
  | "official-trailing-12m" | "official-distribution-rate" | "official-other" | "computed-trailing-12m" | "indicated";

/** Vanguard's only yield source is the figure it publishes (definition not stated in the API), so every non-null yield is `official-other`. */
export const DIVIDEND_YIELD_KIND = "Vanguard published distribution yield";
const DIVIDEND_YIELD_BASIS_BY_KIND: Record<string, DividendYieldBasis> = { [DIVIDEND_YIELD_KIND]: "official-other" };

export function dividendYieldBasisOf(yieldValue: number | null | undefined, kind: string = DIVIDEND_YIELD_KIND): DividendYieldBasis | null {
  if (typeof yieldValue !== "number" || !Number.isFinite(yieldValue)) return null;
  return DIVIDEND_YIELD_BASIS_BY_KIND[kind] ?? "official-other";
}

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
  dividendYieldBasis: DividendYieldBasis | null;
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
    dividendYieldBasis: dividendYieldBasisOf(dividendYield),
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
  const metrics = buildMetrics({
    officialYtd: input.officialYtd,
    officialOneYear: input.officialOneYear,
    officialAsOf: toIsoDate(input.officialAsOf) || null,
    derived: summary(input.yahooRows),
    derivedYtd: ytdFromRows(input.yahooRows),
    dividendYield: input.dividendYield,
    secYield: input.secYield,
  });
  // the shared "younger than one year" rule: no horizon the fund is too young for (calendar anniversary), official or derived
  return withoutYoungReturns(metrics, input.inceptionDate, metrics.performanceAsOf, { tr1y: 1, tr3y: 3, cagr3y: 3, tr5y: 5, cagr5y: 5, tr10y: 10, cagr10y: 10, siAnn: 1 });
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
      dividendYieldKind: DIVIDEND_YIELD_KIND,
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

/** A previously published row keeps its yield, so it gets the code that describes it when it predates `dividendYieldBasis` (same key order as fresh rows). */
export function withYieldBasis(row: any): any {
  if (!row || typeof row !== "object" || !row.metrics || "dividendYieldBasis" in row.metrics) return row;
  const metrics: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row.metrics)) {
    metrics[key] = value;
    if (key === "dividendYieldText") metrics.dividendYieldBasis = dividendYieldBasisOf(row.metrics.dividendYield as number | null);
  }
  if (!("dividendYieldBasis" in metrics)) metrics.dividendYieldBasis = dividendYieldBasisOf(row.metrics.dividendYield as number | null);
  return { ...row, metrics };
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

/** Index row of a catalog fund with no published meta.json (new, its first refresh failed): dataFile null, 0 holdings and history rows, every metric null plus returnsBasis. */
export function catalogOnlyRow([ticker, name, category]: readonly [string, string, string]): any {
  const sheet = (pageSize: number) => ({ pages: [], pageSize, totalRows: 0, asOfDate: null, source: "not published yet" });
  const { row } = assembleFund({
    ticker, name, category, officialPage: null, portId: null, frequency: null, distributionRows: [], netAssets: null, netAssetsAsOf: null,
    totalFundNetAssets: null, expense: null, dividendYield: null, dividendYieldAsOf: null, secYield: null, secYieldAsOf: null,
    officialYtd: null, officialOneYear: null, officialAsOf: null, yahooRows: [], pageRows: [], holdings: sheet(250), history: sheet(1000),
  });
  return { ...row, dataFile: null };
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
        // A bond row carries its issuer's equity ticker (every Treasury is "T", AT&T's): debt stays identifier-keyed
        Ticker: label === "Bond" ? "—" : item?.ticker ?? item?.holdingTicker ?? item?.symbol ?? "—",
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
  return { rows: fillRoundedWeights(rows), asOf: asOf || (typeof rawAsOf === "string" ? rawAsOf : null) };
}

/** Rows whose published weight is at least this (in %) calibrate the market value -> weight factor; smaller ones are refilled. */
export const WEIGHT_CALIBRATION_MIN = 0.1;

/**
 * Vanguard rounds `marketValuePercentage` to two decimals and leaves it out for tiny positions: BND had 12,028 rows at
 * "0.00%" and 1,176 at "—", and many more rounded up to "0.01%", so its weights added up to 83.49%. Every such row
 * carries its market value, so a weight below WEIGHT_CALIBRATION_MIN (or a missing one) is recomputed as
 * market value x k with four decimals, where k = sum |weight| / sum |market value| over the rows of at least that weight
 * (same sign only). k keeps the published "% of net assets" basis, so a levered or cash-heavy fund keeps its own total.
 * Fewer than three calibration rows -> the rows are returned unchanged.
 */
export function fillRoundedWeights<T extends Record<string, unknown>>(rows: T[]): T[] {
  let weights = 0, values = 0, count = 0;
  for (const row of rows) {
    const weight = numberOrNull(row.Weight), value = numberOrNull(row["Market Value"]);
    if (weight === null || value === null || Math.abs(weight) < WEIGHT_CALIBRATION_MIN || Math.sign(weight) !== Math.sign(value)) continue;
    weights += Math.abs(weight);
    values += Math.abs(value);
    count++;
  }
  if (count < 3 || !(values > 0)) return rows;
  const k = weights / values;
  return rows.map((row) => {
    const weight = numberOrNull(row.Weight), value = numberOrNull(row["Market Value"]);
    if (value === null || value === 0 || (weight !== null && Math.abs(weight) >= WEIGHT_CALIBRATION_MIN)) return row;
    return { ...row, Weight: `${(value * k).toFixed(4)}%` };
  });
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
    outputNote(`[ ${'holdings'.padEnd(8)} ] ${ticker} ${error}`);
    return { holdings: null, officialHistory: [], ok: false };
  }
}

// ---------------------------------------------------------------------------
// Holdings source 2 (fallback): SEC EDGAR Form N-PORT-P. The shared nport-reader
// block at the end of this file finds, reads and checks the filing (the fund's
// own series, newest report period, registrant folder, strictly newer than the
// published holdings); this section loads the SEC tables and maps the sheet.
// ---------------------------------------------------------------------------

function secHeaders(): Record<string, string> {
  return { "User-Agent": activeConfig.secUa, Accept: "application/json, application/xml, text/xml, text/plain" };
}

async function fetchSecText(url: string, label: string): Promise<string> {
  const response = await httpFetch(url, { headers: secHeaders() });
  if (response.ok) return response.text();
  throw new Error(`${response.status} ${response.statusText} for ${label}`);
}

/** One run's SEC state: the two SEC ticker tables (each loaded once) and the N-PORT reader cache (submissions and documents). */
let secState: { funds: Promise<Map<string, NportSeriesRef>> | null; names: Promise<Map<string, string>> | null; reader: Map<string, unknown> } = { funds: null, names: null, reader: new Map() };

/** A fresh SEC state for a run (run() and tests). */
export function resetSecState(): void {
  secState = { funds: null, names: null, reader: new Map() };
}

/** SEC's ticker -> registrant CIK + series id table, loaded once per run (a failed load is asked again by the next fund). */
function loadFundTickerTable(): Promise<Map<string, NportSeriesRef>> {
  if (!secState.funds) {
    const loading = fetchSecText(SEC_FUND_TICKERS_URL, "[ edgar    ] fund ticker table").then((text) => parseSecFundTickers(JSON.parse(text)));
    secState.funds = loading;
    loading.catch(() => { if (secState.funds === loading) secState.funds = null; });
  }
  return secState.funds;
}

/** SEC's company name -> ticker table for the N-PORT rows, loaded once per run. */
function loadCompanyNames(): Promise<Map<string, string>> {
  if (!secState.names) {
    const loading = fetchSecText(SEC_COMPANY_TICKERS_URL, "[ edgar    ] company ticker table").then((text) => parseSecCompanyNames(JSON.parse(text)));
    secState.names = loading;
    loading.catch(() => { if (secState.names === loading) secState.names = null; });
  }
  return secState.names;
}

/** Nasdaq Trader symbol directories for the N-PORT rows (shared nport-reader `readUsListings`), loaded once per run: a row with a
 * foreign ISIN keeps a ticker only for the company's own U.S. listing in U.S. dollars (Linde, NXP, IMAX). null when either failed. */
let usListings: Promise<Map<string, string> | null> | null = null;
function loadUsListings(getText: (url: string, label: string) => Promise<string>): Promise<Map<string, string> | null> {
  if (!usListings) usListings = readUsListings(getText);
  return usListings;
}

/**
 * The Vanguard holdings sheet of an N-PORT filing: the 13 standard columns, plus Coupon and Maturity on debt rows. A missing
 * number or text is the sheet's "—" placeholder (never 0), a missing coupon or maturity "-"; tickers come from nportTickers
 * (U.S. equities only).
 */
export function nportHoldingRows(filing: NportFiling, tickers: ReadonlyArray<string>): Record<string, unknown>[] {
  return filing.positions.map((position, index) => ({
    Name: position.name || "—",
    Ticker: tickers[index] || "—",
    Identifier: nportIdentifier(position) || "—",
    Weight: nportCell(position.weight) || "—",
    "Market Value": nportCell(position.value, 2) || "—",
    "Shares Held": nportCell(position.balance) || "—",
    "Asset Category": position.assetCat || "—",
    Sector: "—",
    Exchange: "—",
    Location: "—",
    CUSIP: position.cusip || "—",
    ISIN: position.isin || "—",
    Currency: position.currency || "—",
    ...(position.maturity || position.coupon !== null ? { Coupon: nportCell(position.coupon) || "-", Maturity: position.maturity || "-" } : {}),
  }));
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
  resetSecState();
  const startedAt = Date.now();
  const deadline = startedAt + softDeadlineMs;
  const previousIndex = await readJsonOrNull(new URL("index.json", ROOT));
  const previousFunds: any[] = Array.isArray(previousIndex?.funds) ? previousIndex.funds : [];
  // Q27: a TICKERS entry outside the built-in list and the published funds stops the run before any request or write
  assertKnownTickers(config.tickers.length ? config.tickers : null, knownTickers(FUNDS_SEED.map(([ticker]) => ticker), previousFunds), "the Vanguard catalog or published feed");
  await mkdir(FUNDS, { recursive: true });
  const holdingsPageSize = config.holdingsPageSize;
  const historyPageSize = config.historyPageSize;
  const concurrency = config.concurrency;
  outputPrintConfig('Vanguard', configLogEntries(config));
  console.log(`[ catalog  ] ${FUNDS_SEED.length} Vanguard ETFs (built-in Vanguard ETF list, profiles from investor.vanguard.com)`);
  // A closed fund leaves the run here, before the MAX_FETCHES batch and any request: never fetched, guarded or reported.
  const staticSelection = withoutClosedFunds(FUNDS_SEED.filter((fund) => passesStaticFilters(fund, config)), (fund) => fund[0], CLOSED_FUNDS);
  outputPrintFilter(staticSelection.length, FUNDS_SEED.length, hasDeferredFilters(config));
  const stateFile = new URL("update-state.json", ROOT);
  const previousState = config.maxFetches > 0 ? await readJsonOrNull(stateFile) : null;
  const batch = selectBatch(staticSelection, config.maxFetches, previousState);
  const selected = batch.selected;
  if (config.maxFetches > 0) {
    console.log(`[ ${'cursor'.padEnd(8)} ] starting at ${staticSelection.length ? batch.startCursor + 1 : 0} of ${staticSelection.length}; processing ${selected.length}; next ${staticSelection.length ? (batch.nextCursor ?? 0) + 1 : 0}`);
  } else {
    await rm(stateFile, { force: true });
  }
  const output = outputCreateReporter(ROOT, selected.length);
  let failedCount = 0;
  // Failed funds with no published meta.json (new, first refresh failed): listed with a catalog-only row, never with files.
  const catalogOnly = new Map<string, any>();
  const perFundResults = await mapWithConcurrency(selected, concurrency, async ([ticker, name, category]) => {
    const before = await output.before(ticker);
    if (Date.now() > deadline) {
      await output.result(ticker, before, 'skipped', 'soft deadline reached; published data kept');
      return null;
    }
    try {
    const dir = new URL(`${ticker}/`, FUNDS);
    const [fetchedChart, official, vgAdditional] = await Promise.all([
      chart(ticker),
      officialProfile(ticker, name),
      vanguardAdditionalFundData(ticker),
    ]);
    const chartData = await withPublishedHistory(ticker, fetchedChart);
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
    // A new fund no source answered is never published as an empty meta.json: it fails with a catalog-only row.
    if (!official.ok && !vgAdditional.ok && !chartData.rows.length) {
      await output.result(ticker, before, 'failed', 'no source answered; no data published for this fund yet');
      catalogOnly.set(ticker, catalogOnlyRow([ticker, name, category]));
      failedCount += 1;
      return null;
    }

    // --- Holdings: Vanguard official feed -> SEC N-PORT-P -> previous sheet ---
    let holdingsRows: Record<string, unknown>[] = vgHoldings?.rows ?? [];
    let holdingsAsOf: string | null = vgHoldings?.asOf ?? null;
    let holdingsSource = holdingsRows.length
      ? "Vanguard investor profile holdings (IRR AdditionalFundData)"
      : "not available from current public sources";
    const prevMeta = await readPreviousMeta(ticker);
    if (!holdingsRows.length && config.edgarFallback) {
      try {
        // the fund's own newest filing, read only when strictly newer than the published holdings (shared nport-reader block)
        const ref = (await loadFundTickerTable()).get(ticker);
        const read = ref
          ? await readNportHoldings({ ticker, cik: ref.cik, seriesId: ref.seriesId }, { asOf: toIsoDate(prevMeta?.holdings?.asOfDate), rows: numberOrNull(prevMeta?.holdings?.totalRows) ?? 0 }, (url, label) => fetchSecText(url, `[ nport    ] ${label}`), { cache: secState.reader })
          : { problem: `${ticker}: not in the SEC fund ticker table` };
        if ("problem" in read) outputNote(`[ ${'nport'.padEnd(8)} ] ${read.problem}`);
        else {
          holdingsRows = nportHoldingRows(read.filing, nportTickers(read.filing.positions, await loadCompanyNames().catch(() => null), await loadUsListings((url, label) => fetchSecText(url, `[ nport    ] ${label}`))));
          holdingsAsOf = read.filing.repPdDate || null;
          holdingsSource = `SEC EDGAR Form N-PORT-P (accession ${read.candidate.accession}, report period ${read.filing.repPdDate || "n/a"})`;
        }
      } catch (error) {
        outputNote(`[ ${'nport'.padEnd(8)} ] ${ticker} ${error}`);
      }
    }
    // Fresh holdings (Vanguard IRR or N-PORT) that look broken (no weight column, non-numeric weights, a bad weight sum,
    // half the rows gone) never replace the published ones: the fund fails before anything of it is written.
    // No relax lets an all-non-numeric weight sheet replace a published sheet with numeric weights (Q24).
    const publishedHoldings = holdingsRows.length && prevMeta ? await readPreviousSheet(ticker, "holdings") : null;
    const publishedWeights = publishedHoldings ? holdingsWeightCount(publishedHoldings.headers, publishedHoldings.rows) : null;
    const holdingsProblem = holdingsRows.length ? holdingsGuard(standardHoldingHeaders(holdingsRows), holdingsRows, numberOrNull(prevMeta?.holdings?.totalRows), HOLDINGS_GUARD_RELAX[ticker] ?? HOLDINGS_GUARD_RELAX['*'] ?? [], publishedWeights) : null;
    if (holdingsProblem) {
      await output.result(ticker, before, 'failed', `holdings guard: ${holdingsProblem}; ${prevMeta ? 'published data kept' : 'no data published for this fund yet'}`);
      if (!prevMeta) catalogOnly.set(ticker, catalogOnlyRow([ticker, name, category]));
      failedCount += 1;
      return null;
    }
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
    const prevHistory = await readPreviousSheet(ticker, "history");
    historyRows = historyRows.length ? keepPublishedAdjClose(historyRows, prevHistory.rows) : internalHistoryRows(prevHistory.rows);
    if (!officialHistory.length) officialHistory = officialPointsFromPreviousRows(prevHistory.rows);
    if (!dividends.length && prevMeta) {
      dividends = dividendsFromPrevious(prevMeta);
    }

    // a HISTORY_RANGE window only bounds the Yahoo request: the older published rows were joined in withPublishedHistory
    const mergedHistoryRows = historyPageRows(historyRows, officialHistory);
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
      if (!(await readPreviousMeta(ticker))) catalogOnly.set(ticker, catalogOnlyRow([ticker, name, category]));
      failedCount += 1;
      return null;
    }
  });
  // Funds outside this run (TICKERS, category or MAX_FETCHES batch) keep their previously published catalog row.
  const fresh = new Map<string, any>();
  selected.forEach(([ticker], index) => { if (perFundResults[index]) fresh.set(ticker, perFundResults[index]); });
  const previousRows = new Map<string, any>(previousFunds.map((entry: any) => [String(entry?.ticker), entry]));
  const listed = new Set<string>(FUNDS_SEED.map(([ticker]) => ticker));
  // A closed fund keeps its published row even when it is no longer in the built-in list (closed funds are never pruned).
  const closedRows = CLOSED_FUNDS.filter((fund) => !listed.has(fund.ticker) && previousRows.has(fund.ticker)).map((fund) => withYieldBasis(previousRows.get(fund.ticker)));
  const catalog = FUNDS_SEED.map(([ticker]) => fresh.get(ticker) ?? withYieldBasis(previousRows.get(ticker)) ?? catalogOnly.get(ticker)).filter((entry) => entry != null)
    .concat(closedRows).sort((a, b) => (String(a.ticker) < String(b.ticker) ? -1 : String(a.ticker) > String(b.ticker) ? 1 : 0));
  // the 52-week range of every row from its published history pages (shared range-52w block)
  const nextIndex = buildIndex(await withRange52w(ROOT, markClosedFunds(catalog, CLOSED_FUNDS)));
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
  // Q28: a fund is announced on its first successful publish (a catalog-only row is not published), new catalog-only rows as pending
  const newFunds = newFundsLines(newFundsReport(previousFunds, nextIndex.funds));
  for (const line of newFunds) console.log(line);
  if (newFunds.length && process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### NEW FUNDS\n\n${newFunds.join("\n")}\n`, "utf8");
  if (config.maxFetches > 0) {
    const nextState = { cursor: batch.nextCursor ?? 0, tickers: staticSelection.map(([ticker]) => ticker) };
    const sameState = previousState && previousState.cursor === nextState.cursor && JSON.stringify(previousState.tickers) === JSON.stringify(nextState.tickers);
    if (!sameState) await writeAtomic(stateFile, JSON.stringify({ ...nextState, generatedAt: new Date().toISOString() }, null, 2) + "\n");
  }
  console.log(output.summary(startedAt));
  console.log(outputCounts(nextIndex.counts.funds, nextIndex.counts.holdings, nextIndex.counts.history));
  if (selected.length > 0 && failedCount === selected.length) throw new Error(`every selected fund failed (${failedCount}); published data kept`);
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
/** Legacy environment names that still work; `VANGUARD_<NAME>` is accepted for every control. The plain name wins, then the brand name, then these. */
export const ENV_ALIASES: Record<string, string[]> = { HISTORY_PAGE_SIZE: ["HISTORICAL_PAGE_SIZE"] };
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
    const value = [key, `VANGUARD_${key}`, ...(ENV_ALIASES[key] ?? [])].map((name) => env[name]).find((item) => item !== undefined);
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
(every control also reads VANGUARD_<NAME> from the environment, the plain name wins when both are set; HISTORICAL_PAGE_SIZE is an alias of HISTORY_PAGE_SIZE)
  MAX_FETCHES          0 means all selected funds; a positive value updates that many funds and resumes at the saved cursor next run
  REQUEST_SLEEP        seconds between fund updates (nonnegative number)
  CONCURRENCY          parallel fund update workers (integer >= 1)
  AUM                  fund net assets in dollars, min:max; K/M/B/T suffixes or nano/micro/small/mid/large presets
  TER                  expense ratio percent, min:max
  DIVIDEND_YIELD       Vanguard trailing dividend yield percent, min:max
  SEC_YIELD            30-day SEC yield percent, min:max
  TICKERS              only update these tickers, separated by spaces, commas or semicolons; empty means all; an unknown ticker is an error
  CATEGORY             keep funds whose category contains this text (case-insensitive), e.g. Bond or Sector
  HOLDINGS_PAGE_SIZE   rows in each generated current-holdings JSON page (integer >= 1)
  HISTORY_PAGE_SIZE    rows in each generated daily-history JSON page (integer >= 1)
  MAX_RETRIES          retries after the initial request of every source (integer 1-5, anything else is an error)
  HISTORY_RANGE        Yahoo request window: max or Ny (e.g. 5y); older published history is kept
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

// <holdings-guard> shared block of .claude/tools/etfs/etf-std/holdings-guard.block.ts, applied by apply-holdings-guard.ts: never edit it in one repo
/**
 * Sanity check of a fund's new holdings before they replace the published ones. Returns why they must be rejected
 * (the caller then keeps the fund's previous state and reports it as failed), or null when they may be written.
 * An empty sheet passes only when nothing was published before. Otherwise a Name and a weight column (Weight,
 * Weight (%) or Market Weight) are required, >= 80% of the rows carry a numeric weight, the weights add up to
 * 50..150 and the sheet keeps >= 50% of the previously published rows. `relax` switches off the checks a fund
 * legitimately fails: 'numeric' and 'sum' (geared, inverse, futures, look-through, top-N lists) and 'count'. No relax lets
 * a sheet without a single numeric weight replace a published sheet that had numeric weights (`previousWeights`: how many
 * rows of the published sheet carry a numeric weight, see holdingsWeightCount; open-items etfs Q24).
 * Rows are arrays in header order or objects keyed by the header text. A fund in the brand's CLOSED_FUNDS never reaches the guard.
 */
export function holdingsGuard(headers: ReadonlyArray<string>, rows: ReadonlyArray<unknown>, previousRows: number | null | undefined, relax: ReadonlyArray<string> = [], previousWeights: number | null = null): string | null {
  const previous = Number(previousRows) > 0 ? Number(previousRows) : 0;
  if (!rows.length) return previous ? `no holdings rows (${previous} published)` : null;
  const names = headers.map((header) => String(header).trim().toLowerCase());
  const nameAt = names.indexOf('name');
  let weightAt = names.indexOf('weight');
  if (weightAt < 0) weightAt = names.indexOf('weight (%)');
  if (weightAt < 0) weightAt = names.indexOf('market weight');
  if (nameAt < 0 || weightAt < 0) return `no ${nameAt < 0 ? 'Name' : 'weight'} column (headers: ${headers.join(', ') || 'none'})`;
  const weights = holdingsGuardWeights(headers, rows, weightAt);
  const numeric = weights.count;
  const sum = weights.sum;
  if (numeric === 0 && Number(previousWeights) > 0) return `no row has a numeric weight, the published sheet had ${Number(previousWeights)}`;
  if (relax.indexOf('numeric') < 0 && numeric < rows.length * 0.8) return `only ${numeric} of ${rows.length} rows have a numeric weight`;
  if (relax.indexOf('sum') < 0 && (sum < 50 || sum > 150)) return `weights add up to ${sum.toFixed(2)}, outside 50..150`;
  if (relax.indexOf('count') < 0 && previous && rows.length < previous * 0.5) return `${rows.length} rows, less than half of the ${previous} published`;
  return null;
}

/** How many rows carry a numeric weight (Weight, Weight (%) or Market Weight column), 0 without such a column: pass it for the published sheet as holdingsGuard's previousWeights. */
export function holdingsWeightCount(headers: ReadonlyArray<string>, rows: ReadonlyArray<unknown>): number {
  const names = headers.map((header) => String(header).trim().toLowerCase());
  let weightAt = names.indexOf('weight');
  if (weightAt < 0) weightAt = names.indexOf('weight (%)');
  if (weightAt < 0) weightAt = names.indexOf('market weight');
  return weightAt < 0 ? 0 : holdingsGuardWeights(headers, rows, weightAt).count;
}

/** Count and sum of the numeric weights in column weightAt; rows are arrays in header order or objects keyed by the header text. */
function holdingsGuardWeights(headers: ReadonlyArray<string>, rows: ReadonlyArray<unknown>, weightAt: number): { count: number; sum: number } {
  let count = 0;
  let sum = 0;
  for (let i = 0; i < rows.length; i++) {
    const row: any = rows[i];
    const weight = holdingsGuardNumber(Array.isArray(row) ? row[weightAt] : row && typeof row === 'object' ? row[headers[weightAt]] : undefined);
    if (weight !== null) {
      count++;
      sum += weight;
    }
  }
  return { count, sum };
}

/** A weight cell as a number: %, $, commas and spaces are ignored, (x) is negative; null when it is no plain number (a zero-width character inside counts as broken). */
function holdingsGuardNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let text = String(value === null || value === undefined ? '' : value).replace(/[ \t ,%$]/g, '').replace(/−/g, '-');
  const negative = /^\(.*\)$/.test(text);
  if (negative) text = text.slice(1, -1);
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)) return null;
  return negative ? -Number(text) : Number(text);
}

/** A fund its issuer closed (liquidated, delisted or merged away), confirmed from an official source: an SEC filing or the issuer's notice. */
export type ClosedFund = { ticker: string; closed: string; source: string };

/**
 * The brand's CLOSED_FUNDS entry for a ticker, or null. A closed fund is never fetched, never guarded and never reported failed: it keeps
 * its last published data and its index row carries `status: 'closed'`, `closedDate` and `closedSource`. A malformed entry throws, so a
 * typo (no ISO date, no https source) never ships.
 */
export function closedFund(list: ReadonlyArray<ClosedFund>, ticker: unknown): ClosedFund | null {
  const wanted = String(ticker === null || ticker === undefined ? '' : ticker).trim().toUpperCase();
  let found: ClosedFund | null = null;
  for (let i = 0; i < list.length; i++) {
    const fund = list[i];
    if (!/^[A-Z0-9][A-Z0-9.-]{0,9}$/.test(fund.ticker) || !/^\d{4}-\d{2}-\d{2}$/.test(fund.closed) || !/^https:\/\/\S+$/.test(fund.source)) throw new Error(`CLOSED_FUNDS: ${fund.ticker} needs an upper-case ticker, an ISO closing date and an https source`);
    if (fund.ticker === wanted) found = fund;
  }
  return found;
}

/** The index rows with every closed fund marked (`status: 'closed'`, `closedDate`, `closedSource`); other rows are returned as they are. */
export function markClosedFunds<T extends object>(rows: ReadonlyArray<T>, list: ReadonlyArray<ClosedFund>): T[] {
  return rows.map((row) => {
    const fund = closedFund(list, (row as { ticker?: unknown }).ticker);
    return fund ? ({ ...row, status: 'closed', closedDate: fund.closed, closedSource: fund.source } as T) : row;
  });
}

/** A run's queue without the closed funds, which are named once in the log: they are neither fetched nor counted as failed. */
export function withoutClosedFunds<T>(queue: ReadonlyArray<T>, tickerOf: (item: T) => string, list: ReadonlyArray<ClosedFund>): T[] {
  const closed: string[] = [];
  const open: T[] = [];
  for (let i = 0; i < queue.length; i++) {
    if (closedFund(list, tickerOf(queue[i]))) closed.push(tickerOf(queue[i]));
    else open.push(queue[i]);
  }
  if (closed.length) console.log(`[ closed   ] ${closed.join(', ')}: closed by the issuer, published data kept`);
  return open;
}
// </holdings-guard>

// <nport-reader> shared block of .claude/tools/etfs/etf-std/nport-reader.block.ts, applied by apply-block.ts: never edit it in one repo
/**
 * SEC EDGAR Form N-PORT-P holdings reader (open-items etfs ETF-H2), one copy for every brand. Pure functions plus one reader
 * that takes the brand's own `getText(url, label)` (its SEC User-Agent, timeout, retries and pacing). Rules it enforces:
 * - identifiers come from the position itself: `<cusip>` text (or a `value` attribute), `<isin value>`, `<ticker value>`,
 *   `<other value>`; a derivative's reference instrument (inside `<derivativeInfo>`) never lends its identifiers to the position
 * - CUSIP `000000000` and `N/A` are missing; a missing weight or value is null (an empty cell), never 0
 * - a ticker only for a common-stock row (assetCat EC, not a CVR, right, warrant or escrow line) traded in USD with a U.S.
 *   ISIN or none, or with a foreign ISIN when the Nasdaq Trader directories list that ticker for the same company (a U.S.
 *   listing such as Linde, NXP, IMAX); renamed issuers through `nportRenamedIssuers`; an abbreviated or reordered name the
 *   exact key misses through a looser key that must name one company (`nportLooseKey`, Q35: `Lowe's Cos` = `LOWES COMPANIES`,
 *   `SCHWAB CHARLES CORP`); never one ticker on two different securities (`nportTickers`)
 * - identity: the filing must name the fund's own series id, or, with no series id known, the fund's name (`nportIdentity`)
 * - freshness: the report period must be strictly newer than the published holdings (`nportIsFresh`)
 * - filings come newest report period first from the registrant's own archive folder, never from the filer agent's CIK
 *   (the accession number prefix)
 */
export type NportPosition = {
  name: string;
  title: string;
  lei: string;
  cusip: string;
  isin: string;
  ticker: string;
  other: string;
  otherDesc: string;
  balance: number | null;
  units: string;
  currency: string;
  /** valUSD, null when the filing has none */
  value: number | null;
  /** pctVal: percent of net assets (0.5 = 0.5%), null when the filing has none */
  weight: number | null;
  payoff: string;
  assetCat: string;
  issuerCat: string;
  country: string;
  /** derivCat of the position's derivativeInfo (FUT, FWD, SWP, OPT, ...), empty for a security */
  derivative: string;
  /** debtSec annualizedRt and maturityDt (ISO), null and '' for a non-debt row */
  coupon: number | null;
  maturity: string;
};

export type NportFiling = {
  seriesId: string;
  seriesName: string;
  regName: string;
  regCik: string;
  /** report period end (genInfo repPdDate) as ISO, '' when missing */
  repPdDate: string;
  netAssets: number | null;
  totalAssets: number | null;
  positions: NportPosition[];
};

export type NportCandidate = { accession: string; filed: string; period: string; cik: string };
export type NportSeriesRef = { cik: string; seriesId: string; classId: string };

/** XML text: entities decoded, tags dropped, whitespace collapsed. */
function nportText(raw: string): string {
  return String(raw)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_m: string, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m: string, dec: string) => String.fromCharCode(Number(dec)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/[\s ]+/g, ' ')
    .trim();
}

/** Text of the first `<tag>` (any namespace prefix) in `xml`, '' when absent. */
function nportTag(xml: string, tag: string): string {
  const match = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_.-]+:)?${tag}>`, 'i').exec(xml);
  return match ? nportText(match[1]) : '';
}

/** The `attribute` of the first `<tag ...>` (any namespace prefix) in `xml`, '' when absent. */
function nportAttr(xml: string, tag: string, attribute: string): string {
  const match = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${tag}\\s[^>]*?\\b${attribute}\\s*=\\s*"([^"]*)"`, 'i').exec(xml);
  return match ? nportText(match[1]) : '';
}

/** A plain decimal or exponent number, null for an empty, N/A or broken cell. */
function nportNumber(raw: string): number | null {
  const text = String(raw).replace(/[\s,]/g, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** An identifier code, '' for N/A, NONE and all zeros (CUSIP 000000000 means "no CUSIP"). */
function nportCode(raw: string): string {
  const text = String(raw).trim().toUpperCase();
  return !text || /^(N\/?A|NONE|-+|0+)$/.test(text) ? '' : text;
}

/** ISO date of an N-PORT date (YYYY-MM-DD, possibly with a time), '' otherwise. */
function nportIso(raw: unknown): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw === null || raw === undefined ? '' : raw).trim());
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

/** One N-PORT-P primary_doc.xml (or the full submission .txt that embeds it) as series facts and positions. */
export function parseNportFiling(xml: string): NportFiling {
  const text = String(xml === null || xml === undefined ? '' : xml);
  const genInfo = /<(?:[A-Za-z0-9_.-]+:)?genInfo\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?genInfo>/i.exec(text);
  const fundInfo = /<(?:[A-Za-z0-9_.-]+:)?fundInfo\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?fundInfo>/i.exec(text);
  const gen = genInfo ? genInfo[1] : '';
  const fund = fundInfo ? fundInfo[1].replace(/<(?:[A-Za-z0-9_.-]+:)?returnInfo\b[\s\S]*?<\/(?:[A-Za-z0-9_.-]+:)?returnInfo>/gi, ' ') : '';
  const positions: NportPosition[] = [];
  const blocks = /<(?:[A-Za-z0-9_.-]+:)?invstOrSec\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?invstOrSec>/gi;
  let block: RegExpExecArray | null;
  while ((block = blocks.exec(text)) !== null) {
    const raw = block[1];
    const derivativeInfo = /<(?:[A-Za-z0-9_.-]+:)?derivativeInfo\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?derivativeInfo>/i.exec(raw);
    // The reference instrument of a derivative (SPY for a SPY option, a bond for a CDS) is another security: drop it first.
    const own = raw.replace(/<(?:[A-Za-z0-9_.-]+:)?derivativeInfo\b[^>]*>[\s\S]*?<\/(?:[A-Za-z0-9_.-]+:)?derivativeInfo>/gi, ' ');
    const identifiers = /<(?:[A-Za-z0-9_.-]+:)?identifiers\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?identifiers>/i.exec(own);
    const ids = identifiers ? identifiers[1] : '';
    const debt = /<(?:[A-Za-z0-9_.-]+:)?debtSec\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?debtSec>/i.exec(own);
    const name = nportTag(own, 'name');
    positions.push({
      name: name && !/^N\/?A$/i.test(name) ? name : nportTag(own, 'title'),
      title: nportTag(own, 'title'),
      lei: nportCode(nportTag(own, 'lei')),
      cusip: nportCode(nportTag(own, 'cusip') || nportAttr(ids, 'cusip', 'value')),
      isin: nportCode(nportAttr(ids, 'isin', 'value')),
      ticker: nportCode(nportAttr(ids, 'ticker', 'value')),
      other: nportCode(nportAttr(ids, 'other', 'value')),
      otherDesc: nportAttr(ids, 'other', 'otherDesc'),
      balance: nportNumber(nportTag(own, 'balance')),
      units: nportTag(own, 'units'),
      currency: (nportTag(own, 'curCd') || nportAttr(own, 'currencyConditional', 'curCd')).toUpperCase(),
      value: nportNumber(nportTag(own, 'valUSD')),
      weight: nportNumber(nportTag(own, 'pctVal')),
      payoff: nportTag(own, 'payoffProfile'),
      assetCat: (nportTag(own, 'assetCat') || nportAttr(own, 'assetConditional', 'assetCat')).toUpperCase(),
      issuerCat: (nportTag(own, 'issuerCat') || nportAttr(own, 'issuerConditional', 'issuerCat')).toUpperCase(),
      country: nportTag(own, 'invCountry').toUpperCase(),
      derivative: derivativeInfo ? (/\bderivCat\s*=\s*"([^"]*)"/i.exec(derivativeInfo[1]) || ['', 'OTHER'])[1].toUpperCase() : '',
      coupon: debt ? nportNumber(nportTag(debt[1], 'annualizedRt')) : null,
      maturity: debt ? nportIso(nportTag(debt[1], 'maturityDt')) : '',
    });
  }
  return {
    seriesId: nportTag(gen, 'seriesId').toUpperCase(),
    seriesName: nportTag(gen, 'seriesName'),
    regName: nportTag(gen, 'regName'),
    regCik: nportTag(gen, 'regCik').replace(/\D/g, ''),
    repPdDate: nportIso(nportTag(gen, 'repPdDate')),
    netAssets: nportNumber(nportTag(fund, 'netAssets')),
    totalAssets: nportNumber(nportTag(fund, 'totAssets')),
    positions,
  };
}

/**
 * A number as sheet text: '' for null, no exponent, at most `digits` decimals (trailing zeros dropped), and no binary float
 * artifact: `115797518.01` stays `115797518.01`, not the `115797518.01000001` of `toFixed(8)`.
 */
export function nportCell(value: number | null, digits = 8): string {
  if (value === null || !Number.isFinite(value)) return '';
  const fixed = value.toFixed(digits);
  // the shortest text of the rounded number; toFixed only where that text would be an exponent (very small or large numbers)
  const shortest = String(Number(fixed));
  if (!/e/i.test(shortest)) return shortest;
  return fixed.indexOf('.') < 0 ? fixed : fixed.replace(/0+$/, '').replace(/\.$/, '');
}

/** The position's own identifier for a sheet: CUSIP, else ISIN, else the "other" code (a Bloomberg or internal id), else ''. */
export function nportIdentifier(position: NportPosition): string {
  return position.cusip || position.isin || position.other;
}

/**
 * A company name as a lookup key: upper case, punctuation and legal suffixes dropped, `CLASS A` -> `CL A`. Initials are one
 * word whether written with dots, spaces or a slash (`N.V.` = `N V` = `NV`, `C.H. ROBINSON` = `C H ROBINSON`, `A/S` = `A S`,
 * `S.A.B. de C.V.` = `SAB DE CV`), `PUBLIC LIMITED COMPANY` is `plc`, and a leading `US` stays (`U.S. BANCORP` is not
 * `BANCORP, INC.`), so both spellings of one issuer give one key.
 */
export function nportNameKey(value: unknown): string {
  // EDGAR adds a state or qualifier suffix to company titles ("COSTCO WHOLESALE CORP /NEW", "BANK OF AMERICA CORP /DE/",
  // "US BANCORP \DE\", "ACUITY INC. (DE)"): drop a trailing one
  const raw = String(value === null || value === undefined ? '' : value).replace(/(?:\s*(?:[\/\\]\s*[A-Za-z]{2,3}\s*[\/\\]?|\(\s*[A-Za-z]{2,3}\s*\)))+\s*$/, '');
  let text = nportText(raw).toUpperCase().replace(/['’]/g, '').replace(/&/g, ' AND ').replace(/[^A-Z0-9]+/g, ' ').trim();
  text = text.replace(/\bCLASS\s+([A-Z])\b/g, 'CL $1').replace(/\bCL\s+([A-Z])\b/g, 'CL $1');
  // a run of single letters is one word, never the class letter after CL
  const words: string[] = [];
  let joining = false;
  text.split(' ').forEach((word) => {
    const letter = /^[A-Z]$/.test(word);
    if (letter && joining) words[words.length - 1] += word;
    else words.push(word);
    joining = letter && (joining || words[words.length - 2] !== 'CL');
  });
  text = words.join(' ').replace(/\bPUBLIC (?:(?:LIMITED|LTD)(?: (?:COMP[A-Z]*|CO))?|(?:COMPANY|CO) (?:LIMITED|LTD))\b/g, 'PLC').replace(/\b(?:S DE RL )?DE CV\b/g, ' ');
  const share = /\bCL [A-Z]\b/.exec(text);
  text = text.replace(/\b(THE|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|PLC|SA|SAB|NV|AG|SE|SPA|AS|ASA|ORDINARY|COMMON|STOCK|SHS|SHARES|ADR|DEPOSITARY|RECEIPT|USD|US|REG|REGISTERED)\b/g, (word: string, _name: string, at: number) => (word === 'US' && at === 0 ? word : ' ')).replace(/\s+/g, ' ').trim();
  if (share && !/\bCL [A-Z]\b/.test(text)) text = `${text} ${share[0]}`;
  return text;
}

/**
 * Abbreviated words of issuer names (open-items etfs Q35) -> one spelling, each seen in N-PORT-P filings of the brands against
 * the SEC company_tickers.json title of the same CUSIP issuer (2026-10-26): `LOWES COS` / `LOWES COMPANIES`, `AMERIPRISE FINL`,
 * `VICI PPTYS`, `TAIWAN SEMICONDUCTOR MFG`, `ZIONS BANCORP NA` / `ZIONS BANCORPORATION NATIONAL ASSOCIATION`. '' drops the word.
 */
function nportLooseWords(): Record<string, string> {
  return {
    COS: '', COMPANIES: '', AND: '', OF: '', NA: '', NATIONAL_ASSOCIATION: '', INCORPORATION: '', REIT: '',
    BANCORPORATION: 'BANCORP', FINL: 'FINANCIAL', PPTYS: 'PROPERTIES', PPTY: 'PROPERTY', MFG: 'MANUFACTURING', GRP: 'GROUP',
    HLDGS: 'HOLDINGS', HLDG: 'HOLDING', INTL: 'INTERNATIONAL', SVCS: 'SERVICES', TECH: 'TECHNOLOGIES', TECHNOLOGY: 'TECHNOLOGIES',
    SYS: 'SYSTEMS', NATL: 'NATIONAL', RES: 'RESOURCES', RLTY: 'REALTY', INDS: 'INDUSTRIES', INS: 'INSURANCE', BROS: 'BROTHERS', SVGS: 'SAVINGS',
  };
}

/**
 * The second, looser company key (open-items etfs Q35), used only for a row the exact key (`nportNameKey`) left without a
 * ticker: a Bloomberg location or article after a slash dropped (`Charles Schwab Corp/The`, `Energy Fuels Inc/canada`; never a
 * one-word start like `RE/MAX`), abbreviations read as one word (`nportLooseWords`), the share class dropped (the caller picks
 * the class) and the words sorted, so EDGAR's reordered titles meet the usual order: `SCHWAB CHARLES CORP` = `Charles Schwab
 * Corp`, `HORTON D R INC` = `DR Horton Inc`, `PRICE T ROWE GROUP INC` = `T Rowe Price Group Inc`. Several companies can share a
 * loose key: `parseSecCompanyNames` and `parseUsListings` keep such a key empty, so it never gives a ticker.
 */
export function nportLooseKey(value: unknown): string {
  let raw = String(value === null || value === undefined ? '' : value).trim();
  const slash = /^(.*\s\S*[A-Za-z]{2}[.,]?)\s*\/\s*([A-Za-z][A-Za-z .,']*)$/.exec(raw);
  if (slash) raw = slash[1];
  // a trailing EDGAR or Bloomberg qualifier after the legal form: `CHEVRON CORP NEW`, `US BANCORP DEL`, `PROGRESSIVE CORP OHIO`
  raw = raw.replace(/\b(CORP(?:ORATION)?|INC(?:ORPORATED)?|CO(?:MPANY)?|LTD|BANCORP|GROUP|GRP|TRUST|HOLDINGS?)\.?,?\s+(?:NEW|DEL|REINCORPORATION|OHIO|AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\.?$/i, '$1');
  const words = nportLooseWords();
  const key = nportNameKey(raw).replace(/ CL [A-Z]$/, '').replace(/\bNATIONAL ASSOCIATION\b/g, 'NATIONAL_ASSOCIATION');
  return key.split(' ').map((word) => (Object.prototype.hasOwnProperty.call(words, word) ? words[word] : word)).filter(Boolean).sort().join(' ');
}

/**
 * SEC company_tickers.json -> name key -> ticker (the first, largest company wins a shared key; the class-less key is added too).
 * Each loose key (`nportLooseKey`) is added as `\u0001<loose key>` -> the company's tickers, space-separated in the table's
 * order, or '' when two companies (CIKs) share it; `nportTickers` reads them for rows the exact key misses.
 */
export function parseSecCompanyNames(payload: unknown): Map<string, string> {
  const names = new Map<string, string>();
  const loose = new Map<string, { cik: string; tickers: string[] } | null>();
  const rows = payload && typeof payload === 'object' ? Object.keys(payload as object).map((key) => (payload as Record<string, unknown>)[key]) : [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as { ticker?: unknown; title?: unknown; cik_str?: unknown } | null;
    if (!row || typeof row !== 'object') continue;
    const ticker = String(row.ticker === null || row.ticker === undefined ? '' : row.ticker).trim().toUpperCase();
    const key = nportNameKey(row.title);
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker) || !key) continue;
    if (!names.has(key)) names.set(key, ticker);
    const core = key.replace(/ CL [A-Z]$/, '');
    if (core && !names.has(core)) names.set(core, ticker);
    const looseKey = nportLooseKey(row.title);
    const cik = String(row.cik_str === null || row.cik_str === undefined ? '' : row.cik_str).replace(/\D/g, '');
    if (!looseKey || !Number(cik)) continue;
    const seen = loose.get(looseKey);
    if (seen === undefined) loose.set(looseKey, { cik: String(Number(cik)), tickers: [ticker] });
    else if (seen && seen.cik === String(Number(cik))) { if (seen.tickers.indexOf(ticker) < 0) seen.tickers.push(ticker); }
    else loose.set(looseKey, null);
  }
  loose.forEach((seen, looseKey) => names.set(`\u0001${looseKey}`, seen ? seen.tickers.join(' ') : ''));
  return names;
}

/** SEC company_tickers_mf.json -> fund ticker -> registrant CIK (10 digits), series id, class id. */
export function parseSecFundTickers(payload: unknown): Map<string, NportSeriesRef> {
  const map = new Map<string, NportSeriesRef>();
  const record = (payload && typeof payload === 'object' ? payload : {}) as { fields?: unknown; data?: unknown };
  const fields = Array.isArray(record.fields) ? record.fields.map(String) : [];
  const rows = Array.isArray(record.data) ? record.data : [];
  const at = (row: unknown[], field: string): string => (fields.indexOf(field) < 0 ? '' : String(row[fields.indexOf(field)] === null || row[fields.indexOf(field)] === undefined ? '' : row[fields.indexOf(field)]).trim());
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const ticker = at(row, 'symbol').toUpperCase();
    const cik = at(row, 'cik').replace(/\D/g, '');
    const seriesId = at(row, 'seriesId').toUpperCase();
    if (!ticker || !Number(cik) || !/^S\d{9}$/.test(seriesId) || map.has(ticker)) continue;
    map.set(ticker, { cik: `0000000000${Number(cik)}`.slice(-10), seriesId, classId: at(row, 'classId').toUpperCase() });
  }
  return map;
}

/**
 * Is the row a contingent value right, a right, a warrant or an escrow line filed as equity? A placeholder CUSIP or ISIN
 * (`436CVR021`, `US009CVR0445`, `549ESC028`, `866CNT017`) says so; so does the name or title (`NOVO NORDISK A/S - CVR`,
 * `XYZ INC RIGHTS`, `... WARRANT FEB 2026`, `Luby's Inc Escrow`), except on a CUSIP with the common-stock issue number 10
 * (Schwab titles Enovix common stock 293594107 "Enovix Corp Warrants"). `CVR` as the first word is a company (CVR Energy).
 */
function nportIsRight(position: NportPosition): boolean {
  if (/^[0-9A-Z]{3}(?:CVR|ESC|CNT)/.test(position.cusip) || /^US[0-9A-Z]{3}(?:CVR|ESC|CNT)/.test(position.isin)) return true;
  if (/^[0-9A-Z]{6}10[0-9]$/.test(position.cusip)) return false;
  return [position.name, position.title].some((text) => /\S\s*\bCVRS?\b|\bCONTINGENT\b|\bRIGHTS?\b|\bRTS\b|\bWARRANTS?\b|\bWTS\b|\bESCROW\b/i.test(text));
}

/**
 * Renamed issuers (open-items etfs Q33): N-PORT filers keep an issuer's old name for months while SEC's company_tickers.json
 * titles only the new one, so the name match misses (JPMorgan JEPI's Exxon). Old name key (`nportNameKey`) -> [ticker, CUSIP
 * issuer number (the first six characters)]. Used only when the SEC table has no such key, the row's CUSIP (or U.S. ISIN) has
 * that issuer number and the SEC table still lists the ticker. Each entry was confirmed on 2026-10-26: an EC row without a
 * ticker in the N-PORT-P filings of large U.S. equity funds (VTI, SCHB, ITOT, JEPI, IWB, VB, SCHA, FNDX, FNDA, ...) whose name
 * is a former EDGAR name of the CIK that has the ticker today (data.sec.gov submissions `formerNames`, the date the old name
 * ended), the ticker the CIK's only common stock in the Nasdaq Trader directories. Add an entry only with the same evidence.
 * A function, not a const: blocks sit at the end of update-data.ts, below the top-level run, so only declarations are hoisted.
 */
export function nportRenamedIssuers(): Array<[string, string, string]> {
  return [
    ['AADI BIOSCIENCE', 'WHWK', '00032Q'], // CIK 1422142 Whitehawk Therapeutics, Inc., former EDGAR name until 2025-03-18
    ['ABACUS LIFE', 'ABX', '00258Y'], // CIK 1814287 Abacus Global Management, Inc., former EDGAR name until 2025-02-04
    ['ACUITY BRANDS', 'AYI', '00508Y'], // CIK 1144215 ACUITY INC. (DE), former EDGAR name until 2025-04-17
    ['AEROVATE THERAPEUTICS', 'JBIO', '008064'], // CIK 1798749 Jade Biosciences, Inc., former EDGAR name until 2025-04-30
    ['AILERON THERAPEUTICS', 'RNTX', '00887A'], // CIK 1420565 Rein Therapeutics, Inc., former EDGAR name until 2024-12-09
    ['ALLOVIR', 'KLRS', '482929'], // CIK 1754068 Kalaris Therapeutics, Inc., former EDGAR name until 2025-03-12
    ['AMC NETWORKS', 'AMCX', '00164V'], // CIK 1514991 AMC Global Media Inc., former EDGAR name until 2026-04-03
    ['AMMO', 'POWW', '00175J'], // CIK 1015383 Outdoor Holding Co, former EDGAR name until 2025-04-24
    ['ARDENT HEALTH PARTNERS', 'ARDT', '03980N'], // CIK 1756655 Ardent Health, Inc., former EDGAR name until 2025-05-23
    ['ARENA GROUP HOLDINGS', 'PAAI', '040044'], // CIK 894871 Paradium.AI, Inc., former EDGAR name until 2026-08-13
    ['ATEGRITY SPECIALTY HOLDINGS LLC', 'ASIC', '04681Y'], // CIK 2040491 Ategrity Specialty Insurance Co Holdings, former EDGAR name until 2025-06-11
    ['BAKKT HOLDINGS', 'BKKT', '05759B'], // CIK 1820302 Bakkt, Inc., former EDGAR name until 2026-01-20
    ['BED BATH AND BEYOND', 'NXH', '690370'], // CIK 1130713 NEIGHBORHOOD INTELLIGENCE, INC., former EDGAR name until 2026-08-14
    ['BLACKROCK FUNDING', 'BLK', '09290D'], // CIK 2012383 BlackRock, Inc., former EDGAR name until 2024-10-01
    ['BRIGHTSPHERE INVESTMENT GROUP', 'AAMI', '10948W'], // CIK 1748824 Acadian Asset Management Inc., former EDGAR name until 2024-11-14
    ['CARA THERAPEUTICS', 'TVRD', '140755'], // CIK 1346830 Tvardi Therapeutics, Inc., former EDGAR name until 2025-04-11
    ['CEA INDUSTRIES', 'BNC', '86887P'], // CIK 1482541 BNB Standard Corp, former EDGAR name until 2026-09-21
    ['CHROMADEX', 'NAGE', '171077'], // CIK 1386570 Niagen Bioscience, Inc., former EDGAR name until 2025-03-10
    ['CLEANCORE SOLUTIONS', 'ZONE', '184492'], // CIK 1956741 Zone Frontier Inc., former EDGAR name until 2026-08-20
    ['CORPORATE OFFICE PROPERTIES TRUST', 'CDP', '22002T'], // CIK 860546 COPT DEFENSE PROPERTIES, former EDGAR name until 2023-09-14
    ['CULLINAN ONCOLOGY', 'CGEM', '230031'], // CIK 1789972 Cullinan Therapeutics, Inc., former EDGAR name until 2024-04-02
    ['DIME COMMUNITY BANCSHARES', 'DCOM', '25432X'], // CIK 846617 Dime Commercial Bancshares, Inc. /NY/, former EDGAR name until 2026-05-27
    ['DOMO', 'HUCK', '257554'], // CIK 1505952 Huckleberry.ai, Inc., former EDGAR name until 2026-09-03
    ['EASTSIDE DISTILLING', 'BLNE', '277802'], // CIK 1534708 Beeline Holdings, Inc., former EDGAR name until 2025-03-11
    ['EQUITY RESIDENTIAL', 'VMRK', '29476L'], // CIK 906107 VIVMARK RESIDENTIAL, former EDGAR name until 2026-08-12
    ['EXP WORLD HOLDINGS', 'AGNT', '30212W'], // CIK 1495932 AGNT, Inc., former EDGAR name until 2026-06-01
    ['EXXON MOBIL', 'XOM', '30231G'], // holding company reorganization: XOM is CIK 2115436 ExxonMobil Holdings Corp since 2026, the old Exxon Mobil Corp is CIK 34088
    ['EYEPOINT PHARMACEUTICALS', 'EYPT', '30233G'], // CIK 1314102 EyePoint, Inc., former EDGAR name until 2025-12-08
    ['EZFILL HOLDINGS', 'NXXT', '652941'], // CIK 1817004 NEXTNRG, INC., former EDGAR name until 2025-02-14
    ['FORTUNE BRANDS HOME AND SECURITY', 'FBIN', '34964C'], // CIK 1519751 Fortune Brands Innovations, Inc., former EDGAR name until 2022-12-14
    ['FRANKLIN RESOURCES', 'BEN', '354613'], // CIK 38777 FRANKLIN TEMPLETON INC, former EDGAR name until 2026-08-14
    ['FREYR BATTERY', 'TE', '35834F'], // CIK 1992243 T1 Energy Inc., former EDGAR name until 2025-02-14
    ['GALLAGHER ARTHUR J AND', 'AJG', '363576'], // CIK 354190 Arthur J. Gallagher & Co., former EDGAR name until 2019-08-14
    ['GRAINGER WW', 'GWW', '384802'], // CIK 277135 W.W. GRAINGER, INC., former EDGAR name until 2019-10-15
    ['GRAY TELEVISION', 'GTN', '389375'], // CIK 43196 GRAY MEDIA, INC, former EDGAR name until 2025-02-24
    ['GREAT AJAX', 'RPT', '38983D'], // CIK 1614806 Rithm Property Trust Inc., former EDGAR name until 2024-11-13
    ['GREENIDGE GENERATION HOLDINGS', 'VIP', '39531G'], // CIK 1844971 Vulcan Infrastructure & Power Inc., former EDGAR name until 2026-07-09
    ['HANNON ARMSTRONG SUSTAINABLE INFRASTRUCTURE CAPITAL', 'HASI', '41068X'], // CIK 1561894 HA Sustainable Infrastructure Capital, Inc., former EDGAR name until 2024-07-02
    ['HARTFORD FINANCIAL SERVICES GROUP', 'HIG', '416515'], // CIK 874766 HARTFORD INSURANCE GROUP, INC., former EDGAR name until 2025-01-30
    ['HELIX ENERGY SOLUTIONS GROUP', 'HOS', '42330P'], // CIK 866829 HORNBECK OFFSHORE SERVICES, INC., former EDGAR name until 2026-08-31
    ['HYSTER YALE MATERIALS HANDLING', 'HY', '449172'], // CIK 1173514 HYSTER-YALE, INC., former EDGAR name until 2024-05-30
    ['IAC', 'PPLI', '44891N'], // CIK 1800227 People Inc, former EDGAR name until 2026-06-02
    ['IDENTIV', 'INVE', '45170X'], // CIK 1036044 INVE Technologies, Inc., former EDGAR name until 2026-08-25
    ['IRHYTHM TECHNOLOGIES', 'IRTC', '450056'], // CIK 1388658 iRhythm Holdings, Inc., former EDGAR name until 2026-01-12
    ['ISSUER DIRECT', 'ACCS', '46520M'], // CIK 843006 ACCESS Newswire Inc., former EDGAR name until 2025-01-16
    ['JANOVER', 'DFDV', '47100L'], // CIK 1805526 DeFi Development Corp., former EDGAR name until 2025-04-15
    ['JOHN BEAN TECHNOLOGIES', 'JBTM', '477839'], // CIK 1433660 JBT MAREL Corp, former EDGAR name until 2024-12-20
    ['LENDINGCLUB', 'HAPN', '52603A'], // CIK 1409970 Happen, Inc., former EDGAR name until 2026-06-18
    ['LIXTE BIOTECHNOLOGY HOLDINGS', 'NMAD', '539319'], // CIK 1335105 NOMAD POWER SOLUTIONS, INC., former EDGAR name until 2026-07-02
    ['MKS INSTRUMENTS', 'MKSI', '55306N'], // CIK 1049502 MKS INC, former EDGAR name until 2025-05-15
    ['MONTANA TECHNOLOGIES', 'AIRJ', '612160'], // CIK 1855474 AirJoule Technologies Corp., former EDGAR name until 2024-10-21
    ['MULTIPLAN', 'CTEV', '62548M'], // CIK 1793229 Claritev Corp, former EDGAR name until 2025-02-07
    ['NEWPARK RESOURCES', 'NPKI', '651718'], // CIK 71829 NPK International Inc., former EDGAR name until 2024-12-03
    ['ONCOLOGY INSTITUTE', 'STLN', '68236X'], // CIK 1799191 Starling Oncology, Inc., former EDGAR name until 2026-08-03
    ['OREILLY AUTOMOTIVE', 'ORLY', '67103H'], // CIK 898173 O REILLY AUTOMOTIVE INC, former EDGAR name until 1998-04-10
    ['ORION OFFICE REIT', 'ONL', '68629Y'], // CIK 1873923 Orion Properties Inc., former EDGAR name until 2025-03-07
    ['PALTALK', 'IPM', '69764K'], // CIK 1355839 INTELLIGENT PROTECTION MANAGEMENT CORP., former EDGAR name until 2025-01-02
    ['PARAMOUNT SKYDANCE', 'SKYD', '69932A'], // CIK 2041610 Skydance Corp, former EDGAR name until 2026-10-06
    ['PIEDMONT OFFICE REALTY TRUST', 'PDM', '720190'], // CIK 1042776 Piedmont Realty Trust, Inc., former EDGAR name until 2025-06-02
    ['PIERIS PHARMACEUTICALS', 'PVLA', '697947'], // CIK 1583648 PALVELLA THERAPEUTICS, INC., former EDGAR name until 2024-12-12
    ['PLUS THERAPEUTICS', 'CNSY', '72941H'], // CIK 1095981 CERENOME, INC., former EDGAR name until 2026-07-01
    ['RUMBLE', 'RUM', '78137L'], // CIK 1830081 RUM Group Inc., former EDGAR name until 2026-06-17
    ['SCHWEITZER MAUDUIT INTERNATIONAL', 'MATV', '808541'], // CIK 1000623 Mativ Holdings, Inc., former EDGAR name until 2022-07-01
    ['SEQLL', 'CIRC', '048592'], // CIK 1605888 CIRCLE8 GROUP INC, former EDGAR name until 2024-06-06
    ['SHOE CARNIVAL', 'SHOE', '824889'], // CIK 895447 SHOE STATION GROUP INC, former EDGAR name until 2026-06-11
    ['TANGER FACTORY OUTLET CENTERS', 'SKT', '875465'], // CIK 899715 TANGER INC., former EDGAR name until 2023-11-15
    ['TECNOGLASS', 'TGLS', '87877F'], // CIK 1534675 Tecnoglass Holdings Inc., former EDGAR name until 2026-07-07
    ['TEMPUR SEALY INTERNATIONAL', 'SGI', '88023U'], // CIK 1206264 SOMNIGROUP INTERNATIONAL INC., former EDGAR name until 2025-02-14
    ['TEVOGEN BIO HOLDINGS', 'TVGN', '88165K'], // CIK 1860871 Tevogen Inc., former EDGAR name until 2026-07-30
    ['TORO COMBINECO', 'TTGT', '87874R'], // CIK 2018064 TechTarget, Inc., former EDGAR name until 2024-11-20
    ['VIAD', 'PRSU', '92552R'], // CIK 884219 Pursuit Attractions & Hospitality, Inc., former EDGAR name until 2024-12-31
    ['WELLGISTICS HEALTH', 'MEDS', '949503'], // CIK 2030763 DataMeds AI, Inc., former EDGAR name until 2026-07-21
    ['ZOOM VIDEO COMMUNICATIONS', 'ZM', '98980L'], // CIK 1585521 Zoom Communications, Inc., former EDGAR name until 2024-11-12
    ['ZYMEWORKS DELAWARE', 'ZYME', '98985Y'], // CIK 1937653 Zymeworks Inc., former EDGAR name until 2022-10-13
  ];
}

/** Nasdaq Trader symbol directories: Nasdaq listings, and NYSE, NYSE American, NYSE Arca, Cboe and IEX listings. */
export function nportUsListingsUrls(): string[] {
  return ['https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt', 'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt'];
}

/**
 * The Nasdaq Trader symbol directories (the texts of `nportUsListingsUrls()`, in any order) as U.S.-listed symbol -> security
 * name; test issues and ETFs left out, CQS class dots as SEC dashes (`BRK.B` -> `BRK-B`). An issuer listed under several
 * symbols (Liberty Global LBTYA, LBTYB, LBTYK) also gets the entry `\u0000<name key>` -> its symbols, which `nportUsListed` reads
 * to require the share class. null unless every text is a whole directory (a header with Security Name and the File Creation
 * Time footer), so a failed or cut download changes nothing.
 */
export function parseUsListings(texts: ReadonlyArray<string>): Map<string, string> | null {
  const listings = new Map<string, string>();
  if (!texts.length) return null;
  for (let t = 0; t < texts.length; t++) {
    const lines = String(texts[t] === null || texts[t] === undefined ? '' : texts[t]).split(/\r?\n/).filter((line) => line.trim());
    const header = (lines[0] || '').split('|').map((cell) => cell.trim().toUpperCase());
    const nameAt = header.indexOf('SECURITY NAME'), testAt = header.indexOf('TEST ISSUE'), etfAt = header.indexOf('ETF');
    if (nameAt < 0 || !/^FILE CREATION TIME/i.test(lines[lines.length - 1] || '')) return null;
    for (let i = 1; i < lines.length - 1; i++) {
      const cells = lines[i].split('|');
      const symbol = String(cells[0] || '').trim().toUpperCase().replace(/[./ ]/g, '-');
      if (!symbol || String(cells[testAt] || '').trim() === 'Y' || String(cells[etfAt] || '').trim() === 'Y' || listings.has(symbol)) continue;
      listings.set(symbol, String(cells[nameAt] || '').trim());
    }
  }
  const issuers = new Map<string, string[]>();
  const loose = new Map<string, string[]>();
  listings.forEach((name, symbol) => {
    const key = nportNameKey(nportIssuerName(name));
    if (key) issuers.set(key, (issuers.get(key) || []).concat(symbol));
    const looseKey = nportLooseKey(nportIssuerName(name));
    if (looseKey && nportListedCommon(name)) loose.set(looseKey, (loose.get(looseKey) || []).concat(symbol));
  });
  issuers.forEach((symbols, key) => { if (symbols.length > 1) listings.set(`\u0000${key}`, symbols.join(' ')); });
  loose.forEach((symbols, looseKey) => listings.set(`\u0001${looseKey}`, symbols.join(' ')));
  return listings;
}

/** Is a symbol directory security name a company's own common or ordinary shares (not preferred, depositary, notes, warrants, units, rights)? */
function nportListedCommon(name: string): boolean {
  return !/\bDEPOSITARY\b|\bADSS?\b|\bADRS?\b|\bREGISTRY\b|\bPREFERRED\b|\bPREF\b|\bPFD\b|\bNOTES?\b|\bDEBENTURES?\b|\bWARRANTS?\b|\bUNITS?\b|\bRIGHTS?\b|%|\bDUE\s+\d{4}\b|\bPERPETUAL\b|\bCUMULATIVE\b|\bSUBORDINATED\b|\bTRUST\s+(?:SECURITIES|CERTIFICATES)\b|\bETNS?\b|\bEXCHANGE[- ]TRADED\b/i.test(name);
}

/** The share class a name or title states (`Class C`, `CL C`, `Series A`, `LIBERTY GLOBAL-C`), '' for none. */
function nportShareClass(...texts: unknown[]): string {
  for (let i = 0; i < texts.length; i++) {
    const text = String(texts[i] === null || texts[i] === undefined ? '' : texts[i]);
    const match = /\b(?:CLASS|CL|SERIES|SER)\.?\s+([A-Z])\b/i.exec(text) || /[A-Z]-\s?([A-Z])(?:\s|$)/i.exec(text);
    if (match) return match[1].toUpperCase();
  }
  return '';
}

/** Both symbol directories through the brand's `getText`, null when one fails (`parseUsListings`); load once per run. */
export async function readUsListings(getText: (url: string, label: string) => Promise<string>): Promise<Map<string, string> | null> {
  try {
    return parseUsListings(await Promise.all(nportUsListingsUrls().map((url) => getText(url, `Nasdaq Trader ${url.replace(/^.*\//, '')}`))));
  } catch {
    return null;
  }
}

/** A security or sheet name without its share description: `Accenture plc Class A Ordinary Shares (Ireland)` -> `Accenture plc`. */
function nportIssuerName(value: unknown): string {
  return String(value === null || value === undefined ? '' : value).split(' - ')[0]
    .replace(/\s+(?:\(|(?:CLASS|SERIES)\s+[A-Z]\b|COMMON\b|ORDINARY\b|SUBORDINATE\b|SUB\.?\s+VOT|(?:LIMITED|RESTRICTED)\s+VOTING\b|VOTING\b|SHARES?\b|STOCK\b|AMERICAN\s+DEPOSITARY\b|TRADING\s+UNDER\b)[\s\S]*$/i, '');
}

/**
 * Is `ticker` the company's own U.S. listing? The Nasdaq Trader directories (`parseUsListings`) list it under the same company
 * (same name key, or one key the start of the other: `BUNGE GLOBAL` and the directory's `BUNGE`, a name cut short after two words
 * or more: `CHECK POINT SOFTWARE TECH`), and not as depositary or New York registry shares, which are another security than
 * the foreign line (Shell's SHEL ADR, ASML's New York shares). When the issuer has several listed classes, the name or title
 * must state the listed class (Liberty Latin America Class C is LILAK, not LILA). False without listings. Callers check that
 * the line trades in U.S. dollars: a Toronto or London line of the same company in its own currency never gets the U.S. ticker.
 */
export function nportUsListed(listings: Map<string, string> | null, ticker: string, name: unknown, title: unknown = ''): boolean {
  if (!listings) return false;
  const listed = listings.get(String(ticker).trim().toUpperCase().replace(/[./ ]/g, '-'));
  if (listed === undefined || /\bDEPOSITARY\b|\bADSS?\b|\bADRS?\b|\bREGISTRY\b/i.test(listed)) return false;
  const a = nportNameKey(nportIssuerName(listed)), b = nportNameKey(nportIssuerName(name));
  if (!a || !b) return false;
  const short = a.length < b.length ? a : b, long = a.length < b.length ? b : a;
  if (a !== b && !(short.length >= 4 && long.indexOf(`${short} `) === 0) && !(short.split(' ').length >= 2 && long.indexOf(short) === 0)) return false;
  const listedClass = nportShareClass(listed);
  return !listedClass || !listings.has(`\u0000${a}`) || nportShareClass(name, title) === listedClass;
}

/**
 * Exchange tickers for the positions, in their order ('' for none). A ticker is given only to a common-stock row (assetCat
 * EC; a preferred EP, a CVR, right, warrant or escrow line gets none, a name match would give it the issuer's common ticker):
 * - U.S. ISIN or none, traded in USD (or with no currency): the filer's own `<ticker value>`, else the SEC issuer-name table
 *   (`names`) when the row has a CUSIP or a U.S. ISIN, else a renamed issuer (`nportRenamedIssuers`)
 * - foreign ISIN (Linde IE, NXP NL, IMAX CA): only traded in USD and only when the symbol directories (`listings`,
 *   `parseUsListings`) confirm the filer's or the name-matched ticker for the same company (`nportUsListed`); a local line in
 *   another currency, and every foreign row without listings, gets none
 * A ticker that lands on two different securities (Alphabet A and C, an ordinary share and its ADR) is dropped from the
 * name-matched rows; when the filer itself gave it to two securities it is dropped from all of them. Rows still without a
 * ticker get the second, looser name match (`nportLooseTickers`), which never changes a ticker given here. Bonds, cash, funds
 * and derivatives stay identifier-keyed.
 */
export function nportTickers(positions: ReadonlyArray<NportPosition>, names: Map<string, string> | null = null, listings: Map<string, string> | null = null): string[] {
  const fromFiler: boolean[] = [];
  const secTickers = new Set<string>();
  if (names) names.forEach((ticker, key) => { if (key.charAt(0) !== '\u0001') secTickers.add(ticker); });
  const renames = nportRenamedIssuers();
  const renamed = (position: NportPosition, key: string): string => {
    const issuer = (position.cusip || (/^US[0-9A-Z]{10}$/.test(position.isin) ? position.isin.slice(2, 11) : '')).slice(0, 6);
    const hit = renames.filter((entry) => entry[0] === key && entry[2] === issuer && secTickers.has(entry[1]))[0];
    return hit ? hit[1] : '';
  };
  const tickers = positions.map((position, index) => {
    fromFiler[index] = false;
    const equity = position.assetCat === 'EC' && !position.derivative && !nportIsRight(position);
    const foreign = Boolean(position.isin) && position.isin.slice(0, 2) !== 'US';
    const usd = foreign ? position.currency === 'USD' && Boolean(listings) : !position.currency || position.currency === 'USD';
    if (!equity || !usd) return '';
    const filer = /^[A-Z][A-Z0-9.-]{0,9}$/.test(position.ticker) ? position.ticker : '';
    const key = nportNameKey(position.name);
    const named = names && (/^[0-9A-Z]{9}$/.test(position.cusip) || /^[A-Z]{2}[0-9A-Z]{10}$/.test(position.isin)) ? names.get(key) || names.get(key.replace(/ CL [A-Z]$/, '')) || '' : '';
    if (!foreign) {
      fromFiler[index] = Boolean(filer);
      return filer || named || (names ? renamed(position, key) : '');
    }
    if (filer && nportUsListed(listings, filer, position.name, position.title)) {
      fromFiler[index] = true;
      return filer;
    }
    return named && nportUsListed(listings, named, position.name, position.title) ? named : '';
  });
  const securities = new Map<string, { keys: string[]; filer: string[] }>();
  tickers.forEach((ticker, index) => {
    if (!ticker) return;
    const position = positions[index];
    const key = position.cusip || position.isin || position.other || nportNameKey(position.name);
    const seen = securities.get(ticker) || { keys: [], filer: [] };
    if (seen.keys.indexOf(key) < 0) seen.keys.push(key);
    if (fromFiler[index] && seen.filer.indexOf(key) < 0) seen.filer.push(key);
    securities.set(ticker, seen);
  });
  const exact = tickers.map((ticker, index) => {
    const seen = ticker ? securities.get(ticker) : undefined;
    if (!seen || seen.keys.length < 2) return ticker;
    return seen.filer.length === 1 && fromFiler[index] ? ticker : '';
  });
  return nportLooseTickers(positions, exact, names, listings);
}

/**
 * The second name match (open-items etfs Q35) for the common-stock rows `nportTickers` left without a ticker; the tickers it
 * already gave never change. The row's loose key (`nportLooseKey`) must name one company: in the SEC table (`\u0001` entries of
 * `parseSecCompanyNames`, one CIK) and/or in the symbol directories (`\u0001` entries of `parseUsListings`, common shares only),
 * and when both know the key they must agree on the company. Of that company's tickers only its listed common shares count
 * (with one SEC ticker and no listing, that ticker); several of them (Fox, Lennar, Zillow) need the class the row states in its
 * name or title, matched to the listed security name, else no ticker. A foreign ISIN needs the directory listing of the same
 * key (its own U.S. shares, never depositary ones). A ticker that a row of `exact` holds for another security, or that this pass
 * finds for two securities, is dropped.
 */
function nportLooseTickers(positions: ReadonlyArray<NportPosition>, exact: string[], names: Map<string, string> | null, listings: Map<string, string> | null): string[] {
  if (!names) return exact;
  const companyOf = new Map<string, string>();
  names.forEach((tickers, key) => { if (key.charAt(0) === '\u0001' && tickers) tickers.split(' ').forEach((ticker) => companyOf.set(ticker, key)); });
  const securityOf = (position: NportPosition): string => position.cusip || position.isin || position.other || nportNameKey(position.name);
  const listedClass = (symbol: string): string => nportShareClass(listings ? listings.get(symbol) : '');
  const found = positions.map((position, index) => {
    if (exact[index] || position.assetCat !== 'EC' || position.derivative || nportIsRight(position)) return '';
    const foreign = Boolean(position.isin) && position.isin.slice(0, 2) !== 'US';
    if (foreign ? position.currency !== 'USD' || !listings : position.currency && position.currency !== 'USD') return '';
    if (!/^[0-9A-Z]{9}$/.test(position.cusip) && !/^[A-Z]{2}[0-9A-Z]{10}$/.test(position.isin)) return '';
    const key = nportLooseKey(position.name);
    if (!key) return '';
    const sec = names.get(`\u0001${key}`);
    const listed = listings ? listings.get(`\u0001${key}`) : undefined;
    if (sec === '' || (sec === undefined && listed === undefined) || (foreign && !listed)) return '';
    const listedSymbols = listed ? listed.split(' ') : [];
    // the company: the SEC entry of the key, else the one SEC entry every listed symbol of the key belongs to
    const company = sec !== undefined ? `\u0001${key}` : companyOf.get(listedSymbols[0]) || '';
    if (!company || listedSymbols.some((symbol) => companyOf.get(symbol) !== company)) return '';
    const tickers = String(names.get(company) || '').split(' ').filter(Boolean);
    const common = tickers.filter((ticker) => listings && listings.has(ticker) && nportListedCommon(String(listings.get(ticker))));
    const candidates = common.length ? common : tickers.length === 1 && !foreign ? tickers : [];
    if (foreign && candidates.some((ticker) => listedSymbols.indexOf(ticker) < 0)) return '';
    const wanted = nportShareClass(position.name, position.title);
    if (candidates.length === 1) return !wanted || !listings || !listings.has(candidates[0]) || !listedClass(candidates[0]) || listedClass(candidates[0]) === wanted ? candidates[0] : '';
    const classed = wanted ? candidates.filter((ticker) => listedClass(ticker) === wanted) : [];
    return classed.length === 1 ? classed[0] : '';
  });
  const taken = new Map<string, string[]>();
  exact.forEach((ticker, index) => { if (ticker) taken.set(ticker, (taken.get(ticker) || []).concat(securityOf(positions[index]))); });
  found.forEach((ticker, index) => {
    if (!ticker) return;
    const seen = taken.get(ticker) || [];
    if (seen.indexOf(securityOf(positions[index])) < 0) taken.set(ticker, seen.concat(securityOf(positions[index])));
  });
  return exact.map((ticker, index) => ticker || (found[index] && (taken.get(found[index]) || []).length === 1 ? found[index] : ''));
}

/** The browse-edgar Atom feed of one series' NPORT-P filings. */
export function nportSeriesFeedUrl(seriesId: string, count = 10): string {
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(String(seriesId).toUpperCase())}&type=NPORT-P&dateb=&owner=include&count=${count}&output=atom`;
}

/** The registrant's submissions JSON (report periods of its recent filings). */
export function nportSubmissionsUrl(cik: string): string {
  return `https://data.sec.gov/submissions/CIK${`0000000000${Number(String(cik).replace(/\D/g, '')) || 0}`.slice(-10)}.json`;
}

/** primary_doc.xml of a filing in the registrant's own folder. Throws without a registrant CIK: the accession prefix is the filer agent. */
export function nportDocumentUrl(registrantCik: string, accession: string): string {
  const cik = Number(String(registrantCik).replace(/\D/g, ''));
  if (!cik) throw new Error(`N-PORT ${accession}: no registrant CIK (the accession prefix is the filer agent, never used as the folder)`);
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${String(accession).replace(/-/g, '')}/primary_doc.xml`;
}

/** NPORT-P entries of a browse-edgar Atom feed (amendments and other forms skipped), with the registrant CIK of the filing link. */
export function parseNportFeed(atom: string): NportCandidate[] {
  const out: NportCandidate[] = [];
  const entries = /<entry>([\s\S]*?)<\/entry>/gi;
  let entry: RegExpExecArray | null;
  while ((entry = entries.exec(String(atom === null || atom === undefined ? '' : atom))) !== null) {
    const body = entry[1];
    const form = (nportTag(body, 'filing-type') || nportAttr(body, 'category', 'term')).toUpperCase();
    const accession = nportTag(body, 'accession-number');
    if (form !== 'NPORT-P' || !/^\d{10}-\d{2}-\d{6}$/.test(accession)) continue;
    const folder = /\/Archives\/edgar\/data\/(\d+)\//i.exec(nportTag(body, 'filing-href'));
    out.push({ accession, filed: nportIso(nportTag(body, 'filing-date')), period: nportIso(nportTag(body, 'period')), cik: folder ? folder[1] : '' });
  }
  return out;
}

/** NPORT-P filings of a registrant's submissions JSON (`filings.recent`), with report periods; the registrant is the JSON's own CIK. */
export function parseNportSubmissions(payload: unknown): NportCandidate[] {
  const record = (payload && typeof payload === 'object' ? payload : {}) as { cik?: unknown; filings?: { recent?: Record<string, unknown> } };
  const recent = record.filings && record.filings.recent ? record.filings.recent : {};
  const column = (name: string): unknown[] => (Array.isArray(recent[name]) ? (recent[name] as unknown[]) : []);
  const forms = column('form'), accessions = column('accessionNumber'), filed = column('filingDate'), periods = column('reportDate');
  const cik = String(record.cik === null || record.cik === undefined ? '' : record.cik).replace(/\D/g, '');
  const out: NportCandidate[] = [];
  for (let i = 0; i < forms.length; i++) {
    const accession = String(accessions[i] === null || accessions[i] === undefined ? '' : accessions[i]);
    if (String(forms[i]).toUpperCase() !== 'NPORT-P' || !/^\d{10}-\d{2}-\d{6}$/.test(accession)) continue;
    out.push({ accession, filed: nportIso(filed[i]), period: nportIso(periods[i]), cik });
  }
  return out;
}

/**
 * Candidates newest report period first, then newest filing: a late filing for an older period never wins. A missing
 * period is taken from `known` (the registrant's submissions) by accession; candidates still without one go last.
 */
export function nportNewestFirst(candidates: ReadonlyArray<NportCandidate>, known: ReadonlyArray<NportCandidate> = []): NportCandidate[] {
  const periods = new Map<string, string>();
  for (let i = 0; i < known.length; i++) if (known[i].period) periods.set(known[i].accession, known[i].period);
  return candidates
    .map((candidate) => (candidate.period ? candidate : { ...candidate, period: periods.get(candidate.accession) || '' }))
    .sort((a, b) => (a.period && b.period ? b.period.localeCompare(a.period) : a.period ? -1 : b.period ? 1 : 0) || b.filed.localeCompare(a.filed));
}

/**
 * Does the filing belong to the fund? With a series id: only the same series id. Without one: the normalized series name
 * equals the fund name, or (`loose`, reported to the caller) one contains the other. Returns the problem, or null.
 */
export function nportIdentity(filing: Pick<NportFiling, 'seriesId' | 'seriesName'>, fund: { seriesId?: string | null; name?: string | null }): { problem: string | null; loose: boolean } {
  const wantedSeries = String(fund.seriesId || '').trim().toUpperCase();
  if (wantedSeries) return { problem: filing.seriesId === wantedSeries ? null : `names series ${filing.seriesId || 'none'}, not ${wantedSeries}`, loose: false };
  const filed = nportNameKey(filing.seriesName), wanted = nportNameKey(fund.name);
  if (!filed || !wanted) return { problem: 'no series id and no fund name to match', loose: false };
  if (filed === wanted) return { problem: null, loose: false };
  if (filed.indexOf(wanted) >= 0 || wanted.indexOf(filed) >= 0) return { problem: null, loose: true };
  return { problem: `names series "${filing.seriesName}", not "${String(fund.name)}"`, loose: false };
}

/**
 * May a filing replace the published holdings? Nothing published (no rows): any dated or undated report. Otherwise only a
 * report period strictly newer than the published holdings date; both must be ISO dates (convert the brand's display
 * date first), an unknown date on either side keeps the published sheet.
 */
export function nportIsFresh(repPdDate: unknown, publishedAsOf: unknown, publishedRows: unknown): boolean {
  if (!(Number(publishedRows) > 0)) return true;
  const report = nportIso(repPdDate), published = nportIso(publishedAsOf);
  return Boolean(report && published && String(publishedAsOf).trim().length === 10 && report > published);
}

export type NportRead = { filing: NportFiling; candidate: NportCandidate; url: string; loose: boolean } | { problem: string };

/**
 * The newest N-PORT-P filing of one fund, or why there is none. Candidates: the series' Atom feed (when a series id is known;
 * an empty feed means no filing yet) with periods from the registrant's submissions, else (no series id, or the feed failed)
 * the registrant's NPORT-P filings themselves; newest period first.
 * Documents are read until one passes the identity check (at most `maxDocuments`); that newest own filing is returned only
 * when it is fresh against the published holdings (`published.asOf` ISO, `published.rows`). Errors of the optional
 * submissions request are tolerated; others come back as `problem`. `cache` (one Map per run) keeps the submissions and
 * the parsed documents, so funds of one registrant share requests.
 */
export async function readNportHoldings(
  fund: { ticker: string; cik: string; seriesId?: string | null; name?: string | null },
  published: { asOf?: unknown; rows?: unknown },
  getText: (url: string, label: string) => Promise<string>,
  options: { maxDocuments?: number; cache?: Map<string, unknown> } = {},
): Promise<NportRead> {
  const cache = options.cache || new Map<string, unknown>();
  const once = async <T>(key: string, load: () => Promise<T>): Promise<T> => {
    if (!cache.has(key)) cache.set(key, load().catch((error: unknown) => { cache.delete(key); throw error; }));
    return (await cache.get(key)) as T;
  };
  const cik = String(fund.cik || '').replace(/\D/g, '');
  if (!Number(cik)) return { problem: `${fund.ticker}: no registrant CIK` };
  let known: NportCandidate[] = [];
  try {
    known = await once(`submissions:${Number(cik)}`, async () => parseNportSubmissions(JSON.parse(await getText(nportSubmissionsUrl(cik), `${fund.ticker} N-PORT periods`))));
  } catch {
    known = [];
  }
  // null: no series feed (no series id, or the feed failed), so the registrant's own NPORT-P filings are scanned instead
  let candidates: NportCandidate[] | null = null;
  try {
    if (fund.seriesId) candidates = parseNportFeed(await getText(nportSeriesFeedUrl(fund.seriesId), `${fund.ticker} N-PORT filings`));
  } catch (error) {
    if (!known.length) return { problem: `${fund.ticker}: N-PORT filings unavailable (${error instanceof Error ? error.message : String(error)})` };
  }
  const sorted = nportNewestFirst(candidates || known, known);
  if (!sorted.length) return { problem: `${fund.ticker}: no NPORT-P filing yet` };
  const limit = Math.max(1, options.maxDocuments || (candidates ? 3 : 12));
  const misses: string[] = [];
  for (let i = 0; i < sorted.length && i < limit; i++) {
    const candidate = sorted[i];
    const url = nportDocumentUrl(Number(candidate.cik) ? candidate.cik : cik, candidate.accession);
    let filing: NportFiling;
    try {
      filing = await once(`document:${url}`, async () => parseNportFiling(await getText(url, `${fund.ticker} N-PORT ${candidate.accession}`)));
    } catch (error) {
      misses.push(`${candidate.accession} unreadable (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    const identity = nportIdentity(filing, fund);
    if (identity.problem) {
      misses.push(`${candidate.accession} ${identity.problem}`);
      continue;
    }
    if (!filing.positions.length) return { problem: `${fund.ticker}: ${candidate.accession} has no positions` };
    if (!nportIsFresh(filing.repPdDate, published.asOf, published.rows)) return { problem: `${fund.ticker}: N-PORT ${filing.repPdDate || 'undated'} is not newer than the published holdings (${String(published.asOf || 'undated')})` };
    return { filing, candidate, url, loose: identity.loose };
  }
  return { problem: `${fund.ticker}: no N-PORT-P filing of its own${misses.length ? `: ${misses.join('; ')}` : ''}` };
}
// </nport-reader>

// <calendar-dates> shared block of .claude/tools/etfs/etf-std/calendar-dates.block.ts, applied by apply-block.ts: never edit it in one repo
/**
 * A calendar date as ISO `YYYY-MM-DD`, or null. Pure text work, never `Date.parse` or local getters, so a run in Tokyo
 * publishes the same day as CI (open-items etfs ETF-H4). Accepts ISO (`2026-10-24`, with a time the date part is kept as
 * written), `2026/10/24`, U.S. `10/24/2026` and `10-24-26` (two-digit years up to 69 are 20xx), month names in either order
 * (`Oct 24, 2026`, `October 24 2026`, `Sept. 30, 2026`, `24 Oct 2026`, `24-Oct-26`), an optional weekday or `as of` in front.
 * A day that does not exist (`02/30/2026`) is null.
 */
export function calendarIso(value: unknown): string | null {
  const text = String(value === null || value === undefined ? '' : value).replace(/[\s ]+/g, ' ').trim()
    .replace(/^as of:? /i, '').replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,? /i, '');
  const year = (raw: string): number => (raw.length === 2 ? (Number(raw) <= 69 ? 2000 : 1900) + Number(raw) : Number(raw));
  const month = (raw: string): number => {
    const word = raw.toLowerCase();
    const names = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    for (let i = 0; i < names.length; i++) if (word.length >= 3 && names[i].indexOf(word) === 0) return i + 1;
    return 0;
  };
  let y = 0, m = 0, d = 0, match: RegExpExecArray | null;
  if ((match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(text)) || (match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(text))) {
    y = Number(match[1]); m = Number(match[2]); d = Number(match[3]);
  } else if ((match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})$/.exec(text))) {
    y = year(match[3]); m = Number(match[1]); d = Number(match[2]);
  } else if ((match = /^([A-Za-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$/.exec(text))) {
    y = Number(match[3]); m = month(match[1]); d = Number(match[2]);
  } else if ((match = /^(\d{1,2})(?:st|nd|rd|th)?[ -]([A-Za-z]{3,9})\.?,?[ -](\d{4}|\d{2})$/.exec(text))) {
    y = year(match[3]); m = month(match[2]); d = Number(match[1]);
  } else {
    return null;
  }
  const days = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (y < 1900 || y > 2999 || m < 1 || m > 12 || d < 1 || d > days[m - 1]) return null;
  return `${y}-${m < 10 ? '0' : ''}${m}-${d < 10 ? '0' : ''}${d}`;
}

/**
 * Is the fund at least `years` old on `asOf`? Calendar anniversary, inclusive: a fund started 2025-10-24 is one year old on
 * 2026-10-24 (a 29 February start on 1 March). Unknown or unreadable dates answer true, so a value is never dropped for want
 * of a date. The shared "younger than one year" rule: since-inception returns are annualized only from one year on.
 */
export function fundAgeAtLeast(inception: unknown, asOf: unknown, years: number): boolean {
  const start = calendarIso(inception), end = calendarIso(asOf);
  if (!start || !end) return true;
  return end >= `${Number(start.slice(0, 4)) + years}${start.slice(4)}`;
}

/**
 * The returns with every horizon the fund is too young for set to null: `horizons` maps a key of `returns` to the years it
 * needs (`{ yr1: 1, cagr3y: 3, siAnn: 1 }`). Keys that are absent or already null stay as they are; the object is copied.
 */
export function withoutYoungReturns<T extends object>(returns: T, inception: unknown, asOf: unknown, horizons: Record<string, number>): T {
  const out: Record<string, unknown> = { ...(returns as Record<string, unknown>) };
  const keys = Object.keys(horizons);
  for (let i = 0; i < keys.length; i++) {
    if (out[keys[i]] !== undefined && out[keys[i]] !== null && !fundAgeAtLeast(inception, asOf, horizons[keys[i]])) out[keys[i]] = null;
  }
  return out as T;
}
// </calendar-dates>

// <windowed-chart> shared block of .claude/tools/etfs/etf-std/windowed-chart.block.ts, applied by apply-block.ts: never edit it in one repo
export type WindowedChartDay = { date: string; close: number; adjClose: number; volume: number; adjCloseRaw?: number };
export type WindowedChartDividend = { epoch: number; amount: number };

/**
 * A HISTORY_RANGE window (`period1` N years back) never shrinks the published history, and with it the 3y, 5y, 10y and
 * since-inception returns (open-items etfs Q25; was a byte-identical copy in Fidelity, Invesco and JPMorgan). The published
 * rows older than the first fresh day are put in front of the fresh days; their Adj Close is rescaled by the ratio measured on
 * the overlapping days (Yahoo re-adjusts the whole series after each distribution). Published distributions older than the
 * window are kept as well. Returns the chart unchanged when nothing published is older, and null when the window cannot be
 * joined safely (no overlap, Close changed, inconsistent or implausible ratio): the caller then keeps the fund as published.
 * `published` rows carry `Date` (any calendarIso form), `Close`, `Adj Close`, `Volume`; distribution rows are
 * [date, amount, ...] arrays. The chart's days must be sorted by ISO date.
 */
export function mergeWindowedChart<C extends { days: WindowedChartDay[]; dividends: WindowedChartDividend[] }>(chart: C, published: ReadonlyArray<Record<string, unknown>>, publishedDistributions: ReadonlyArray<unknown> = []): C | null {
  if (!chart.days.length || !published.length) return chart;
  const num = (value: unknown): number | null => {
    const text = String(value === null || value === undefined ? '' : value).replace(/[\s,$]/g, '');
    return text && Number.isFinite(Number(text)) ? Number(text) : null;
  };
  const firstFresh = chart.days[0].date;
  const rows: Array<{ date: string; close: number; adjClose: number; volume: number }> = [];
  for (let i = 0; i < published.length; i++) {
    const date = calendarIso(published[i].Date), close = num(published[i].Close), adjClose = num(published[i]['Adj Close']);
    if (date && close !== null && adjClose !== null && adjClose > 0) rows.push({ date, close, adjClose, volume: num(published[i].Volume) || 0 });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const older = rows.filter((row) => row.date < firstFresh);
  if (!older.length) return chart;
  const byDate = new Map<string, { close: number; adjClose: number }>();
  for (let i = 0; i < rows.length; i++) byDate.set(rows[i].date, rows[i]);
  const adjRatios: number[] = [];
  const closeRatios: number[] = [];
  for (let i = 0; i < chart.days.length; i++) {
    const day = chart.days[i];
    const prior = byDate.get(day.date);
    if (!prior) continue;
    adjRatios.push((day.adjCloseRaw === undefined ? day.adjClose : day.adjCloseRaw) / prior.adjClose);
    if (prior.close > 0) closeRatios.push(day.close / prior.close);
  }
  if (!adjRatios.length) return null;
  const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
  if (closeRatios.length && Math.abs(mean(closeRatios) - 1) > 1e-3) return null;
  if (Math.max.apply(null, adjRatios) / Math.min.apply(null, adjRatios) - 1 > 5e-3) return null;
  const measured = mean(adjRatios);
  if (measured < 0.5 || measured > 1.001) return null;
  const factor = Math.abs(measured - 1) < 1e-4 ? 1 : measured;
  const days: WindowedChartDay[] = older.map((row) => {
    const raw = row.adjClose * factor;
    return { date: row.date, close: row.close, adjClose: factor === 1 ? row.adjClose : Math.round(raw * 100) / 100, volume: row.volume, adjCloseRaw: raw };
  });
  const firstFreshEpoch = Date.UTC(Number(firstFresh.slice(0, 4)), Number(firstFresh.slice(5, 7)) - 1, Number(firstFresh.slice(8, 10))) / 1000;
  const kept: WindowedChartDividend[] = [];
  for (let i = 0; i < publishedDistributions.length; i++) {
    const cells = publishedDistributions[i];
    const date = Array.isArray(cells) ? calendarIso(cells[0]) : null;
    const amount = Array.isArray(cells) ? num(cells[1]) : null;
    if (!date || amount === null || amount <= 0) continue;
    const epoch = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 1000;
    if (epoch < firstFreshEpoch) kept.push({ epoch, amount });
  }
  kept.sort((a, b) => a.epoch - b.epoch);
  return { ...chart, days: days.concat(chart.days), dividends: kept.concat(chart.dividends.filter((dividend) => dividend.epoch >= firstFreshEpoch)) };
}
// </windowed-chart>

// <fund-selection> shared block of .claude/tools/etfs/etf-std/fund-selection.block.ts, applied by apply-block.ts: never edit it in one repo
/** An index row as far as these helpers read it: the ticker and whether it has published data (`dataFile`, null for a catalog-only row). */
export type FundSelectionRow = { ticker?: unknown; dataFile?: unknown };

function fundSelectionTicker(row: FundSelectionRow): string {
  return String(row.ticker === null || row.ticker === undefined ? '' : row.ticker).trim().toUpperCase();
}

/**
 * The tickers a TICKERS entry may name: the live catalog plus every fund with published data (closed funds included). When
 * the live catalog could not be read (`live` null) every previous index row counts, since nothing tells a real catalog-only
 * row from a stale one. A catalog-only row from an earlier mistyped TICKERS run is therefore not "known" (open-items etfs Q27).
 */
export function knownTickers(live: ReadonlyArray<string> | null, previous: ReadonlyArray<FundSelectionRow>): string[] {
  const out: string[] = [];
  const add = (ticker: string): void => { if (ticker && out.indexOf(ticker) < 0) out.push(ticker); };
  if (live) for (let i = 0; i < live.length; i++) add(String(live[i]).trim().toUpperCase());
  for (let i = 0; i < previous.length; i++) if (!live || previous[i].dataFile) add(fundSelectionTicker(previous[i]));
  return out;
}

/** Throws before any fund request when TICKERS names a fund outside `known` (see knownTickers): a clear error, nothing fetched or written. */
export function assertKnownTickers(selected: ReadonlyArray<string> | null, known: ReadonlyArray<string>, where: string): void {
  const unknown = (selected || []).map((ticker) => String(ticker).trim().toUpperCase()).filter((ticker) => ticker && known.indexOf(ticker) < 0);
  if (unknown.length) throw new Error(`TICKERS: ${unknown.join(', ')} not in ${where}; nothing was fetched or written`);
}

/**
 * The index rows without stale catalog-only rows: a row with no published data whose ticker the live catalog no longer lists
 * (an earlier mistyped TICKERS entry, a fund withdrawn before launch). Rows with data always stay; nothing is dropped when the
 * live catalog could not be read (`live` null).
 */
export function withoutStalePlaceholders<T extends FundSelectionRow>(rows: ReadonlyArray<T>, live: ReadonlyArray<string> | null): T[] {
  if (!live) return rows.slice();
  const listed = live.map((ticker) => String(ticker).trim().toUpperCase());
  return rows.filter((row) => Boolean(row.dataFile) || listed.indexOf(fundSelectionTicker(row)) >= 0);
}

/**
 * New funds of a run (open-items etfs Q28): `published` - first published in this run (the previous index had no row for it,
 * or only a catalog-only one), so a fund whose first read failed is announced when it finally succeeds; `pending` - new in the
 * catalog this run but not published yet. Nothing is reported on a first run (empty previous index).
 */
export function newFundsReport(previous: ReadonlyArray<FundSelectionRow>, next: ReadonlyArray<FundSelectionRow>): { published: string[]; pending: string[] } {
  const report = { published: [] as string[], pending: [] as string[] };
  if (!previous.length) return report;
  const before = new Map<string, boolean>();
  for (let i = 0; i < previous.length; i++) before.set(fundSelectionTicker(previous[i]), Boolean(previous[i].dataFile));
  for (let i = 0; i < next.length; i++) {
    const ticker = fundSelectionTicker(next[i]);
    if (!ticker || before.get(ticker)) continue;
    if (next[i].dataFile) report.published.push(ticker);
    else if (!before.has(ticker)) report.pending.push(ticker);
  }
  report.published.sort();
  report.pending.sort();
  return report;
}

/** The log and step-summary lines of a newFundsReport: `NEW FUNDS: A, B` and `NEW FUNDS (not published yet): C`; none when empty. */
export function newFundsLines(report: { published: ReadonlyArray<string>; pending: ReadonlyArray<string> }): string[] {
  const lines: string[] = [];
  if (report.published.length) lines.push(`NEW FUNDS: ${report.published.join(', ')}`);
  if (report.pending.length) lines.push(`NEW FUNDS (not published yet): ${report.pending.join(', ')}`);
  return lines;
}
// </fund-selection>

// <range-52w> shared block of .claude/tools/etfs/etf-std/range-52w.block.ts, applied by apply-block.ts: never edit it in one repo
export type Range52w = {
  week52Low: number | null; week52High: number | null; range52w: number | null; range52wClose: number | null; range52wAsOf: string | null;
  range52wSince: string | null; range52wBasis: string | null;
};

/**
 * The price columns of a history sheet, tried in this order: the market close first, NAV only when no market price is
 * published. A function, not a const: the block sits at the end of update-data.ts, after the top-level `await main()`.
 */
export function range52wColumns(): string[] {
  return ['Close', 'Market Price', 'NAV', 'NAV per Share'];
}

/** The seven `metrics` keys of the 52-week range, all null: a catalog-only row and a fund without history carry this. */
export function range52wEmpty(): Range52w {
  return { week52Low: null, week52High: null, range52w: null, range52wClose: null, range52wAsOf: null, range52wSince: null, range52wBasis: null };
}

/**
 * The 52-week range from the closes of a fund's published history sheet (owner, 2026-10-29: closes, not intraday highs and
 * lows; no extra requests). `headers` are the sheet headers, `rows` objects keyed by header or arrays in header order.
 * - Price column: the first of range52wColumns() with at least two numeric values (`$1,234.50` reads as 1234.5); the date
 *   column is `Date`, else `As Of`, else the first header. Dates go through calendarIso, so every published format works
 * - Window: the last dated close and every close up to 52 weeks (364 days) before it. `week52Low` and `week52High` are the
 *   lowest and highest close of the window, `range52w` the position of the last close between them in percent
 *   (0 = at the low, 100 = at the high, 2 decimals). The last close is part of the window, so it never falls outside;
 *   `range52wClose` and `range52wAsOf` are that close and its date (it can differ from the row's closePrice source)
 * - A fund with less than 52 weeks of history gets the range since its first published close, and `range52wSince` names
 *   that date (owner: "alternative" - the range since launch with a note); a full window has `range52wSince: null`
 * - `range52wBasis` names the column used. Fewer than two closes give range52wEmpty(); a flat window (high = low) keeps
 *   low and high but `range52w: null`, never a made-up 0 or 50
 */
export function range52wMetrics(headers: string[], rows: unknown[]): Range52w {
  const list = Array.isArray(headers) ? headers.map((h) => String(h)) : [];
  const dateHeader = list.indexOf('Date') >= 0 ? 'Date' : list.indexOf('As Of') >= 0 ? 'As Of' : list[0];
  const cell = (row: unknown, header: string): unknown => {
    if (Array.isArray(row)) return row[list.indexOf(header)];
    return row && typeof row === 'object' ? (row as Record<string, unknown>)[header] : undefined;
  };
  const price = (value: unknown): number | null => {
    if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
    const text = String(value === null || value === undefined ? '' : value).replace(/[$,\s]/g, '');
    if (!/^\d+(\.\d+)?$/.test(text)) return null;
    const number = Number(text);
    return number > 0 ? number : null;
  };
  const all = Array.isArray(rows) ? rows : [], columns = range52wColumns();
  for (let c = 0; c < columns.length; c++) {
    const column = columns[c];
    if (list.indexOf(column) < 0 || !dateHeader) continue;
    const points: Array<{ date: string; close: number }> = [];
    for (let i = 0; i < all.length; i++) {
      const date = calendarIso(cell(all[i], dateHeader)), close = price(cell(all[i], column));
      if (date && close !== null) points.push({ date, close });
    }
    if (points.length < 2) continue;
    points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const last = points[points.length - 1];
    const end = Date.UTC(Number(last.date.slice(0, 4)), Number(last.date.slice(5, 7)) - 1, Number(last.date.slice(8, 10)));
    const start = new Date(end - 364 * 86400000).toISOString().slice(0, 10);
    const window = points.filter((p) => p.date >= start);
    if (window.length < 2) continue;
    let low = window[0].close, high = window[0].close;
    for (let i = 1; i < window.length; i++) { low = Math.min(low, window[i].close); high = Math.max(high, window[i].close); }
    const round = (value: number, digits: number): number => Number(value.toFixed(digits));
    return {
      week52Low: round(low, 4), week52High: round(high, 4),
      range52w: high > low ? round(((last.close - low) / (high - low)) * 100, 2) : null, range52wClose: round(last.close, 4), range52wAsOf: last.date,
      range52wSince: points[0].date > start ? points[0].date : null,
      range52wBasis: column,
    };
  }
  return range52wEmpty();
}
/**
 * The index rows with the five 52-week keys in every `metrics`, computed from each fund's published history pages
 * (`funds/<T>/history/*.json` under `feedRoot`, the folder of index.json). Call it on the final rows right before
 * index.json is written: updated, unchanged and kept funds all get the range of the history they publish, a row without
 * `dataFile` or without history pages gets range52wEmpty(). A row without a `metrics` object is left as it is. The seven
 * keys go in front of `returnsBasis` and `performanceAsOf`, so those two stay the last keys of `metrics`.
 */
export async function withRange52w<T>(feedRoot: URL | string, funds: T[]): Promise<T[]> {
  const fs = await import('node:fs/promises');
  const { pathToFileURL } = await import('node:url');
  const root = feedRoot instanceof URL ? new URL(feedRoot.href.replace(/\/?$/, '/')) : pathToFileURL(String(feedRoot).replace(/\/?$/, '/'));
  const out: T[] = [];
  for (const fund of Array.isArray(funds) ? funds : []) {
    const row = fund as unknown as Record<string, unknown>;
    if (!row || typeof row !== 'object' || !row.metrics || typeof row.metrics !== 'object') { out.push(fund); continue; }
    let range = range52wEmpty();
    const dataFile = typeof row.dataFile === 'string' ? row.dataFile : '';
    if (dataFile) {
      const dir = new URL(`${dataFile.replace(/^\.\//, '').replace(/[^/]*$/, '')}history/`, root);
      const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((name) => /\.json$/.test(name)).sort();
      let headers: string[] = [];
      const rows: unknown[] = [];
      for (const name of names) {
        const page = await fs.readFile(new URL(name, dir), 'utf8').then((text) => JSON.parse(text)).catch(() => null);
        if (!page || !Array.isArray(page.rows)) continue;
        if (!headers.length && Array.isArray(page.headers)) headers = page.headers;
        for (const item of page.rows) rows.push(item);
      }
      range = range52wMetrics(headers, rows);
    }
    // the range keys go in front of returnsBasis and performanceAsOf, which stay the last two keys (metrics contract)
    const metrics: Record<string, unknown> = {}, old = row.metrics as Record<string, unknown>, tail = ['returnsBasis', 'performanceAsOf'];
    for (const key of Object.keys(old)) if (tail.indexOf(key) < 0 && !(key in range)) metrics[key] = old[key];
    Object.assign(metrics, range);
    for (const key of tail) if (key in old) metrics[key] = old[key];
    out.push({ ...row, metrics } as unknown as T);
  }
  return out;
}
// </range-52w>

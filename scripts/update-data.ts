#!/usr/bin/env bun
import { printConfig, printFilter, createReporter } from './update-output.ts';
/// <reference types="bun" />
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";

const ROOT = new URL("../api/vanguard/", import.meta.url);
const FUNDS = new URL("funds/", ROOT);
const UA = "daggerok/Vanguard ETF research contact=github.com/daggerok";

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
const HOLDINGS_HEADERS_BASE = [
  "Ticker",
  "Name",
  "Weight (%)",
  "Market Value",
  "Shares",
  "Asset Class",
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

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}
function envInt(name: string, fallback: number): number {
  const value = Number.parseInt(env(name), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
function selectedFunds() {
  const wanted = env("TICKERS").split(/[\s,;]+/).filter(Boolean).map((x) => x.toUpperCase());
  return wanted.length ? FUNDS_SEED.filter(([ticker]) => wanted.includes(ticker)) : FUNDS_SEED;
}
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  const response = await fetch(url, { headers: { "User-Agent": UA, ...headers } });
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
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" } });
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
    const res = await fetch(url, {
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
    console.warn(`[workplace] ${portId} ${e}`);
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
    const response = await fetch(advisorUrl, {
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
    console.warn(`[official-advisor] ${ticker} ${e}`);
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

  return { url: advisorUrl, netAssets, etfAssets, expense, dividend, sec, ytd, oneYear, portId, distributionFrequency, workplaceRaw: workplace ? true : false };
}

export type ChartDividend = { epoch: number; amount: number };

async function chart(ticker: string): Promise<{ rows: any[]; dividends: ChartDividend[] }> {
  const url = `${YAHOO_CHART_URL}/${ticker}?range=max&interval=1d&events=div%2Csplits`;
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
        adjClose: adj[i] ?? q.close?.[i] ?? null,
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
    return { rows, dividends };
  } catch (error) {
    console.warn(`[history] ${ticker} ${error}`);
    return { rows: [], dividends: [] };
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

function internalHistoryRows(pageRows: any[]): any[] {
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

function returnSince(rows: any[], years: number): number | null {
  if (!rows.length) return null;
  const latest = rows[rows.length - 1];
  const cutoff = new Date(`${latest.date}T00:00:00Z`);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
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
    if (annual !== null) {
      performance[`${years}Y`] = annual;
      totalReturn[`${years}Y`] = ((1 + annual / 100) ** years - 1) * 100;
    }
  }
  return { nav: latest.close, asOfDate: latest.date, totalReturn, performance };
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
    items.map((item: any) => ({
      Ticker: item?.ticker ?? item?.holdingTicker ?? item?.symbol ?? "—",
      Name:
        item?.holdingName ??
        item?.securityLongDescription ??
        item?.securityShortDescription ??
        item?.name ??
        item?.ticker ??
        "—",
      "Weight (%)": item?.marketValuePercentage ?? item?.weight ?? item?.percentOfAssets ?? "—",
      "Market Value":
        item?.marketValueBaseCurrency ??
        item?.marketValue ??
        item?.value ??
        "—",
      Shares:
        item?.shareQuantity ??
        item?.shares ??
        item?.numberOfShares ??
        item?.quantity ??
        "—",
      "Asset Class": label,
      Sector: item?.sector ?? item?.gicsSector ?? "—",
      Exchange: item?.exchange ?? "—",
      Location: item?.location ?? item?.country ?? "—",
      CUSIP: item?.cusip ?? item?.securityId ?? "—",
      ISIN: item?.isin ?? "—",
      Currency: item?.currency ?? "—",
    })),
  );
  if (!rows.length) return null;
  const asOf = toIsoDate(rawAsOf);
  return { rows, asOf: asOf || (typeof rawAsOf === "string" ? rawAsOf : null) };
}

export type VanguardAdditionalFundData = {
  holdings: VanguardHoldings | null;
  officialHistory: OfficialPricePoint[];
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
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
        Referer: `https://investor.vanguard.com/investment-products/etfs/profile/${ticker.toLowerCase()}`,
      },
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const data = await response.json();
    return { holdings: parseVanguardHoldingDetails(data), officialHistory: parseVanguardOfficialHistory(data) };
  } catch (error) {
    console.warn(`[holdings-vg] ${ticker} ${error}`);
    return { holdings: null, officialHistory: [] };
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
  return { "User-Agent": UA, Accept: "application/json, application/xml, text/xml, text/plain" };
}

async function fetchSecText(url: string, label: string): Promise<string> {
  const maxRetries = Math.min(5, envInt("MAX_RETRIES", 2));
  let attempt = 0;
  for (;;) {
    const response = await fetch(url, { headers: secHeaders() });
    if (response.ok) return response.text();
    if ([408, 425, 429, 500, 502, 503, 504].includes(response.status) && attempt < maxRetries) {
      attempt += 1;
      await sleep(Math.min(30000, 2 ** attempt * 1000));
      continue;
    }
    throw new Error(`${response.status} ${response.statusText} for ${label}`);
  }
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
    holdings.push({
      Ticker: "-",
      Name: name,
      "Weight (%)": weight === null ? "—" : String(weight),
      "Market Value": value === null ? "—" : String(value),
      Shares: tagValue(body, "balance") || "-",
      "Asset Class": tagValue(body, "assetCat") || "-",
      Sector: "—",
      Exchange: "—",
      Location: "—",
      CUSIP: cusip && !/^n\/?a$/i.test(cusip) ? cusip : identifier,
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
    console.log(`[edgar   ] SEC fund ticker table: ${fundTickerMap.size} share classes`);
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
    console.log(`[edgar   ] SEC company ticker table: ${companyTickerMap.size} issuer names`);
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
    return { headers, rows };
  } catch {
    return { headers: [], rows: [] };
  }
}

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
    await writeFile(new URL(name, target), JSON.stringify(payload) + "\n");
  }
  try {
    for (const name of await readdir(target)) {
      if (name.endsWith(".json") && !kept.has(name)) await rm(new URL(name, target), { force: true });
    }
  } catch {}
  return { pages: [...kept].sort().map((name) => `${kind}/${name}`), pageSize, totalRows: rows.length };
}

export async function run() {
  await mkdir(FUNDS, { recursive: true });
  const holdingsPageSize = envInt("HOLDINGS_PAGE_SIZE", 250);
  const historyPageSize = envInt("HISTORY_PAGE_SIZE", 1000);
  const requestSleepMs = Math.max(0, Number(env("REQUEST_SLEEP")) || 0) * 1000;
  printConfig('Vanguard', { tickers: env("TICKERS"), holdingsPageSize, historyPageSize, requestSleep: requestSleepMs / 1000, maxRetries: Math.min(5, envInt("MAX_RETRIES", 2)) });
  const selected = selectedFunds();
  printFilter(selected.length, FUNDS_SEED.length);
  const output = createReporter(ROOT, selected.length);
  const catalog: any[] = [];
  for (const [ticker, name, category] of selected) {
    const before = await output.before(ticker);
    try {
    const dir = new URL(`${ticker}/`, FUNDS);
    await mkdir(dir, { recursive: true });
    const [chartData, official, vgAdditional] = await Promise.all([
      chart(ticker),
      officialProfile(ticker, name),
      vanguardAdditionalFundData(ticker),
    ]);
    const vgHoldings = vgAdditional.holdings;

    // --- Holdings: Vanguard official feed -> SEC N-PORT-P -> previous sheet ---
    let holdingsHeaders: string[] = HOLDINGS_HEADERS_BASE;
    let holdingsRows: Record<string, unknown>[] = vgHoldings?.rows ?? [];
    let holdingsAsOf: string | null = vgHoldings?.asOf ?? null;
    let holdingsSource = holdingsRows.length
      ? "Vanguard investor profile holdings (IRR AdditionalFundData)"
      : "not available from current public sources";
    if (!holdingsRows.length) {
      try {
        const filing = await resolveNportFiling(ticker);
        if (filing) {
          const parsed = parseNport(await fetchSecText(filing.accession.url, `[nport] ${ticker}`));
          const seriesMatches = !parsed.seriesId || parsed.seriesId.toUpperCase() === filing.ref.seriesId.toUpperCase();
          if (seriesMatches && parsed.holdings.length) {
            const names = await loadCompanyTickerTable();
            holdingsRows = fillNportTickers(parsed.holdings, names);
            if (holdingsRows.some((row) => "Coupon" in row || "Maturity" in row)) {
              holdingsHeaders = [...HOLDINGS_HEADERS_BASE, "Coupon", "Maturity"];
            }
            holdingsAsOf = parsed.repPdDate || null;
            holdingsSource = `SEC EDGAR Form N-PORT-P (accession ${filing.accession.accession}, report period ${parsed.repPdDate || "n/a"})`;
          }
        }
      } catch (error) {
        console.warn(`[nport   ] ${ticker} ${error}`);
      }
    }
    if (!holdingsRows.length) {
      const prev = await readPreviousSheet(ticker, "holdings");
      if (prev.rows.length) {
        const prevMeta = await readPreviousMeta(ticker);
        holdingsRows = prev.rows;
        holdingsHeaders = prev.headers.length ? prev.headers : holdingsHeaders;
        holdingsAsOf = prevMeta?.holdings?.asOfDate ?? null;
        holdingsSource = prevMeta?.holdings?.source ?? "previous run";
      }
    }

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
    const prevMeta = await readPreviousMeta(ticker);
    if (!dividends.length && prevMeta) {
      dividends = dividendsFromPrevious(prevMeta);
    }
    const metrics = summary(historyRows);

    const mergedHistoryRows = historyPageRows(historyRows, officialHistory);
    const historyAsOfDate = mergedHistoryRows.length
      ? String(mergedHistoryRows[mergedHistoryRows.length - 1].Date)
      : (metrics.asOfDate ?? null);
    const historyManifest = await writePages(dir, ticker, "history", HISTORY_HEADERS, mergedHistoryRows, historyPageSize);
    const holdingsManifest = await writePages(dir, ticker, "holdings", holdingsHeaders, holdingsRows, holdingsPageSize);

    const expense = official.expense?.value ? Number(official.expense.value) : null;
    const officialYtd = official.ytd?.value ? Number(official.ytd.value) : null;
    const frequency = official.distributionFrequency ?? prevMeta?.distributionFrequency ?? null;
    const divRows = distributionRows(frequency, dividends);
    const meta = {
      ticker,
      name,
      category,
      type: "Vanguard ETF",
      fundPage: `https://investor.vanguard.com/investment-products/etfs/profile/${ticker.toLowerCase()}`,
      officialPage: official.url,
      portId: (official as any).portId ?? prevMeta?.portId ?? null,
      source:
        "Vanguard workplace fundDetails API + Vanguard IRR holdings/NAV/premium-discount history + Yahoo OHLCV history fallback/dividends",
      nav: metrics.nav,
      netAssets: official.etfAssets?.value ?? prevMeta?.netAssets ?? null,
      totalFundNetAssets: official.netAssets?.value ?? prevMeta?.totalFundNetAssets ?? null,
      netAssetsAsOf: official.etfAssets?.asOf ?? prevMeta?.netAssetsAsOf ?? null,
      netExpenseRatio: expense ?? prevMeta?.netExpenseRatio ?? null,
      trailingYield: official.dividend?.value ? Number(official.dividend.value) : (prevMeta?.trailingYield ?? null),
      dividendYieldAsOf: official.dividend?.asOf ?? prevMeta?.dividendYieldAsOf ?? null,
      secYield: official.sec?.value ? Number(official.sec.value) : (prevMeta?.secYield ?? null),
      secYieldAsOf: official.sec?.asOf ?? prevMeta?.secYieldAsOf ?? null,
      distributionFrequency: frequency,
      distributions: {
        frequency,
        paymentsPerYear: paymentsPerYear(frequency),
        headers: DISTRIBUTION_HEADERS,
        rows: divRows,
      },
      ytdReturn: officialYtd ?? metrics.totalReturn["1Y"] ?? null,
      asOfDate: official.ytd?.asOf ?? metrics.asOfDate,
      totalReturn: metrics.totalReturn,
      performance: metrics.performance,
      officialMetrics: {
        nav: officialYtd === null ? null : officialYtd,
        marketPrice: null,
        expenseRatio: expense,
        returns: { YTD: officialYtd, "1Y": official.oneYear?.value ? Number(official.oneYear.value) : null },
      },
      holdings: { ...holdingsManifest, asOfDate: holdingsAsOf, source: holdingsSource },
      history: {
        ...historyManifest,
        asOfDate: historyAsOfDate,
        source:
          "Vanguard IRR AdditionalFundData historicalPrice + premiumDiscountDetails (official NAV/market price/premium-discount, primary) " +
          "+ Yahoo Finance public chart API (OHLC/adjusted close/volume, and any date range the official windows don't cover; per-row provenance in the `Source` column)",
      },
    };
    await writeFile(new URL("meta.json", dir), JSON.stringify(meta, null, 2) + "\n");
    // The catalog carries a lightweight distributions summary; full rows live in meta.json.
    catalog.push({
      ...meta,
      distributions: divRows.length
        ? { frequency, exDate: divRows[0][1], dividend: divRows[0][4] }
        : { frequency, exDate: null, dividend: null },
      holdings: holdingsRows.length,
      history: mergedHistoryRows.length,
    });
    await output.result(ticker, before, undefined, undefined, {
      officialHistoryCount: officialHistory.length,
      yahooHistoryCount: historyRows.length,
      workplaceRaw: (official as any).workplaceRaw,
    });
    if (requestSleepMs > 0) await sleep(requestSleepMs);
    } catch (error) {
      await output.result(ticker, before, 'failed', String(error));
      throw error; // Preserve the updater's existing fail-fast behavior.
    }
  }
  await writeFile(new URL("index.json", ROOT), JSON.stringify({ generatedAt: new Date().toISOString(), provider: "Vanguard", funds: catalog }, null, 2) + "\n");
}
if (import.meta.main) await run();

#!/usr/bin/env bun
import { mkdir, writeFile } from "node:fs/promises";

const ROOT = new URL("../api/vanguard/", import.meta.url);
const FUNDS = new URL("funds/", ROOT);
const PAGE_SIZE = 1000;
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
  const value = percent ? window.match(/([+-]?[\d.]+)%/)?.[1] ?? null : window.match(/\$([\d,.]+\s*[BM])/i)?.[1] ?? null;
  return value ? { value, asOf } : null;
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
        "User-Agent": "daggerok/Vanguard ETF research contact=github.com/daggerok",
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
      headers: { "User-Agent": "daggerok/Vanguard ETF research contact=github.com/daggerok", Accept: "text/html" },
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

  return { url: advisorUrl, netAssets, etfAssets, expense, dividend, sec, ytd, oneYear, portId, workplaceRaw: workplace ? true : false };
}

async function history(ticker: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=max&interval=1d&events=div%2Csplits`;
  try {
    const data = await fetchJson(url);
    const result = data.chart?.result?.[0];
    const timestamps = result?.timestamp ?? [];
    const q = result?.indicators?.quote?.[0] ?? {};
    const adj = result?.indicators?.adjclose?.[0]?.adjclose ?? [];
    return timestamps
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
  } catch (error) {
    console.warn(`[history] ${ticker} ${error}`);
    return [];
  }
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

async function writePages(dir: URL, kind: string, rows: any[]) {
  const target = new URL(`${kind}/`, dir);
  await mkdir(target, { recursive: true });
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
    const dir = new URL(`${ticker}/`, FUNDS);
    await mkdir(dir, { recursive: true });
    const [rows, official] = await Promise.all([history(ticker), officialProfile(ticker, name)]);
    const metrics = summary(rows);
    const historyPaths = await writePages(dir, "history", rows);
    const holdingsPaths = await writePages(dir, "holdings", []);
    const expense = official.expense?.value ? Number(official.expense.value) : null;
    const officialYtd = official.ytd?.value ? Number(official.ytd.value) : null;
    const meta = {
      ticker,
      name,
      category,
      type: "Vanguard ETF",
      fundPage: `https://investor.vanguard.com/investment-products/etfs/profile/${ticker.toLowerCase()}`,
      officialPage: official.url,
      portId: (official as any).portId ?? null,
      source: "Vanguard workplace fundDetails API + Yahoo daily history",
      nav: metrics.nav,
      netAssets: official.etfAssets?.value ?? null,
      totalFundNetAssets: official.netAssets?.value ?? null,
      netAssetsAsOf: official.etfAssets?.asOf ?? null,
      netExpenseRatio: expense,
      trailingYield: official.dividend?.value ? Number(official.dividend.value) : null,
      dividendYieldAsOf: official.dividend?.asOf ?? null,
      secYield: official.sec?.value ? Number(official.sec.value) : null,
      secYieldAsOf: official.sec?.asOf ?? null,
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
      holdings: { totalRows: 0, pageSize: PAGE_SIZE, pages: holdingsPaths },
      history: { totalRows: rows.length, pageSize: PAGE_SIZE, pages: historyPaths },
    };
    await writeFile(new URL("meta.json", dir), JSON.stringify(meta, null, 2) + "\n");
    catalog.push({ ...meta, holdings: 0, history: rows.length });
    console.log(`[ fund ] ticker=${ticker.padEnd(5)} port=${(official as any).portId ?? "null"} history=${rows.length} netAssets=${meta.netAssets ?? "null"} total=${meta.totalFundNetAssets ?? "null"} div=${meta.trailingYield ?? "null"} sec=${meta.secYield ?? "null"} wp=${(official as any).workplaceRaw}`);
  }
  await writeFile(new URL("index.json", ROOT), JSON.stringify({ generatedAt: new Date().toISOString(), provider: "Vanguard", funds: catalog }, null, 2) + "\n");
}
if (import.meta.main) await run();

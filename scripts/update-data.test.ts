/// <reference types="bun" />
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  HOLDINGS_HEADERS_BASE,
  assembleFund,
  buildIndex,
  buildMetrics,
  filterMetricsOf,
  formatDisplayDate,
  holdingIdentifier,
  isoFromDisplayDate,
  latestQuote,
  previousValues,
  run,
  standardHoldingHeaders,
  standardHoldingRow,
  CONTROL_NAMES,
  DEFAULT_SEC_UA,
  USAGE,
  installSystemCa,
  isCertError,
  hasDeferredFilters,
  historyWindowStartDate,
  historyWindowStartEpoch,
  parseAmount,
  parseAumRange,
  parseRange,
  passesMetricFilters,
  passesStaticFilters,
  readConfig,
  resolveControls,
  runtimeControls,
  selectBatch,
  summary,
  yahooChartUrl,
  ytdFromRows,

  DISTRIBUTION_HEADERS,
  distributionRows,
  historyPageRows,
  nportUrlFor,
  parseEdgarAtomFilings,
  parseFundTickerMap,
  parseNport,
  parseVanguardHoldingDetails,
  parseVanguardOfficialHistory,
  paymentsPerYear,
  toIsoDate,
  configureLanes,
  httpFetch,
  isinFromCusip,
  paceRequest,
  REQUEST_TIMEOUT_MS,
} from "./update-data";

const seed = ["BND", "VOO", "VTI", "VT"];

test("Vanguard seed contains core ETFs", () => {
  expect(seed).toContain("VOO");
  expect(seed).toContain("VTI");
  expect(seed).toContain("VT");
});

test("ticker filters are normalized", () => {
  const input = " voo, VTI;vt ".split(/[\s,;]+/).filter(Boolean).map((x) => x.toUpperCase());
  expect(input).toEqual(["VOO", "VTI", "VT"]);
});

test("history rows use ISO dates", () => {
  const row = { date: new Date(0).toISOString().slice(0, 10), close: 1 };
  expect(row.date).toBe("1970-01-01");
});

test("history page rows are keyed by the exact header strings", () => {
  const [row] = historyPageRows([
    { date: "2026-09-16", open: 180.1, high: 181.2, low: 179.6, close: 180.74, adjClose: 179.9, volume: 372240 },
  ]);
  expect(Object.keys(row).sort()).toEqual([
    "Adj Close",
    "Close",
    "Date",
    "High",
    "Low",
    "Market Price",
    "NAV",
    "Open",
    "Premium/Discount (%)",
    "Source",
    "Volume",
  ]);
  expect(row["Date"]).toBe("2026-09-16");
  expect(row["Adj Close"]).toBe(179.9);
  // No official data was supplied for this date: OHLCV comes from Yahoo,
  // NAV/market-price/premium-discount stay null, and the row is stamped
  // as a Yahoo fallback.
  expect(row["NAV"]).toBeNull();
  expect(row["Market Price"]).toBeNull();
  expect(row["Premium/Discount (%)"]).toBeNull();
  expect(row["Source"]).toBe("yahoo-fallback");
});

test("Vanguard historicalPrice + premiumDiscountDetails parse into one official point per date", () => {
  const points = parseVanguardOfficialHistory({
    historicalPrice: {
      ticker: "VOO",
      "3m": { nav: [{ asOfDate: "07/01/2026", price: "$685.25" }] },
      "10Y": { nav: [{ asOfDate: "09/30/2016", price: "$198.69" }] },
    },
    premiumDiscountDetails: [
      {
        periodQualifier: "CURR",
        prdLabel: "CURR",
        asOfDt: "09/24/2026",
        pdDetails: [
          {
            nav: "$685.25",
            marketPrice: "$685.46",
            premiumDiscountPercentage: "0.03%",
            premiumDiscountAmount: "$0.21",
            effectiveDate: "07/01/2026",
          },
        ],
      },
    ],
  });
  // The 07/01/2026 date is covered by both blocks; premiumDiscountDetails
  // wins and additionally supplies the market price and premium/discount %
  // that historicalPrice doesn't carry at all.
  expect(points).toHaveLength(2);
  expect(points[0]).toEqual({ date: "2016-09-30", nav: 198.69, marketPrice: null, premiumDiscountPct: null });
  expect(points[1]).toEqual({ date: "2026-07-01", nav: 685.25, marketPrice: 685.46, premiumDiscountPct: 0.03 });
});

test("Vanguard historicalPrice + premiumDiscountDetails handle a fund with no data for either block", () => {
  expect(parseVanguardOfficialHistory({ historicalPrice: {}, premiumDiscountDetails: [] })).toEqual([]);
  expect(parseVanguardOfficialHistory(null)).toEqual([]);
  expect(parseVanguardOfficialHistory({ holdingDetails: {} })).toEqual([]);
});

test("history rows merge official NAV/market-price/premium-discount with Yahoo OHLCV by date", () => {
  const yahooRows = [
    { date: "2026-07-01", open: 683.0, high: 686.0, low: 682.5, close: 685.28, adjClose: 685.28, volume: 3500000 },
    { date: "2016-09-01", open: 197.0, high: 199.0, low: 196.5, close: 198.4, adjClose: 150.2, volume: 900000 },
  ];
  const officialHistory = [
    { date: "2026-07-01", nav: 685.25, marketPrice: 685.46, premiumDiscountPct: 0.03 },
    { date: "2026-07-02", nav: 685.28, marketPrice: 684.84, premiumDiscountPct: -0.06 },
  ];
  const rows = historyPageRows(yahooRows, officialHistory);
  const byDate = Object.fromEntries(rows.map((row: any) => [row.Date, row]));

  // 2026-07-01: both sources cover this date — OHLCV from Yahoo, NAV/market
  // price/premium-discount from the official feed, tagged official.
  expect(byDate["2026-07-01"]).toEqual({
    Date: "2026-07-01",
    Open: 683.0,
    High: 686.0,
    Low: 682.5,
    Close: 685.28,
    "Adj Close": 685.28,
    Volume: 3500000,
    NAV: 685.25,
    "Market Price": 685.46,
    "Premium/Discount (%)": 0.03,
    Source: "vanguard-official",
  });

  // 2026-07-02: official-only date (Yahoo has no bar here) — OHLCV stays
  // null, only the official fields are populated, still tagged official.
  expect(byDate["2026-07-02"]).toEqual({
    Date: "2026-07-02",
    Open: null,
    High: null,
    Low: null,
    Close: null,
    "Adj Close": null,
    Volume: null,
    NAV: 685.28,
    "Market Price": 684.84,
    "Premium/Discount (%)": -0.06,
    Source: "vanguard-official",
  });

  // 2016-09-01: outside every official window — Yahoo is the sole source,
  // and the row is tagged as a fallback.
  expect(byDate["2016-09-01"]).toEqual({
    Date: "2016-09-01",
    Open: 197.0,
    High: 199.0,
    Low: 196.5,
    Close: 198.4,
    "Adj Close": 150.2,
    Volume: 900000,
    NAV: null,
    "Market Price": null,
    "Premium/Discount (%)": null,
    Source: "yahoo-fallback",
  });

  // Rows come back sorted ascending by date.
  expect(rows.map((row: any) => row.Date)).toEqual(["2016-09-01", "2026-07-01", "2026-07-02"]);
});

test("distribution rows are latest-first with ISO ex-dates", () => {
  expect(DISTRIBUTION_HEADERS).toEqual([
    "Frequency",
    "Ex-Date",
    "Record Date",
    "Payable Date",
    "Dividend",
    "ST Cap Gains",
    "LT Cap Gains",
  ]);
  const rows = distributionRows("Quarterly", [
    { epoch: 1774359000, amount: 0.969 },
    { epoch: 1782307800, amount: 1.032 },
  ]);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toEqual(["Quarterly", "2026-06-24", "—", "—", "1.032", "—", "—"]);
  expect(rows[1][1]).toBe("2026-03-24");
});

test("distribution frequency maps to payments per year", () => {
  expect(paymentsPerYear("Monthly")).toBe(12);
  expect(paymentsPerYear("Quarterly")).toBe(4);
  expect(paymentsPerYear("Semi-annually")).toBe(2);
  expect(paymentsPerYear("Annually")).toBe(1);
  expect(paymentsPerYear("Irregular")).toBeNull();
  expect(paymentsPerYear(null)).toBeNull();
});

test("Vanguard IRR holdingDetails map to the holdings sheet shape", () => {
  const parsed = parseVanguardHoldingDetails({
    holdingDetails: {
      asOfDate: "08/31/2026",
      equityHoldings: [
        { ticker: "XOM", holdingName: "Exxon Mobil Corp", marketValuePercentage: 22.5, sector: "Energy" },
      ],
    },
  });
  expect(parsed).not.toBeNull();
  expect(parsed?.asOf).toBe("2026-08-31");
  expect(parsed?.rows).toHaveLength(1);
  expect(parsed?.rows[0]["Ticker"]).toBe("XOM");
  expect(parsed?.rows[0]["Weight"]).toBe(22.5);
  expect(parsed?.rows[0]["Asset Category"]).toBe("Equity");
  expect(Object.keys(parsed!.rows[0]).slice(0, 7)).toEqual(HOLDINGS_HEADERS_BASE.slice(0, 7));
  expect(parseVanguardHoldingDetails({ historicalPrice: {} })).toBeNull();
  expect(parseVanguardHoldingDetails(null)).toBeNull();
});

test("SEC fund ticker map resolves tickers to series refs", () => {
  const map = parseFundTickerMap({
    fields: ["symbol", "cik", "seriesId", "classId"],
    data: [["VDE", "36405", "S000002853", "C000007861"]],
  });
  expect(map.get("VDE")).toEqual({ cik: "0000036405", seriesId: "S000002853", classId: "C000007861" });
});

test("N-PORT accession URL points at the raw submission text", () => {
  expect(nportUrlFor("0000036405", "0001234567-26-000001")).toBe(
    "https://www.sec.gov/Archives/edgar/data/36405/000123456726000001/0001234567-26-000001.txt",
  );
});

test("EDGAR atom feed yields NPORT-P accessions only", () => {
  const accessions = parseEdgarAtomFilings(
    `<feed><entry><filing-type>NPORT-P</filing-type><accession-number>0001234567-26-000001</accession-number>` +
      `<filing-date>2026-09-15</filing-date><filing-href>https://www.sec.gov/Archives/edgar/data/36405/000123456726000001/</filing-href></entry>` +
      `<entry><filing-type>497</filing-type><accession-number>0000000000-00-000000</accession-number></entry></feed>`,
  );
  expect(accessions).toHaveLength(1);
  expect(accessions[0].accession).toBe("0001234567-26-000001");
});

test("N-PORT XML maps to the holdings sheet shape", () => {
  const parsed = parseNport(
    `<edgarSubmission><formData><genInfo><regName>VANGUARD INDEX FUNDS</regName><regCik>0000036405</regCik>` +
      `<seriesName>Vanguard Energy ETF</seriesName><seriesId>S000002853</seriesId><repPdDate>2026-07-31</repPdDate>` +
      `</genInfo><fundInfo><netAssets>10900000000</netAssets></fundInfo>` +
      `<invstOrSec><name>Exxon Mobil Corp</name><cusip>30231G102</cusip><balance>1234567</balance>` +
      `<valUSD>150000000</valUSD><pctVal>13.76</pctVal><assetCat>EC</assetCat><curCd>USD</curCd></invstOrSec>` +
      `<invstOrSec><name>US TREASURY N/B</name><cusip>91282CKP5</cusip><balance>5000000</balance>` +
      `<valUSD>4900000</valUSD><pctVal>0.44</pctVal><assetCat>DBT</assetCat>` +
      `<debtSec><annualizedRt>4.125</annualizedRt><maturityDt>2030-01-31</maturityDt></debtSec></invstOrSec>` +
      `</formData></edgarSubmission>`,
  );
  expect(parsed.seriesId).toBe("S000002853");
  expect(parsed.repPdDate).toBe("2026-07-31");
  expect(parsed.holdings).toHaveLength(2);
  expect(parsed.holdings[0]["Name"]).toBe("Exxon Mobil Corp");
  expect(parsed.holdings[0]["Weight"]).toBe("13.76");
  expect(parsed.holdings[0]["CUSIP"]).toBe("30231G102");
  expect(parsed.holdings[0]["Identifier"]).toBe("30231G102");
  expect(parsed.holdings[1]["Coupon"]).toBe("4.125");
  expect(parsed.holdings[1]["Maturity"]).toBe("2030-01-31");
});

test("toIsoDate normalizes SEC and Vanguard date formats", () => {
  expect(toIsoDate("2026-07-31")).toBe("2026-07-31");
  expect(toIsoDate("08/31/2026")).toBe("2026-08-31");
  expect(toIsoDate("")).toBe("");
});


const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const file = () => JSON.parse(read("scripts/update-data.config.json"));

test("configuration precedence: file < advanced < nonblank input < environment", () => {
  const c = resolveControls({ CONCURRENCY: 2, TICKERS: "VTI" }, { CONCURRENCY: 3, TICKERS: "VOO" }, { CONCURRENCY: "4", TICKERS: "" }, { CONCURRENCY: "5" });
  expect(c.CONCURRENCY).toBe("5");
  expect(c.TICKERS).toBe("VOO");
  expect(resolveControls({ TICKERS: "VTI" }, { TICKERS: "" }, { TICKERS: "" }).TICKERS).toBe("");
  expect(resolveControls({ CONCURRENCY: 2 }, {}, { CONCURRENCY: "" }).CONCURRENCY).toBe("2");
  expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }, { CONCURRENCY: "4" }).CONCURRENCY).toBe("4");
  expect(resolveControls({ VERBOSE: true }, {}, {}, { VERBOSE: "false" }).VERBOSE).toBe("false");
  // an explicitly set empty environment variable clears the control
  expect(resolveControls({ TICKERS: "VTI" }, {}, {}, { TICKERS: "" }).TICKERS).toBe("");
  expect(resolveControls({ AUM: "1B:" }, {}, { AUM: "" }).AUM).toBe("1B:");
});

test("scheduled path (empty inputs and advanced) equals config defaults", () => {
  const f = file();
  expect(resolveControls(f, {}, {}, {})).toEqual(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, String(v)])));
});

test("provider-specific defaults", () => {
  const f = file();
  expect(f.MAX_FETCHES).toBe("0");
  expect(f.REQUEST_SLEEP).toBe("0");
  expect(f.CONCURRENCY).toBe("4");
  expect(f.HOLDINGS_PAGE_SIZE).toBe("250");
  expect(f.HISTORY_PAGE_SIZE).toBe("1000");
  expect(f.MAX_RETRIES).toBe("2");
  expect(f.HISTORY_RANGE).toBe("max");
  expect(f.EDGAR_FALLBACK).toBe("true");
  expect(f.SKIP_YAHOO).toBe("false");
  expect(f.SEC_UA).toBe("daggerok ETF feed daggerok@gmail.com");
  expect(DEFAULT_SEC_UA).toBe(f.SEC_UA);
  for (const name of CONTROL_NAMES.filter((n) => /^(AUM|TER|DIVIDEND_YIELD|SEC_YIELD|PERFORMANCE_|TOTAL_RETURN_)/.test(n))) expect(f[name]).toBe(":");
  expect(read("scripts/update-data.ts")).not.toMatch(/example\.com|admin@daggerok/);
});

test("resolver rejects unknown, invalid, non-scalar and newline values", () => {
  const bad = [
    { UNKNOWN: 1 }, { SEC_UA: "x\nEVIL=yes" }, { CONCURRENCY: 0 }, { MAX_RETRIES: 0 }, { MAX_RETRIES: -1 }, { MAX_FETCHES: -1 },
    { HOLDINGS_PAGE_SIZE: 1.5 }, { REQUEST_SLEEP: "-1" }, { VERBOSE: "maybe" }, { SKIP_YAHOO: "maybe" }, { EDGAR_FALLBACK: "2" }, { USE_SYSTEM_CA: "maybe" },
    { HISTORY_RANGE: "5" }, { HISTORY_RANGE: "0y" }, { AUM: "5" }, { AUM: "10:1" }, { AUM: "huge:" }, { TER: "a:b" }, { TER: "1:2:3" },
    { PERFORMANCE_1Y: "x:" }, { TOTAL_RETURN_10Y: "5:1" }, { TICKERS: ["VTI"] }, { TICKERS: { a: 1 } }, null, [],
  ];
  for (const value of bad) expect(() => resolveControls(value)).toThrow();
  expect(() => resolveControls({}, { SEC_UA: "x\rfoo" })).toThrow();
  expect(() => resolveControls({}, {}, {}, { SEC_UA: "x\0bad" })).toThrow();
  expect(() => resolveControls({}, {}, {}, { MAX_RETRIES: "0" })).toThrow();
  expect(() => resolveControls({}, "x")).toThrow();
  expect(() => JSON.parse("{bad")).toThrow();
});

test("runtimeControls reads the config file and honors env overrides", async () => {
  expect((await runtimeControls({})).CONCURRENCY).toBe(file().CONCURRENCY);
  expect((await runtimeControls({ CONCURRENCY: "7" })).CONCURRENCY).toBe("7");
  await expect(runtimeControls({ MAX_RETRIES: "0" })).rejects.toThrow();
});

test("readConfig parses every control strictly", () => {
  const c = readConfig(resolveControls(file(), { MAX_FETCHES: 3, AUM: "mid", TER: ":0.2", MAX_RETRIES: 4, TICKERS: "voo, vti;bnd", CATEGORY: "bond", HISTORY_RANGE: "5Y", SKIP_YAHOO: "yes", EDGAR_FALLBACK: "off", TOTAL_RETURN_3Y: "10:" }));
  expect(c.maxFetches).toBe(3);
  expect(c.aumRange).toMatchObject({ min: 2e9, max: 1e10 });
  expect(c.terRange).toMatchObject({ min: Number.NEGATIVE_INFINITY, max: 0.2 });
  expect(c.maxRetries).toBe(4);
  expect(() => readConfig(resolveControls(file(), { MAX_RETRIES: 9 }))).toThrow("MAX_RETRIES");
  expect(() => readConfig(resolveControls(file(), { MAX_RETRIES: 0 }))).toThrow("MAX_RETRIES");
  expect(c.tickers).toEqual(["VOO", "VTI", "BND"]);
  expect(c.category).toBe("bond");
  expect(c.historyRange).toBe("5y");
  expect(c.skipYahoo).toBe(true);
  expect(c.edgarFallback).toBe(false);
  expect(c.totalReturnRanges["3Y"]).toMatchObject({ min: 10 });
  expect(hasDeferredFilters(c)).toBe(true);
  expect(hasDeferredFilters(readConfig(file()))).toBe(false);
  expect(readConfig({}).maxRetries).toBe(2);
});

test("AUM accepts amounts with K/M/B/T suffixes and size presets", () => {
  expect(parseAumRange("1B:")).toMatchObject({ min: 1e9, max: Number.POSITIVE_INFINITY });
  expect(parseAumRange("$500M:2.5B")).toMatchObject({ min: 5e8, max: 2.5e9 });
  expect(parseAumRange("nano")).toMatchObject({ min: 0, max: 1e7 });
  expect(parseAumRange("small:mid")).toMatchObject({ min: 3e8, max: 1e10 });
  expect(parseAumRange("large")).toMatchObject({ min: 1e10 });
  expect(parseAumRange(":")).toBeUndefined();
  expect(parseRange("-1:5.5")).toMatchObject({ min: -1, max: 5.5 });
});

test("Vanguard dollar strings parse to numbers", () => {
  expect(parseAmount("$1.0T")).toBe(1e12);
  expect(parseAmount("$123.4 B")).toBe(123.4e9);
  expect(parseAmount("$850M")).toBe(8.5e8);
  expect(parseAmount("1,234")).toBe(1234);
  expect(parseAmount(null)).toBeNull();
  expect(parseAmount("n/a")).toBeNull();
});

test("metric filters: AUM/TER/yield need a value, returns pass when unavailable", () => {
  const metrics = (over: any = {}) => ({ aum: 1e11, ter: 0.03, dividendYield: 1.5, secYield: 1.2, performance: { YTD: 10, "1Y": 20, "3Y": 12 }, totalReturn: { "3Y": 40 }, ...over });
  const cfg = (c: Record<string, string>) => readConfig(resolveControls(file(), c));
  expect(passesMetricFilters(metrics(), cfg({}))).toBe(true);
  expect(passesMetricFilters(metrics(), cfg({ AUM: "large" }))).toBe(true);
  expect(passesMetricFilters(metrics({ aum: 5e8 }), cfg({ AUM: "large" }))).toBe(false);
  expect(passesMetricFilters(metrics({ aum: null }), cfg({ AUM: "1M:" }))).toBe(false);
  expect(passesMetricFilters(metrics(), cfg({ TER: ":0.05" }))).toBe(true);
  expect(passesMetricFilters(metrics({ ter: 0.2 }), cfg({ TER: ":0.05" }))).toBe(false);
  expect(passesMetricFilters(metrics(), cfg({ DIVIDEND_YIELD: "2:" }))).toBe(false);
  expect(passesMetricFilters(metrics(), cfg({ SEC_YIELD: "1:2" }))).toBe(true);
  expect(passesMetricFilters(metrics(), cfg({ PERFORMANCE_1Y: "25:" }))).toBe(false);
  expect(passesMetricFilters(metrics(), cfg({ PERFORMANCE_5Y: "5:" }))).toBe(true);
  expect(passesMetricFilters(metrics(), cfg({ TOTAL_RETURN_3Y: "50:" }))).toBe(false);
  expect(passesMetricFilters(metrics(), cfg({ TOTAL_RETURN_3Y: "30:50", PERFORMANCE_YTD: "5:15" }))).toBe(true);
});

test("static filters: TICKERS and CATEGORY", () => {
  const voo = ["VOO", "Vanguard S&P 500 ETF", "US Equity"] as const;
  const bnd = ["BND", "Vanguard Total Bond Market ETF", "Bond"] as const;
  const cfg = (c: Record<string, string>) => readConfig(resolveControls(file(), c));
  expect(passesStaticFilters(voo, cfg({}))).toBe(true);
  expect(passesStaticFilters(voo, cfg({ TICKERS: "bnd" }))).toBe(false);
  expect(passesStaticFilters(bnd, cfg({ TICKERS: "bnd" }))).toBe(true);
  expect(passesStaticFilters(bnd, cfg({ CATEGORY: "BOND" }))).toBe(true);
  expect(passesStaticFilters(voo, cfg({ CATEGORY: "bond" }))).toBe(false);
});

test("MAX_FETCHES batches resume at the saved cursor and wrap", () => {
  const funds = [["A"], ["B"], ["C"], ["D"], ["E"]] as const;
  const tickers = ["A", "B", "C", "D", "E"];
  expect(selectBatch(funds, 0, null).selected).toHaveLength(5);
  expect(selectBatch(funds, 2, null)).toMatchObject({ startCursor: 0, nextCursor: 2 });
  const second = selectBatch(funds, 2, { cursor: 2, tickers });
  expect(second.selected.map((f) => f[0])).toEqual(["C", "D"]);
  expect(second.nextCursor).toBe(4);
  const last = selectBatch(funds, 2, { cursor: 4, tickers });
  expect(last.selected.map((f) => f[0])).toEqual(["E"]);
  expect(last.nextCursor).toBe(0);
  // a different ticker scope restarts at the beginning
  expect(selectBatch(funds, 2, { cursor: 2, tickers: ["A", "B"] }).startCursor).toBe(0);
  expect(selectBatch([], 2, null)).toMatchObject({ selected: [], nextCursor: 0 });
});

test("HISTORY_RANGE bounds the Yahoo request and the published rows", () => {
  const now = 1_790_000_000;
  // Yahoo answers range=max with monthly bars: max must be an explicit period1=0 window of daily bars
  const maxUrl = new URL(yahooChartUrl("VOO", "max", now));
  expect(maxUrl.searchParams.get("range")).toBeNull();
  expect(maxUrl.searchParams.get("interval")).toBe("1d");
  expect(maxUrl.searchParams.get("period1")).toBe("0");
  expect(maxUrl.searchParams.get("period2")).toBe(String(now));
  const url = new URL(yahooChartUrl("VOO", "5y", now));
  expect(url.searchParams.get("range")).toBeNull();
  expect(url.searchParams.get("period2")).toBe(String(now));
  expect(Number(url.searchParams.get("period1"))).toBe(Math.floor(now - 5 * 365.25 * 86400));
  expect(url.searchParams.get("includeAdjustedClose")).toBe("true");
  expect(historyWindowStartEpoch("max", now)).toBe(0);
  expect(historyWindowStartDate("max", now)).toBe("");
  expect(historyWindowStartDate("1y", now)).toBe(new Date((now - 365.25 * 86400) * 1000).toISOString().slice(0, 10));
});

test("bounded history yields unavailable long-period returns instead of wrong ones", () => {
  const rows = [
    { date: "2024-01-02", adjClose: 100 },
    { date: "2025-01-02", adjClose: 110 },
    { date: "2026-01-02", adjClose: 121 },
    { date: "2026-06-01", adjClose: 133.1 },
  ];
  expect(summary(rows, true).performance["1Y"]).toBeCloseTo(((133.1 / 110) ** 1 - 1) * 100, 6);
  expect(summary(rows, true).performance["5Y"]).toBeUndefined();
  expect(summary(rows, true).performance["10Y"]).toBeUndefined();
  expect(summary(rows, false).performance["5Y"]).toBeDefined();
});

test("YTD return is measured from the last close of the prior year", () => {
  const rows = [
    { date: "2025-12-30", adjClose: 100 },
    { date: "2025-12-31", adjClose: 200 },
    { date: "2026-03-02", adjClose: 210 },
    { date: "2026-06-01", adjClose: 250 },
  ];
  expect(ytdFromRows(rows)).toBeCloseTo(25, 6);
  expect(ytdFromRows([{ date: "2026-01-05", adjClose: 10 }])).toBeNull();
  expect(ytdFromRows([])).toBeNull();
});

test("config keys, CONTROL_NAMES, --help and README controls stay in sync", () => {
  expect(Object.keys(file()).sort()).toEqual([...CONTROL_NAMES].sort());
  const doc = read("README.md");
  const readmeRows = [...doc.slice(doc.indexOf("### Update controls"), doc.indexOf("### Examples")).matchAll(/^\| `([A-Z0-9_]+)` \|/gm)].map((m) => m[1]);
  expect(readmeRows.sort()).toEqual([...CONTROL_NAMES].sort());
  // --help groups the return controls as PERFORMANCE_YTD|1Y|3Y|5Y|10Y
  for (const name of CONTROL_NAMES) {
    const [, prefix, period] = /^(PERFORMANCE|TOTAL_RETURN)_(.+)$/.exec(name) ?? [];
    if (prefix) expect(USAGE).toMatch(new RegExp(`  ${prefix}_YTD\\|1Y\\|3Y\\|5Y\\|10Y .*`)), expect(["YTD", "1Y", "3Y", "5Y", "10Y"]).toContain(period);
    else expect(USAGE).toContain(`  ${name} `);
  }
  expect(doc).toContain("scripts/update-data.config.json");
});

test("README structure and verification section", () => {
  const doc = `\n${read("README.md")}`;
  const order = ["# Vanguard", "## Using Bun", "## Updating the static Vanguard data", "### Data sources", "### Metrics and caveats", "### Update controls", "### Examples", "## TypeScript and verification", "## Brands table", "## Sibling applications", "## License"];
  let at = -1;
  for (const heading of order) {
    const next = doc.indexOf(`\n${heading}\n`, at < 0 ? -1 : at);
    expect(next).toBeGreaterThan(at);
    at = next;
  }
  for (const command of ["bun install --frozen-lockfile", "bun test", "bun build --target=bun scripts/update-data.ts --outfile=/dev/null", "git diff --check"]) expect(doc).toContain(command);
  expect(doc).not.toMatch(/worklog|\.prompt|evidence|fixtures|config-docs/i);
});

test("workflow: one resolver, fixed output dir, inputs map to controls", () => {
  const actual = read(".github/workflows/update-data.yml");
  const names = [...actual.slice(actual.indexOf("    inputs:"), actual.indexOf("\npermissions:")).matchAll(/^      (\w+):$/gm)].map((m) => m[1]);
  expect(names.length).toBeLessThanOrEqual(25);
  expect(names).toContain("advanced");
  expect(actual).toContain("default: '{}'");
  for (const name of names.filter((n) => n !== "advanced")) expect(CONTROL_NAMES).toContain(name.toUpperCase() as any);
  expect(actual).toContain("cron: '0 0 * * 0'");
  expect(actual).toContain("toJSON(inputs)");
  expect(actual).toContain("resolveControls(file, advanced, individual, protectedVars)");
  expect(actual).toContain("PROTECTED_SEC_UA: ${{ vars.SEC_UA }}");
  expect(actual).toContain("timeout-minutes: 30");
  expect(actual).toContain("persist-credentials: false");
  expect(actual).not.toMatch(/\$\{\{\s*inputs\./);
  expect(actual).not.toMatch(/OUTPUT_DIR|output_dir/i);
  expect(actual.match(/git add (\S+)/g)).toEqual(["git add api/vanguard"]);
  expect(actual.match(/api\/[\w-]+/g)!.every((p) => p === "api/vanguard")).toBe(true);
});

test("USE_SYSTEM_CA resolver: auto/true/false case-insensitive, default auto, rejects other values", () => {
  expect(file().USE_SYSTEM_CA).toBe("auto");
  expect(resolveControls(file()).USE_SYSTEM_CA).toBe("auto");
  for (const v of ["auto", "true", "false", "AUTO", "True", "FALSE"]) expect(resolveControls({}, {}, {}, { USE_SYSTEM_CA: v }).USE_SYSTEM_CA).toBe(v.toLowerCase());
  expect(() => resolveControls({ USE_SYSTEM_CA: "maybe" })).toThrow(/USE_SYSTEM_CA/);
});

test("isCertError detects untrusted-certificate errors, including nested causes", () => {
  expect(isCertError({ code: "UNABLE_TO_GET_ISSUER_CERT_LOCALLY" })).toBe(true);
  expect(isCertError(new Error("unable to get local issuer certificate"))).toBe(true);
  expect(isCertError(Object.assign(new Error("fetch failed"), { cause: new Error("unable to get local issuer certificate") }))).toBe(true);
  expect(isCertError({ code: "ECONNRESET" })).toBe(false);
  expect(isCertError(new Error("HTTP 403 Forbidden"))).toBe(false);
  expect(isCertError(null)).toBe(false);
});

test("installSystemCa modes: false and active leave fetch alone, true restarts now, auto restarts once on a cert error", async () => {
  const original = globalThis.fetch;
  const never = (): never => { throw new Error("unexpected reexec"); };
  try {
    installSystemCa("false", never, false);
    expect(globalThis.fetch).toBe(original);
    installSystemCa("auto", never, true);
    expect(globalThis.fetch).toBe(original);
    let calls = 0;
    expect(() => installSystemCa("true", () => { calls++; throw new Error("reexec"); }, false)).toThrow("reexec");
    expect(calls).toBe(1);
    expect(globalThis.fetch).toBe(original);

    let reexecs = 0;
    const reexec = (): never => { reexecs++; throw new Error("reexec"); };
    globalThis.fetch = (async (url: string) => {
      if (url === "cert") throw Object.assign(new Error("fetch failed"), { cause: { code: "UNABLE_TO_GET_ISSUER_CERT_LOCALLY" } });
      if (url === "reset") throw Object.assign(new Error("reset"), { code: "ECONNRESET" });
      return new Response("ok");
    }) as unknown as typeof fetch;
    const stub = globalThis.fetch;
    installSystemCa("auto", reexec, false);
    expect(globalThis.fetch).not.toBe(stub);
    expect(await (await fetch("fine")).text()).toBe("ok");
    await expect(fetch("reset")).rejects.toThrow("reset");
    expect(reexecs).toBe(0);
    await expect(fetch("cert")).rejects.toThrow("reexec");
    expect(reexecs).toBe(1);
  } finally {
    globalThis.fetch = original;
  }
});

// ---------------------------------------------------------------------------
// Standard feed shapes
// ---------------------------------------------------------------------------

const rowsFrom = (points: Array<[string, number]>) => points.map(([date, adjClose]) => ({ date, adjClose, close: adjClose }));
const YAHOO_ROWS = rowsFrom([["2024-12-31", 100], ["2025-06-01", 110], ["2025-12-31", 115], ["2026-06-01", 121]]);

function inputsFor(over: Record<string, unknown> = {}): any {
  const pageRows = [
    { Date: "2026-05-29", Close: 120, NAV: 100.1, "Market Price": null, "Premium/Discount (%)": null, Source: "vanguard-official" },
    { Date: "2026-06-01", Close: 121, NAV: 101, "Market Price": 101.1, "Premium/Discount (%)": 0.1, Source: "vanguard-official" },
  ];
  return {
    ticker: "VOO", name: "Vanguard S&P 500 ETF", category: "US Equity", officialPage: "https://advisors.vanguard.com/x", portId: "0968",
    frequency: "Quarterly", distributionRows: [["Quarterly", "2026-03-27", "—", "—", "1.8", "—", "—"]],
    netAssets: "$1.0T", netAssetsAsOf: "2026-05-31", totalFundNetAssets: "$1.8T", expense: 0.03,
    dividendYield: 1.05116, dividendYieldAsOf: "2026-05-31", secYield: null, secYieldAsOf: null,
    officialYtd: 12.7195, officialOneYear: 15.7029, officialAsOf: "2026-05-29",
    yahooRows: YAHOO_ROWS, pageRows,
    holdings: { pages: ["holdings/001.json"], pageSize: 250, totalRows: 2, asOfDate: "2026-05-31", source: "Vanguard" },
    history: { pages: ["history/001.json"], pageSize: 1000, totalRows: 2, asOfDate: "2026-06-01", source: "Vanguard + Yahoo" },
    ...over,
  };
}

test("display dates round-trip without a timezone shift", () => {
  expect(formatDisplayDate("2026-09-30")).toBe("Sep 30 2026");
  expect(formatDisplayDate(null)).toBe("—");
  expect(formatDisplayDate("n/a")).toBe("—");
  expect(isoFromDisplayDate("Sep 30 2026")).toBe("2026-09-30");
  expect(isoFromDisplayDate("—")).toBe("");
});

test("metrics: official YTD and 1Y win, 3Y/5Y/10Y are derived and null when the history is short, never 0", () => {
  const derived = summary(YAHOO_ROWS);
  const m = buildMetrics({ officialYtd: 12.7195, officialOneYear: 15.7029, officialAsOf: "2026-05-29", derived, derivedYtd: ytdFromRows(YAHOO_ROWS), dividendYield: 1.05116, secYield: 0.98 });
  expect(m).toMatchObject({ ytd: 12.72, tr1y: 15.7, cagr3y: null, cagr5y: null, cagr10y: null, tr3y: null, tr5y: null, tr10y: null, siAnn: null });
  expect(m.dividendYield).toBe(1.05);
  expect(m.secYieldText).toBe("0.98%");
  expect(m.performanceAsOf).toBe("2026-05-29");
  expect(m.returnsBasis).toBe("official Vanguard YTD and 1-year returns");
  // nothing official: everything derived from Yahoo adjusted closes, dated by the last close
  const d = buildMetrics({ officialYtd: null, officialOneYear: null, officialAsOf: null, derived, derivedYtd: ytdFromRows(YAHOO_ROWS), dividendYield: null, secYield: null });
  expect(d.ytd).toBeCloseTo((121 / 115 - 1) * 100, 1);
  expect(d.tr1y).toBeCloseTo(10, 6);
  expect(d.performanceAsOf).toBe("2026-06-01");
  expect(d.returnsBasis).toBe("YTD and 1-year returns derived from Yahoo Finance adjusted market-price closes (not NAV)");
  expect(d.dividendYield).toBeNull();
  expect(d.dividendYieldText).toBe("—");
  // a long history gives both cumulative (trNy) and annualized (cagrNy) values
  const long = rowsFrom([["2016-06-01", 100], ["2021-06-01", 200], ["2023-06-01", 300], ["2025-06-01", 400], ["2026-06-01", 500]]);
  const l = buildMetrics({ officialYtd: null, officialOneYear: null, officialAsOf: null, derived: summary(long), derivedYtd: null, dividendYield: null, secYield: null });
  expect(l.cagr10y).toBeCloseTo((5 ** (1 / 10) - 1) * 100, 1);
  expect(l.tr10y).toBeCloseTo(400, 1);
  expect(l.cagr3y).toBeCloseTo(((500 / 300) ** (1 / 3) - 1) * 100, 1);
  expect(l.tr3y).toBeCloseTo((500 / 300 - 1) * 100, 1);
  // no figure at all -> no date either
  const none = buildMetrics({ officialYtd: null, officialOneYear: null, officialAsOf: null, derived: summary([]), derivedYtd: null, dividendYield: null, secYield: null });
  expect(none.performanceAsOf).toBeNull();
  expect(none.returnsBasis).toBe("unavailable");
});

test("a young fund yields unavailable long-period returns, not the since-launch return repeated", () => {
  const young = rowsFrom([["2026-01-05", 100], ["2026-06-01", 103]]);
  const s = summary(young);
  expect(s.performance).toEqual({});
  expect(s.totalReturn).toEqual({});
});

test("latest quote: official NAV, the market price and premium of Vanguard's price day, Yahoo close as the price fallback", () => {
  const q = latestQuote(inputsFor().pageRows);
  expect(q).toEqual({ nav: { value: 101, date: "2026-06-01" }, price: { value: 101.1, date: "2026-06-01" }, premiumDiscount: 0.1 });
  const yahooOnly = latestQuote([{ Date: "2026-06-01", Close: 50, NAV: null, "Market Price": null, "Premium/Discount (%)": null }]);
  expect(yahooOnly).toEqual({ nav: null, price: { value: 50, date: "2026-06-01" }, premiumDiscount: null });
  expect(latestQuote([])).toEqual({ nav: null, price: null, premiumDiscount: null });
});

test("catalog row and per-fund meta have the standard keys, shared by every ETF repo", () => {
  const { meta, row } = assembleFund(inputsFor());
  expect(Object.keys(row)).toEqual([
    "ticker", "name", "category", "fundPage", "dataFile", "cusip", "isin", "ter", "terValue", "nav", "navValue", "aum", "aumValue",
    "asOfDate", "inceptionDate", "exchange", "closePrice", "closePriceValue", "premiumDiscount", "premiumDiscountValue",
    "distributions", "returns", "metrics", "holdings", "history",
  ]);
  expect(Object.keys(row.metrics)).toEqual([
    "ytd", "tr1y", "tr3y", "tr5y", "tr10y", "cagr3y", "cagr5y", "cagr10y", "siAnn", "dividendYield", "dividendYieldText",
    "secYield", "secYieldText", "returnsBasis", "performanceAsOf",
  ]);
  expect(Object.keys(meta)).toEqual([
    "ticker", "name", "category", "categoryPath", "source", "providerIds", "legalStructure", "identifiers", "inception", "expenseRatio",
    "nav", "marketPrice", "premiumDiscount", "aum", "yields", "returns", "distributions", "holdings", "history",
  ]);
  expect(row).toMatchObject({
    dataFile: "./funds/VOO/meta.json", ter: "0.03%", terValue: 0.03, nav: "$101.00", navValue: 101, aum: "$1.0T", aumValue: 1e12,
    asOfDate: "Jun 01 2026", closePrice: "$101.10", premiumDiscount: "0.10%", holdings: 2, history: 2,
    distributions: { frequency: "Quarterly", exDate: "03/27/2026", dividend: "1.8" },
  });
  expect(row.returns.monthEnd).toMatchObject({ asOfDate: "May 29 2026", ytd: 12.72, yr1: 15.7, yr3: null, sinceInception: null });
  expect(row.returns.quarterEnd.ytd).toBeNull();
  expect(meta.yields).toMatchObject({ dividendYield: 1.05, secYield: null, secYieldText: "—", secYieldKind: "not published" });
  // the fund's meta is read back by the next run: the stored values must survive the round trip
  expect(previousValues(meta)).toMatchObject({ portId: "0968", frequency: "Quarterly", netAssets: "$1.0T", netAssetsAsOf: "2026-05-31", expense: 0.03, dividendYield: 1.05, secYield: null });
});

test("the metric filters read the standard metrics: PERFORMANCE_* annualized, TOTAL_RETURN_* cumulative", () => {
  const long = rowsFrom([["2016-06-01", 100], ["2021-06-01", 200], ["2023-06-01", 300], ["2025-06-01", 400], ["2026-06-01", 500]]);
  const { row } = assembleFund(inputsFor({ yahooRows: long, officialYtd: null, officialOneYear: null, officialAsOf: null }));
  const fm = filterMetricsOf(row);
  expect(fm.performance["10Y"]).toBe(row.metrics.cagr10y);
  expect(fm.totalReturn["10Y"]).toBe(row.metrics.tr10y);
  expect(fm.aum).toBe(1e12);
  expect(fm.ter).toBe(0.03);
  const cfg = (c: Record<string, string>) => readConfig(resolveControls(file(), c));
  expect(passesMetricFilters(fm, cfg({ PERFORMANCE_10Y: "15:20" }))).toBe(true);
  expect(passesMetricFilters(fm, cfg({ PERFORMANCE_10Y: "20:" }))).toBe(false);
  expect(passesMetricFilters(fm, cfg({ TOTAL_RETURN_10Y: "300:500" }))).toBe(true);
  expect(passesMetricFilters(fm, cfg({ TOTAL_RETURN_10Y: ":100" }))).toBe(false);
  expect(passesMetricFilters(fm, cfg({ AUM: "large", TER: ":0.05", DIVIDEND_YIELD: "1:2" }))).toBe(true);
});

test("holdings rows use the standard headers; legacy rows convert losslessly", () => {
  expect(HOLDINGS_HEADERS_BASE.slice(0, 7)).toEqual(["Name", "Ticker", "Identifier", "Weight", "Market Value", "Shares Held", "Asset Category"]);
  expect(holdingIdentifier("—", "US0378331005")).toBe("US0378331005");
  expect(holdingIdentifier("037833100", "US0378331005")).toBe("037833100");
  expect(holdingIdentifier("-", null)).toBe("—");
  const legacy = { Ticker: "AAPL", Name: "Apple Inc", "Weight (%)": "7.03%", "Market Value": "$1", Shares: "2", "Asset Class": "Equity", Sector: "—", Exchange: "—", Location: "—", CUSIP: "037833100", ISIN: "US0378331005", Currency: "—" };
  const standard = standardHoldingRow(legacy);
  expect(Object.keys(standard)).toEqual(HOLDINGS_HEADERS_BASE);
  expect(standard).toMatchObject({ Name: "Apple Inc", Ticker: "AAPL", Identifier: "037833100", Weight: "7.03%", "Shares Held": "2", "Asset Category": "Equity" });
  expect(standardHoldingRow(standard)).toBe(standard);
  const bond = standardHoldingRow({ ...legacy, Coupon: "4.1", Maturity: "2030-01-31" });
  expect(standardHoldingHeaders([bond])).toEqual([...HOLDINGS_HEADERS_BASE, "Coupon", "Maturity"]);
});

test("index envelope carries generatedAt, source and counts", () => {
  const index = buildIndex([{ holdings: 3, history: 4 }, { holdings: 2, history: 1 }], "2026-01-01T00:00:00.000Z");
  expect(Object.keys(index)).toEqual(["generatedAt", "source", "counts", "funds"]);
  expect(index.counts).toEqual({ funds: 2, holdings: 5, history: 5 });
  expect(index.source.provider).toBe("Vanguard");
});

function mockFeed(delayMs = 0, opts: { failYahoo?: boolean } = {}) {
  const inflight = new Set<string>();
  let peak = 0;
  const epoch = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000;
  const fetchMock = (async (input: any) => {
    const url = String(input?.url ?? input);
    const ticker = /\/(?:chart\/|profile\/)([A-Z]+)(?:-|\?)/.exec(url)?.[1] ?? "";
    if (ticker) { inflight.add(ticker); peak = Math.max(peak, inflight.size); }
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      if (url.includes("advisors.vanguard.com")) return new Response('<html>"portId": "0970"</html>');
      if (url.includes("fundDetails")) {
        return Response.json({ marketData: { body: { fundIdentifiers: { cusip: "922908769" }, exchange: "New York Stock Exchange Arca", fundCharacteristics: { fundInceptionDate: "2001-05-24" } } } });
      }
      if (url.includes("finance.yahoo.com")) {
        if (opts.failYahoo) return new Response("down", { status: 404 });
        const days = ["2024-12-31", "2025-06-01", "2025-12-31", "2026-06-01"];
        const adj = [100, 110, 115, 121];
        return Response.json({ chart: { result: [{ timestamp: days.map(epoch), indicators: { quote: [{ open: adj, high: adj, low: adj, close: adj, volume: adj }], adjclose: [{ adjclose: adj }] }, events: { dividends: { [epoch("2026-03-27")]: { amount: 1.8, date: epoch("2026-03-27") } } } }] } });
      }
      if (url.includes("AdditionalFundData")) {
        return Response.json({
          holdingDetails: { asOfDate: "05/31/2026", equityHoldings: [{ ticker: "AAA", holdingName: "A Corp", marketValuePercentage: "5.00%", cusip: "123456789" }] },
          historicalPrice: { "3m": { nav: [{ asOfDate: "05/29/2026", price: "$100.10" }] } },
          premiumDiscountDetails: [{ pdDetails: [{ nav: 101, marketPrice: 101.1, premiumDiscountPercentage: 0.1, effectiveDate: "06/01/2026" }] }],
        });
      }
      return new Response("not found", { status: 404 });
    } finally {
      if (ticker) inflight.delete(ticker);
    }
  }) as typeof fetch;
  return { fetchMock, peak: () => peak };
}

async function runOffline(controls: Record<string, string>, delayMs = 0, existingDir?: string, opts: { failYahoo?: boolean } = {}, softDeadlineMs?: number) {
  const dir = existingDir ?? mkdtempSync(join(tmpdir(), "vanguard-feed-"));
  const realFetch = globalThis.fetch;
  const feed = mockFeed(delayMs, opts);
  globalThis.fetch = feed.fetchMock;
  const logged = console.log;
  console.log = () => {};
  try {
    await run(readConfig(resolveControls(file(), { REQUEST_SLEEP: "0", MAX_RETRIES: "1", ...controls })), pathToFileURL(`${dir}/`), softDeadlineMs);
    return { dir, peak: feed.peak() };
  } finally {
    console.log = logged;
    globalThis.fetch = realFetch;
  }
}

test("update pipeline on a mocked fetch writes the standard index, meta and holdings pages", async () => {
  const { dir } = await runOffline({ TICKERS: "VOO VTI" });
  try {
    const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
    expect(Object.keys(index)).toEqual(["generatedAt", "source", "counts", "funds"]);
    expect(index.counts).toEqual({ funds: 2, holdings: 2, history: 2 * 5 });
    const voo = index.funds.find((fund: any) => fund.ticker === "VOO");
    expect(voo.metrics.tr1y).toBeCloseTo(10, 6);
    expect(voo.metrics.cagr3y).toBeNull();
    expect(voo.metrics.performanceAsOf).toBe("2026-06-01");
    expect(voo.navValue).toBe(101);
    expect(voo.distributions).toEqual({ frequency: null, exDate: "03/27/2026", dividend: "1.8" });
    const meta = JSON.parse(readFileSync(join(dir, "funds/VOO/meta.json"), "utf8"));
    expect(Object.keys(meta)).toEqual(Object.keys(assembleFund(inputsFor()).meta));
    const holdings = JSON.parse(readFileSync(join(dir, "funds/VOO/holdings/001.json"), "utf8"));
    expect(holdings.headers).toEqual(HOLDINGS_HEADERS_BASE);
    expect(holdings.rows[0]).toMatchObject({ Name: "A Corp", Ticker: "AAA", Identifier: "123456789", Weight: "5.00%" });
    expect(voo.cusip).toBe("922908769");
    expect(voo.isin).toBe("US9229087690");
    expect(voo.exchange).toBe("New York Stock Exchange Arca");
    expect(voo.inceptionDate).toBe("May 24 2001");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a metric filter keeps a failing fund out of the feed", async () => {
  const { dir } = await runOffline({ TICKERS: "VOO", AUM: "10M:20M" });
  try {
    expect(JSON.parse(readFileSync(join(dir, "index.json"), "utf8")).funds).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CONCURRENCY really runs funds in parallel: peak 1 fund in flight at 1, N at N", async () => {
  const one = await runOffline({ TICKERS: "VOO VTI BND VT", CONCURRENCY: "1" }, 5);
  const four = await runOffline({ TICKERS: "VOO VTI BND VT", CONCURRENCY: "4" }, 5);
  try {
    expect(one.peak).toBe(1);
    expect(four.peak).toBe(4);
  } finally {
    rmSync(one.dir, { recursive: true, force: true });
    rmSync(four.dir, { recursive: true, force: true });
  }
});

const textOf = (dir: string, path: string) => readFileSync(join(dir, path), "utf8");

test("a one-ticker run over an existing feed keeps every row and every fund's files", async () => {
  const { dir } = await runOffline({ TICKERS: "VOO VTI" });
  try {
    const before = JSON.parse(textOf(dir, "index.json"));
    const vtiMeta = textOf(dir, "funds/VTI/meta.json");
    await runOffline({ TICKERS: "VOO" }, 0, dir);
    const after = JSON.parse(textOf(dir, "index.json"));
    expect(before.funds.map((f: any) => f.ticker)).toEqual(["VOO", "VTI"]);
    expect(after.funds.map((f: any) => f.ticker)).toEqual(["VOO", "VTI"]);
    expect(after.funds.find((f: any) => f.ticker === "VTI")).toEqual(before.funds.find((f: any) => f.ticker === "VTI"));
    expect(textOf(dir, "funds/VTI/meta.json")).toBe(vtiMeta);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a rerun with identical upstream data rewrites nothing (index stamp included)", async () => {
  const { dir } = await runOffline({ TICKERS: "VOO VTI" });
  try {
    const files = ["index.json", "funds/VOO/meta.json", "funds/VTI/meta.json", "funds/VOO/history/001.json"];
    const first = files.map((f) => textOf(dir, f));
    await new Promise((resolve) => setTimeout(resolve, 15));
    await runOffline({ TICKERS: "VOO VTI" }, 0, dir);
    expect(files.map((f) => textOf(dir, f))).toEqual(first);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a failed required source keeps the whole fund as published, and a run where every fund failed exits with an error", async () => {
  const { dir } = await runOffline({ TICKERS: "VOO" });
  try {
    const metaBefore = textOf(dir, "funds/VOO/meta.json");
    const historyBefore = textOf(dir, "funds/VOO/history/001.json");
    const indexBefore = textOf(dir, "index.json");
    await expect(runOffline({ TICKERS: "VOO" }, 0, dir, { failYahoo: true })).rejects.toThrow("every selected fund failed");
    expect(textOf(dir, "funds/VOO/meta.json")).toBe(metaBefore);
    expect(textOf(dir, "funds/VOO/history/001.json")).toBe(historyBefore);
    expect(textOf(dir, "index.json")).toBe(indexBefore);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the soft deadline stops taking new funds but still writes the index", async () => {
  const { dir } = await runOffline({ TICKERS: "VOO VTI" }, 0, undefined, {}, -1);
  try {
    expect(JSON.parse(textOf(dir, "index.json")).funds).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("lanes: the slot is reserved synchronously, so concurrent callers never share a start time", async () => {
  configureLanes(2, 1);
  const waits: number[] = [];
  const clock = () => 1_000;
  const pause = async (ms: number) => { waits.push(ms); };
  await Promise.all([paceRequest(clock, pause), paceRequest(clock, pause), paceRequest(clock, pause), paceRequest(clock, pause), paceRequest(clock, pause)]);
  // two lanes, 1 s apart per lane: starts at +0, +0, +1000, +1000, +2000
  expect(waits.sort((a, b) => a - b)).toEqual([1000, 1000, 2000]);
  configureLanes(1, 0);
});

test("httpFetch applies a timeout signal and retries network errors and transient statuses up to MAX_RETRIES", async () => {
  const realFetch = globalThis.fetch;
  const calls: any[] = [];
  globalThis.fetch = (async (_url: any, init: any) => {
    calls.push(init);
    if (calls.length === 1) throw new Error("socket hang up");
    if (calls.length === 2) return new Response("busy", { status: 503 });
    return new Response("ok");
  }) as typeof fetch;
  try {
    const response = await httpFetch("https://example.test/x", {}, 3);
    expect(await response.text()).toBe("ok");
    expect(calls.length).toBe(3);
    expect(calls.every((init) => init.signal instanceof AbortSignal)).toBe(true);
    expect(REQUEST_TIMEOUT_MS).toBe(45_000);
    calls.length = 0;
    globalThis.fetch = (async () => { calls.push(1); return new Response("nope", { status: 404 }); }) as typeof fetch;
    expect((await httpFetch("https://example.test/y", {}, 3)).status).toBe(404);
    expect(calls.length).toBe(1);
  } finally {
    globalThis.fetch = realFetch;
  }
}, 20_000);

test("ISIN is derived from a CUSIP with the Luhn check digit and is null for anything else", () => {
  expect(isinFromCusip("922908769")).toBe("US9229087690");
  expect(isinFromCusip("037833100")).toBe("US0378331005");
  expect(isinFromCusip("bad")).toBeNull();
  expect(isinFromCusip(null)).toBeNull();
});

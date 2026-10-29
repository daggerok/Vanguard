/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  CLOSED_FUNDS, CONTROL_NAMES, DEFAULT_SEC_UA, DISTRIBUTION_HEADERS, HOLDINGS_GUARD_RELAX, HOLDINGS_HEADERS_BASE, REQUEST_TIMEOUT_MS, USAGE,
  assembleFund, buildIndex, catalogOnlyRow, closedFund, buildMetrics, configureLanes, distributionRows, filterMetricsOf, formatDisplayDate, hasDeferredFilters,
  historyPageRows, historyWindowStartEpoch, holdingIdentifier, holdingsWeightCount, httpFetch, installSystemCa, isCertError,
  isoFromDisplayDate, isinFromCusip, latestQuote, nportHoldingRows, nportIsFresh, nportTickers, paceRequest, parseAmount, parseAumRange,
  parseNportFiling, parseRange, parseSecCompanyNames, parseSecFundTickers, parseVanguardHoldingDetails, parseVanguardOfficialHistory, passesMetricFilters,
  passesStaticFilters, withYieldBasis, paymentsPerYear, previousValues, readConfig, resolveControls, run, runtimeControls, selectBatch,
  standardHoldingHeaders, standardHoldingRow, summary, toIsoDate, yahooChartUrl, ytdFromRows, holdingsGuard, withRange52w,
} from "./update-data";

// ---------------------------------------------------------------------------
// Shared setup: clean environment, pinned TZ, restored fetch / exit code / console / clock
// ---------------------------------------------------------------------------
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
// Control override tables share one declared type so the literals do not widen into a union with optional undefined keys.
const cases = (list: Record<string, string>[]): Record<string, string>[] => list;
const file = (): Record<string, string> => JSON.parse(read("scripts/update-data.config.json"));
const realFetch = globalThis.fetch;
// A mock that ignores its arguments is a valid fetch; the compiler cannot see that through the extra static members of typeof fetch.
const asFetch = (mock: () => Promise<Response>): typeof fetch => mock as unknown as typeof fetch;
const realExitCode = process.exitCode;
const realConsole = { log: console.log, warn: console.warn, error: console.error };
const realSetTimeout = globalThis.setTimeout;
const realAbortTimeout = AbortSignal.timeout;
const savedEnv = { ...process.env };
const tempDirs: string[] = [];
const isControlVar = (key: string): boolean =>
  (CONTROL_NAMES as readonly string[]).includes(key) || key.startsWith("VANGUARD_") || ["HISTORICAL_PAGE_SIZE", "NODE_USE_SYSTEM_CA", "ETF_UPDATER_SYSTEM_CA", "GITHUB_STEP_SUMMARY"].includes(key);

beforeEach(() => {
  for (const key of Object.keys(process.env)) if (isControlVar(key)) delete process.env[key];
  process.env.TZ = "UTC";
});
afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.setTimeout = realSetTimeout;
  AbortSignal.timeout = realAbortTimeout;
  process.exitCode = realExitCode ?? 0;
  Object.assign(console, realConsole);
  configureLanes(1, 0);
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const rowsFrom = (points: Array<[string, number]>) => points.map(([date, adjClose]) => ({ date, adjClose, close: adjClose }));
const YAHOO_ROWS = rowsFrom([["2024-12-31", 100], ["2025-06-01", 110], ["2025-12-31", 115], ["2026-06-01", 121]]);
const LONG_ROWS = rowsFrom([["2016-06-01", 100], ["2021-06-01", 200], ["2023-06-01", 300], ["2025-06-01", 400], ["2026-06-01", 500]]);

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

// ===========================================================================
describe("controls", () => {
  test("precedence: file < advanced < nonblank input < env; blank input inherits, advanced and explicit-empty env clear", () => {
    const c = resolveControls({ CONCURRENCY: 2, TICKERS: "VTI" }, { CONCURRENCY: 3, TICKERS: "VOO" }, { CONCURRENCY: "4", TICKERS: "" }, { CONCURRENCY: "5" });
    expect([c.CONCURRENCY, c.TICKERS]).toEqual(["5", "VOO"]);
    expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }, { CONCURRENCY: "4" }).CONCURRENCY).toBe("4");
    expect(resolveControls({ CONCURRENCY: 2 }, {}, { CONCURRENCY: "" }).CONCURRENCY).toBe("2");
    expect(resolveControls({ TICKERS: "VTI" }, { TICKERS: "" }, { TICKERS: "" }).TICKERS).toBe("");
    expect(resolveControls({ TICKERS: "VTI" }, {}, {}, { TICKERS: "" }).TICKERS).toBe("");
    expect(resolveControls({ VERBOSE: true }, {}, {}, { VERBOSE: "false" }).VERBOSE).toBe("false");
    expect(resolveControls({ AUM: "1B:" }, {}, { AUM: "" }).AUM).toBe("1B:");
  });

  test("brand and legacy env aliases: VANGUARD_<NAME> for every control, plain name wins, explicit empty counts, validation is equal", () => {
    for (const name of CONTROL_NAMES) {
      const value = /^(AUM|TER|DIVIDEND_YIELD|SEC_YIELD|PERFORMANCE_|TOTAL_RETURN_)/.test(name) ? "1:2" : name === "VERBOSE" || name === "SKIP_YAHOO" || name === "EDGAR_FALLBACK" ? "true" : name === "USE_SYSTEM_CA" ? "false" : name === "HISTORY_RANGE" ? "5y" : name === "MAX_RETRIES" ? "3" : name === "TICKERS" || name === "CATEGORY" || name === "SEC_UA" ? "x" : "7";
      expect(resolveControls({}, {}, {}, { [`VANGUARD_${name}`]: value })[name]).toBe(value);
    }
    expect(resolveControls({ CONCURRENCY: 2 }, {}, {}, { VANGUARD_CONCURRENCY: "5", CONCURRENCY: "6" }).CONCURRENCY).toBe("6");
    expect(resolveControls({ CONCURRENCY: 2 }, {}, {}, { CONCURRENCY: "6", VANGUARD_CONCURRENCY: "5" }).CONCURRENCY).toBe("6");
    expect(resolveControls({ TICKERS: "VTI" }, {}, {}, { VANGUARD_TICKERS: "" }).TICKERS).toBe("");
    expect(resolveControls({ TICKERS: "VTI" }, {}, {}, { TICKERS: "", VANGUARD_TICKERS: "VOO" }).TICKERS).toBe("");
    expect(resolveControls({ HISTORY_PAGE_SIZE: 1000 }, {}, {}, { HISTORICAL_PAGE_SIZE: "50" }).HISTORY_PAGE_SIZE).toBe("50");
    expect(resolveControls({}, {}, {}, { HISTORICAL_PAGE_SIZE: "50", VANGUARD_HISTORY_PAGE_SIZE: "60" }).HISTORY_PAGE_SIZE).toBe("60");
    expect(resolveControls({}, {}, {}, { HISTORY_PAGE_SIZE: "70", HISTORICAL_PAGE_SIZE: "50" }).HISTORY_PAGE_SIZE).toBe("70");
    for (const env of [{ VANGUARD_MAX_RETRIES: "0" }, { VANGUARD_SEC_UA: "a\nb" }, { VANGUARD_AUM: "10:1" }, { HISTORICAL_PAGE_SIZE: "1.5" }, { VANGUARD_USE_SYSTEM_CA: "maybe" }]) expect(() => resolveControls({}, {}, {}, env)).toThrow();
    for (const text of ["VANGUARD_<NAME>", "HISTORICAL_PAGE_SIZE"]) expect(USAGE).toContain(text);
  });

  test("strict validation: bad ranges, HISTORY_RANGE, MAX_RETRIES < 1, unknown keys, non-scalars, CR/LF/NUL", () => {
    for (const value of [
      { UNKNOWN: 1 }, { SEC_UA: "x\nEVIL=yes" }, { SEC_UA: "x\rfoo" }, { SEC_UA: "x\0bad" }, { CONCURRENCY: 0 }, { MAX_RETRIES: 0 }, { MAX_RETRIES: -1 },
      { MAX_FETCHES: -1 }, { HOLDINGS_PAGE_SIZE: 1.5 }, { REQUEST_SLEEP: "-1" }, { VERBOSE: "maybe" }, { SKIP_YAHOO: "maybe" }, { EDGAR_FALLBACK: "2" },
      { USE_SYSTEM_CA: "maybe" }, { HISTORY_RANGE: "5" }, { HISTORY_RANGE: "0y" }, { AUM: "5" }, { AUM: "10:1" }, { AUM: "huge:" }, { TER: "a:b" },
      { TER: "1:2:3" }, { PERFORMANCE_1Y: "x:" }, { TOTAL_RETURN_10Y: "5:1" }, { TICKERS: ["VTI"] }, { TICKERS: { a: 1 } }, null, [],
    ]) {
      expect(() => resolveControls(value)).toThrow();
      if (value && !Array.isArray(value)) expect(() => resolveControls({}, value)).toThrow();
    }
    expect(() => resolveControls({}, {}, {}, { MAX_RETRIES: "0" })).toThrow();
    expect(() => resolveControls({}, "x")).toThrow();
    expect(() => readConfig(resolveControls(file(), { MAX_RETRIES: 9 }))).toThrow("MAX_RETRIES");
  });

  test("config file: keys equal CONTROL_NAMES and --help, values are strings, the scheduled path equals the defaults", async () => {
    expect(Object.keys(file()).sort()).toEqual([...CONTROL_NAMES].sort());
    for (const value of Object.values(file())) expect(typeof value).toBe("string");
    expect(resolveControls(file(), {}, {}, {})).toEqual(file());
    for (const name of CONTROL_NAMES) {
      const [, prefix] = /^(PERFORMANCE|TOTAL_RETURN)_(.+)$/.exec(name) ?? [];
      if (prefix) expect(USAGE).toMatch(new RegExp(`  ${prefix}_YTD\\|1Y\\|3Y\\|5Y\\|10Y .*`));
      else expect(USAGE).toContain(`  ${name} `);
    }
    const f = file();
    expect([f.MAX_FETCHES, f.REQUEST_SLEEP, f.CONCURRENCY, f.MAX_RETRIES, f.HISTORY_RANGE, f.EDGAR_FALLBACK, f.SKIP_YAHOO]).toEqual(["0", "0", "4", "2", "max", "true", "false"]);
    for (const name of CONTROL_NAMES.filter((n) => /^(AUM|TER|DIVIDEND_YIELD|SEC_YIELD|PERFORMANCE_|TOTAL_RETURN_)/.test(n))) expect(f[name]).toBe(":");
    expect((await runtimeControls({})).CONCURRENCY).toBe(f.CONCURRENCY);
    expect((await runtimeControls({ CONCURRENCY: "7" })).CONCURRENCY).toBe("7");
    await expect(runtimeControls({ MAX_RETRIES: "0" })).rejects.toThrow();
  });

  test("SEC_UA defaults to the daggerok contact (never example.com) and a protected value wins", () => {
    expect(file().SEC_UA).toBe("daggerok ETF feed daggerok@gmail.com");
    expect(DEFAULT_SEC_UA).toBe(file().SEC_UA);
    expect(read("scripts/update-data.ts")).not.toMatch(/example\.com|admin@daggerok/);
    expect(resolveControls(file(), { SEC_UA: "adv" }, { SEC_UA: "in" }, { SEC_UA: "protected" }).SEC_UA).toBe("protected");
  });
});

describe("controls 2", () => {
  test("readConfig parses every control strictly; AUM takes K/M/B/T suffixes and size presets", () => {
    const c = readConfig(resolveControls(file(), { MAX_FETCHES: 3, AUM: "mid", TER: ":0.2", MAX_RETRIES: 4, TICKERS: "voo, vti;bnd", CATEGORY: "bond", HISTORY_RANGE: "5Y", SKIP_YAHOO: "yes", EDGAR_FALLBACK: "off", TOTAL_RETURN_3Y: "10:" }));
    expect([c.maxFetches, c.maxRetries, c.tickers, c.category, c.historyRange, c.skipYahoo, c.edgarFallback]).toEqual([3, 4, ["VOO", "VTI", "BND"], "bond", "5y", true, false]);
    expect(c.aumRange).toMatchObject({ min: 2e9, max: 1e10 });
    expect(c.terRange).toMatchObject({ min: Number.NEGATIVE_INFINITY, max: 0.2 });
    expect(c.totalReturnRanges["3Y"]).toMatchObject({ min: 10 });
    expect([hasDeferredFilters(c), hasDeferredFilters(readConfig(file())), readConfig({}).maxRetries]).toEqual([true, false, 2]);
    expect(parseAumRange("$500M:2.5B")).toMatchObject({ min: 5e8, max: 2.5e9 });
    expect(parseAumRange("nano")).toMatchObject({ min: 0, max: 1e7 });
    expect(parseAumRange("small:mid")).toMatchObject({ min: 3e8, max: 1e10 });
    expect([parseAumRange(":"), parseRange("-1:5.5")]).toEqual([undefined, expect.objectContaining({ min: -1, max: 5.5 })]);
  });

  test("metric filters: AUM, TER and yield need a value (null, never 0), returns pass when unavailable; static filters by ticker and category", () => {
    const metrics = (over: any = {}) => ({ aum: 1e11, ter: 0.03, dividendYield: 1.5, secYield: 1.2, performance: { YTD: 10, "1Y": 20, "3Y": 12 }, totalReturn: { "3Y": 40 }, ...over });
    const cfg = (c: Record<string, string>) => readConfig(resolveControls(file(), c));
    expect(cases([{}, { AUM: "large" }, { TER: ":0.05" }, { SEC_YIELD: "1:2" }, { PERFORMANCE_5Y: "5:" }, { TOTAL_RETURN_3Y: "30:50", PERFORMANCE_YTD: "5:15" }]).map((c) => passesMetricFilters(metrics(), cfg(c)))).toEqual([true, true, true, true, true, true]);
    expect(cases([{ DIVIDEND_YIELD: "2:" }, { PERFORMANCE_1Y: "25:" }, { TOTAL_RETURN_3Y: "50:" }]).map((c) => passesMetricFilters(metrics(), cfg(c)))).toEqual([false, false, false]);
    expect(passesMetricFilters(metrics({ aum: 5e8 }), cfg({ AUM: "large" }))).toBe(false);
    expect(passesMetricFilters(metrics({ aum: null }), cfg({ AUM: "1M:" }))).toBe(false);
    expect(passesMetricFilters(metrics({ ter: 0.2 }), cfg({ TER: ":0.05" }))).toBe(false);
    const voo = ["VOO", "Vanguard S&P 500 ETF", "US Equity"] as const;
    const bnd = ["BND", "Vanguard Total Bond Market ETF", "Bond"] as const;
    expect([passesStaticFilters(voo, cfg({})), passesStaticFilters(voo, cfg({ TICKERS: "bnd" })), passesStaticFilters(bnd, cfg({ TICKERS: "bnd" })), passesStaticFilters(bnd, cfg({ CATEGORY: "BOND" })), passesStaticFilters(voo, cfg({ CATEGORY: "bond" }))]).toEqual([true, false, true, true, false]);
  });

  test("MAX_FETCHES batches resume at the saved cursor and wrap, a different scope restarts", () => {
    const funds = [["A"], ["B"], ["C"], ["D"], ["E"]] as const;
    const tickers = ["A", "B", "C", "D", "E"];
    expect(selectBatch(funds, 0, null).selected).toHaveLength(5);
    expect(selectBatch(funds, 2, null)).toMatchObject({ startCursor: 0, nextCursor: 2 });
    const second = selectBatch(funds, 2, { cursor: 2, tickers });
    expect([second.selected.map((f) => f[0]), second.nextCursor]).toEqual([["C", "D"], 4]);
    const last = selectBatch(funds, 2, { cursor: 4, tickers });
    expect([last.selected.map((f) => f[0]), last.nextCursor]).toEqual([["E"], 0]);
    expect(selectBatch(funds, 2, { cursor: 2, tickers: ["A", "B"] }).startCursor).toBe(0);
    expect(selectBatch([], 2, null)).toMatchObject({ selected: [], nextCursor: 0 });
  });

  test("USE_SYSTEM_CA: auto by default, case-insensitive, restart only on certificate errors", async () => {
    expect(file().USE_SYSTEM_CA).toBe("auto");
    for (const v of ["auto", "True", "FALSE"]) expect(resolveControls({}, {}, {}, { USE_SYSTEM_CA: v }).USE_SYSTEM_CA).toBe(v.toLowerCase());
    expect(isCertError({ code: "UNABLE_TO_GET_ISSUER_CERT_LOCALLY" })).toBe(true);
    expect(isCertError(Object.assign(new Error("fetch failed"), { cause: new Error("unable to get local issuer certificate") }))).toBe(true);
    expect([isCertError({ code: "ECONNRESET" }), isCertError(new Error("HTTP 403 Forbidden")), isCertError(null)]).toEqual([false, false, false]);
    console.error = () => {};
    const never = (): never => { throw new Error("unexpected reexec"); };
    installSystemCa("false", never, false);
    installSystemCa("auto", never, true);
    expect(globalThis.fetch).toBe(realFetch);
    expect(() => installSystemCa("true", () => { throw new Error("reexec"); }, false)).toThrow("reexec");
    let reexecs = 0;
    globalThis.fetch = (async (url: string) => {
      if (url === "cert") throw Object.assign(new Error("fetch failed"), { cause: { code: "UNABLE_TO_GET_ISSUER_CERT_LOCALLY" } });
      if (url === "reset") throw Object.assign(new Error("reset"), { code: "ECONNRESET" });
      return new Response("ok");
    }) as unknown as typeof fetch;
    installSystemCa("auto", () => { reexecs++; throw new Error("reexec"); }, false);
    expect(await (await fetch("fine")).text()).toBe("ok");
    await expect(fetch("reset")).rejects.toThrow("reset");
    expect(reexecs).toBe(0);
    await expect(fetch("cert")).rejects.toThrow("reexec");
    expect(reexecs).toBe(1);
  });
});

// ===========================================================================
describe("parsing", () => {
  test("history page rows are keyed by the exact headers; Yahoo-only rows keep NAV, price and premium null", () => {
    const [row] = historyPageRows([{ date: "2026-09-16", open: 180.1, high: 181.2, low: 179.6, close: 180.74, adjClose: 179.9, volume: 372240 }]);
    expect(Object.keys(row).sort()).toEqual(["Adj Close", "Close", "Date", "High", "Low", "Market Price", "NAV", "Open", "Premium/Discount (%)", "Source", "Volume"]);
    expect([row["Date"], row["Adj Close"], row["NAV"], row["Market Price"], row["Premium/Discount (%)"], row["Source"]]).toEqual(["2026-09-16", 179.9, null, null, null, "yahoo-fallback"]);
  });

  test("official NAV, market price and premium are merged with Yahoo OHLCV by date, sorted ascending", () => {
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
    expect(byDate["2026-07-01"]).toEqual({ Date: "2026-07-01", Open: 683.0, High: 686.0, Low: 682.5, Close: 685.28, "Adj Close": 685.28, Volume: 3500000, NAV: 685.25, "Market Price": 685.46, "Premium/Discount (%)": 0.03, Source: "vanguard-official" });
    expect(byDate["2026-07-02"]).toEqual({ Date: "2026-07-02", Open: null, High: null, Low: null, Close: null, "Adj Close": null, Volume: null, NAV: 685.28, "Market Price": 684.84, "Premium/Discount (%)": -0.06, Source: "vanguard-official" });
    expect(byDate["2016-09-01"]).toMatchObject({ NAV: null, "Market Price": null, "Premium/Discount (%)": null, Source: "yahoo-fallback" });
    expect(rows.map((row: any) => row.Date)).toEqual(["2016-09-01", "2026-07-01", "2026-07-02"]);
  });

  test("historicalPrice and premiumDiscountDetails give one official point per date, an empty fund gives none", () => {
    const points = parseVanguardOfficialHistory({
      historicalPrice: { ticker: "VOO", "3m": { nav: [{ asOfDate: "07/01/2026", price: "$685.25" }] }, "10Y": { nav: [{ asOfDate: "09/30/2016", price: "$198.69" }] } },
      premiumDiscountDetails: [{ periodQualifier: "CURR", prdLabel: "CURR", asOfDt: "09/24/2026", pdDetails: [{ nav: "$685.25", marketPrice: "$685.46", premiumDiscountPercentage: "0.03%", premiumDiscountAmount: "$0.21", effectiveDate: "07/01/2026" }] }],
    });
    expect(points).toEqual([
      { date: "2016-09-30", nav: 198.69, marketPrice: null, premiumDiscountPct: null },
      { date: "2026-07-01", nav: 685.25, marketPrice: 685.46, premiumDiscountPct: 0.03 },
    ]);
    expect([parseVanguardOfficialHistory({ historicalPrice: {}, premiumDiscountDetails: [] }), parseVanguardOfficialHistory(null), parseVanguardOfficialHistory({ holdingDetails: {} })]).toEqual([[], [], []]);
  });

  test("distribution rows are latest-first with ISO ex-dates, frequency maps to payments per year", () => {
    expect(DISTRIBUTION_HEADERS).toEqual(["Frequency", "Ex-Date", "Record Date", "Payable Date", "Dividend", "ST Cap Gains", "LT Cap Gains"]);
    const rows = distributionRows("Quarterly", [{ epoch: 1774359000, amount: 0.969 }, { epoch: 1782307800, amount: 1.032 }]);
    expect(rows[0]).toEqual(["Quarterly", "2026-06-24", "—", "—", "1.032", "—", "—"]);
    expect(rows[1][1]).toBe("2026-03-24");
    expect(["Monthly", "Quarterly", "Semi-annually", "Annually", "Irregular", null].map(paymentsPerYear)).toEqual([12, 4, 2, 1, null, null]);
  });

  test("dates written as text are calendar dates: the same ISO date in every timezone", () => {
    const texts = ["Oct 01 2026", "October 1, 2026", "01 Oct 2026", "Wed, Oct 1, 2026", "2026-10-01T00:00:00-04:00", "10/01/2026", "10/01/26"];
    for (const tz of ["UTC", "America/New_York", "Asia/Tokyo", "Europe/Berlin"]) {
      process.env.TZ = tz;
      expect(texts.map(toIsoDate)).toEqual(texts.map(() => "2026-10-01"));
      expect([toIsoDate("garbage"), toIsoDate("")]).toEqual(["", ""]);
    }
  });
});

describe("parsing 2", () => {
  test("IRR holdingDetails map to the holdings sheet shape; rows use the standard headers, legacy rows convert losslessly", () => {
    const parsed = parseVanguardHoldingDetails({ holdingDetails: { asOfDate: "08/31/2026", equityHoldings: [{ ticker: "XOM", holdingName: "Exxon Mobil Corp", marketValuePercentage: 22.5, sector: "Energy" }] } });
    expect([parsed?.asOf, parsed?.rows.length, parsed?.rows[0]["Ticker"], parsed?.rows[0]["Weight"], parsed?.rows[0]["Asset Category"]]).toEqual(["2026-08-31", 1, "XOM", 22.5, "Equity"]);
    expect(Object.keys(parsed!.rows[0]).slice(0, 7)).toEqual(HOLDINGS_HEADERS_BASE.slice(0, 7));
    expect([parseVanguardHoldingDetails({ historicalPrice: {} }), parseVanguardHoldingDetails(null)]).toEqual([null, null]);
    // a bond row carries its issuer's equity ticker (every Treasury is "T", AT&T's): debt stays identifier-keyed
    const bonds = parseVanguardHoldingDetails({ holdingDetails: { asOfDate: "09/30/2026", bondHoldings: [{ ticker: "T", holdingName: "United States Treasury Note/Bond", marketValuePercentage: "0.41%", cusip: "91282CLW9" }] } });
    expect([bonds?.rows[0].Ticker, bonds?.rows[0].Identifier, bonds?.rows[0]["Asset Category"]]).toEqual(["—", "91282CLW9", "Bond"]);
    expect([holdingIdentifier("—", "US0378331005"), holdingIdentifier("037833100", "US0378331005"), holdingIdentifier("-", null)]).toEqual(["US0378331005", "037833100", "—"]);
    const legacy = { Ticker: "AAPL", Name: "Apple Inc", "Weight (%)": "7.03%", "Market Value": "$1", Shares: "2", "Asset Class": "Equity", Sector: "—", Exchange: "—", Location: "—", CUSIP: "037833100", ISIN: "US0378331005", Currency: "—" };
    const standard = standardHoldingRow(legacy);
    expect(Object.keys(standard)).toEqual(HOLDINGS_HEADERS_BASE);
    expect(standard).toMatchObject({ Name: "Apple Inc", Ticker: "AAPL", Identifier: "037833100", Weight: "7.03%", "Shares Held": "2", "Asset Category": "Equity" });
    expect(standardHoldingHeaders([standardHoldingRow({ ...legacy, Coupon: "4.1", Maturity: "2030-01-31" })])).toEqual([...HOLDINGS_HEADERS_BASE, "Coupon", "Maturity"]);
  });

  test("IRR weights rounded to 0.00% or left out are refilled from the market value on the published % of net assets basis", () => {
    const row = (name: string, weight: unknown, value: string) => ({ holdingName: name, marketValuePercentage: weight, marketValueBaseCurrency: value });
    const weights = (holdings: unknown[]) => parseVanguardHoldingDetails({ holdingDetails: { asOfDate: "09/30/2026", bondHoldings: holdings } })!.rows.map((r) => r.Weight);
    // k = (4 + 3 + 2 + 0.5) / 950,000 = 1e-5 from the rows of at least 0.10%, a negative one included by its absolute value
    expect(weights([row("A", "4.00%", "$400,000"), row("B", "3.00%", "$300,000"), row("C", "2.00%", "$200,000"), row("Cash", "-0.50%", "-$50,000"),
      row("D", "0.00%", "$500"), row("E", undefined, "$1,000"), row("F", "0.01%", "$400"), row("G", "0.00%", "—")]))
      .toEqual(["4.00%", "3.00%", "2.00%", "-0.50%", "0.0050%", "0.0100%", "0.0040%", "0.00%"]);
    // a levered sheet keeps its own total: k comes from its published weights, not from 100 / total market value
    expect(weights([row("A", "60.00%", "$600"), row("B", "50.00%", "$500"), row("C", "10.00%", "$100"), row("D", "0.00%", "$0.40")])).toEqual(["60.00%", "50.00%", "10.00%", "0.0400%"]);
    // fewer than three calibration rows (a fund of two funds): unchanged
    expect(weights([row("BND", "51.31%", "$100"), row("BNDX", "48.69%", "$95"), row("Cash", "0.00%", "$1")])).toEqual(["51.31%", "48.69%", "0.00%"]);
  });

  test("SEC (shared nport-reader): fund ticker map, N-PORT sheet with the \"—\" placeholder for missing numbers, no derivative identifiers, tickers only for U.S. equities", () => {
    expect(parseSecFundTickers({ fields: ["symbol", "cik", "seriesId", "classId"], data: [["VDE", "36405", "S000002853", "C000007861"]] }).get("VDE")).toEqual({ cik: "0000036405", seriesId: "S000002853", classId: "C000007861" });
    const filing = parseNportFiling(
      `<edgarSubmission><formData><genInfo><regName>VANGUARD INDEX FUNDS</regName><regCik>0000036405</regCik><seriesName>Vanguard Energy ETF</seriesName><seriesId>S000002853</seriesId><repPdDate>2026-07-31</repPdDate></genInfo><fundInfo><netAssets>10900000000</netAssets></fundInfo>` +
        `<invstOrSec><name>Exxon Mobil Corp</name><cusip>30231G102</cusip><balance>1234567.000000</balance><valUSD>150000000</valUSD><pctVal>13.76</pctVal><assetCat>EC</assetCat><curCd>USD</curCd></invstOrSec>` +
        `<invstOrSec><name>US TREASURY N/B</name><cusip>91282CKP5</cusip><identifiers><ticker value="T"/></identifiers><balance>5000000</balance><valUSD>4900000</valUSD><assetCat>DBT</assetCat><curCd>USD</curCd><debtSec><annualizedRt>4.125</annualizedRt><maturityDt>2030-01-31</maturityDt></debtSec></invstOrSec>` +
        `<invstOrSec><name>E-MINI ENERGY</name><cusip>000000000</cusip><identifiers><other otherDesc="Bloomberg Identifier" value="BBG01VKPGXL9"/></identifiers><valUSD>49137</valUSD><pctVal>0.005</pctVal><assetCat>DE</assetCat><curCd>USD</curCd><derivativeInfo><futrDeriv derivCat="FUT"><descRefInstrmnt><otherRefInst><identifiers><cusip value="81369Y506"/><ticker value="XLE"/></identifiers></otherRefInst></descRefInstrmnt></futrDeriv></derivativeInfo></invstOrSec></formData></edgarSubmission>`,
    );
    expect([filing.seriesId, filing.repPdDate, filing.positions.length]).toEqual(["S000002853", "2026-07-31", 3]);
    const rows = nportHoldingRows(filing, nportTickers(filing.positions, parseSecCompanyNames({ 0: { ticker: "XOM", title: "EXXON MOBIL CORP" }, 1: { ticker: "T", title: "AT&T INC." } })));
    expect(Object.keys(rows[0])).toEqual(HOLDINGS_HEADERS_BASE);
    expect(rows[0]).toMatchObject({ Name: "Exxon Mobil Corp", Ticker: "XOM", Identifier: "30231G102", Weight: "13.76", "Market Value": "150000000", "Shares Held": "1234567", "Asset Category": "EC", CUSIP: "30231G102", Currency: "USD" });
    // the Treasury note keeps no ticker (a bond is no "T" for AT&T) and the placeholder weight, never 0; the future keeps its own id, not XLE's
    expect(rows.slice(1).map((row) => [row.Ticker, row.Identifier, row.Weight, row.CUSIP, row.Coupon, row.Maturity])).toEqual([["—", "91282CKP5", "—", "91282CKP5", "4.125", "2030-01-31"], ["—", "BBG01VKPGXL9", "0.005", "—", undefined, undefined]]);
    expect(standardHoldingHeaders(rows)).toEqual([...HOLDINGS_HEADERS_BASE, "Coupon", "Maturity"]);
    // SEC names carry an EDGAR state suffix ("BANK OF AMERICA CORP /DE/") that the filing's issuer name lacks
    const bac = parseNportFiling(`<invstOrSec><name>Bank of America Corp</name><cusip>060505104</cusip><valUSD>1</valUSD><pctVal>1</pctVal><assetCat>EC</assetCat><curCd>USD</curCd></invstOrSec>`);
    expect(nportTickers(bac.positions, parseSecCompanyNames({ 0: { ticker: "BAC", title: "BANK OF AMERICA CORP /DE/" } }))).toEqual(["BAC"]);
  });

  test('holdings guard: header-only, renamed weight column, broken weights, a bad weight sum and a halved sheet are rejected', () => {
    const headers = ['Name', 'Ticker', 'Weight'];
    const rows = [{ Name: 'A', Ticker: 'A', Weight: '60%' }, { Name: 'B', Ticker: 'B', Weight: '40%' }];
    expect(holdingsGuard(headers, rows, 2)).toBeNull();
    expect(holdingsGuard(headers, [['A', 'A', '60'], ['B', 'B', '40']], null)).toBeNull();
    expect(holdingsGuard([], [], 0)).toBeNull(); // nothing published before: an empty sheet is honest
    expect(holdingsGuard(headers, [], 505)).toContain('no holdings rows');
    expect(holdingsGuard(['Name', 'Ticker', 'Wt'], rows, 2)).toContain('no weight column');
    expect(holdingsGuard(headers, rows.map((row) => ({ ...row, Weight: '6\u200B0' })), 2)).toContain('numeric weight');
    const allocation = [{ Name: 'Cash&Collateral', Ticker: '-', Weight: '100' }, { Name: 'Equities', Ticker: '-', Weight: '476' }];
    expect(holdingsGuard(headers, allocation, 2)).toContain('outside 50..150');
    expect(holdingsGuard(headers, allocation, 2, ['sum'])).toBeNull();
    expect(holdingsGuard(headers, rows, 5)).toContain('less than half');
  });

  test("dates, amounts and ISIN: placeholders stay null, never 0", () => {
    expect([toIsoDate("2026-07-31"), toIsoDate("08/31/2026"), toIsoDate("")]).toEqual(["2026-07-31", "2026-08-31", ""]);
    expect([formatDisplayDate("2026-09-30"), formatDisplayDate(null), formatDisplayDate("n/a"), isoFromDisplayDate("Sep 30 2026"), isoFromDisplayDate("—")]).toEqual(["Sep 30 2026", "—", "—", "2026-09-30", ""]);
    expect([parseAmount("$1.0T"), parseAmount("$123.4 B"), parseAmount("$850M"), parseAmount("1,234"), parseAmount(null), parseAmount("n/a")]).toEqual([1e12, 123.4e9, 8.5e8, 1234, null, null]);
    expect([isinFromCusip("922908769"), isinFromCusip("037833100"), isinFromCusip("bad"), isinFromCusip(null)]).toEqual(["US9229087690", "US0378331005", null, null]);
  });
});

// ===========================================================================
describe("metrics", () => {
  test("official YTD and 1Y win, 3Y/5Y/10Y are derived and null when the history is short (never 0)", () => {
    const derived = summary(YAHOO_ROWS);
    const m = buildMetrics({ officialYtd: 12.7195, officialOneYear: 15.7029, officialAsOf: "2026-05-29", derived, derivedYtd: ytdFromRows(YAHOO_ROWS), dividendYield: 1.05116, secYield: 0.98 });
    expect(m).toMatchObject({ ytd: 12.72, tr1y: 15.7, cagr3y: null, cagr5y: null, cagr10y: null, tr3y: null, tr5y: null, tr10y: null, siAnn: null });
    expect([m.dividendYield, m.secYieldText, m.performanceAsOf, m.returnsBasis]).toEqual([1.05, "0.98%", "2026-05-29", "official Vanguard YTD and 1-year returns"]);
    const d = buildMetrics({ officialYtd: null, officialOneYear: null, officialAsOf: null, derived, derivedYtd: ytdFromRows(YAHOO_ROWS), dividendYield: null, secYield: null });
    expect(d.ytd).toBeCloseTo((121 / 115 - 1) * 100, 1);
    expect(d.tr1y).toBeCloseTo(10, 6);
    expect([d.performanceAsOf, d.returnsBasis, d.dividendYield, d.dividendYieldText]).toEqual(["2026-06-01", "YTD and 1-year returns derived from Yahoo Finance adjusted market-price closes (not NAV)", null, "—"]);
    const l = buildMetrics({ officialYtd: null, officialOneYear: null, officialAsOf: null, derived: summary(LONG_ROWS), derivedYtd: null, dividendYield: null, secYield: null });
    expect(l.cagr10y).toBeCloseTo((5 ** (1 / 10) - 1) * 100, 1);
    expect(l.tr10y).toBeCloseTo(400, 1);
    expect(l.cagr3y).toBeCloseTo(((500 / 300) ** (1 / 3) - 1) * 100, 1);
    expect([m.dividendYieldBasis, d.dividendYieldBasis]).toEqual(["official-other", null]);
    const none = buildMetrics({ officialYtd: null, officialOneYear: null, officialAsOf: null, derived: summary([]), derivedYtd: null, dividendYield: null, secYield: null });
    expect([none.performanceAsOf, none.returnsBasis]).toEqual([null, "unavailable"]);
  });

  test("a young fund gets null long-period returns, bounded history never yields a wrong long-period return", () => {
    const s = summary(rowsFrom([["2026-01-05", 100], ["2026-06-01", 103]]));
    expect([s.performance, s.totalReturn]).toEqual([{}, {}]);
    const rows = [{ date: "2024-01-02", adjClose: 100 }, { date: "2025-01-02", adjClose: 110 }, { date: "2026-01-02", adjClose: 121 }, { date: "2026-06-01", adjClose: 133.1 }];
    expect(summary(rows, true).performance["1Y"]).toBeCloseTo(((133.1 / 110) ** 1 - 1) * 100, 6);
    const perf: Record<string, number | undefined> = summary(rows, true).performance;
    expect([perf["5Y"], perf["10Y"]]).toEqual([undefined, undefined]);
    expect(summary(rows, false).performance["5Y"]).toBeDefined();
  });

  test("YTD return is measured from the last close of the prior year", () => {
    const rows = [{ date: "2025-12-30", adjClose: 100 }, { date: "2025-12-31", adjClose: 200 }, { date: "2026-03-02", adjClose: 210 }, { date: "2026-06-01", adjClose: 250 }];
    expect(ytdFromRows(rows)).toBeCloseTo(25, 6);
    expect([ytdFromRows([{ date: "2026-01-05", adjClose: 10 }]), ytdFromRows([])]).toEqual([null, null]);
  });
});

describe("metrics 2", () => {
  test("a fund younger than one year publishes no 1y, 3y or since-inception return, official or derived (calendar anniversary)", async () => {
    const { dir } = await runOffline({ TICKERS: "VOO" }, undefined, { inception: "2026-01-15" });
    const metrics = jsonOf(dir, "index.json").funds[0].metrics;
    expect([metrics.tr1y, metrics.cagr3y, metrics.siAnn, metrics.performanceAsOf]).toEqual([null, null, null, "2026-06-01"]);
    expect(metrics.ytd).toBeCloseTo((121 / 115 - 1) * 100, 1);
    const old = assembleFund(inputsFor({ inceptionDate: "2025-05-29" })).row.metrics;
    expect([old.tr1y, assembleFund(inputsFor({ inceptionDate: "2025-05-30" })).row.metrics.tr1y]).toEqual([15.7, null]);
  });

  test("latest quote: official NAV, the price and premium of Vanguard's price day, Yahoo close as the price fallback", () => {
    expect(latestQuote(inputsFor().pageRows)).toEqual({ nav: { value: 101, date: "2026-06-01" }, price: { value: 101.1, date: "2026-06-01" }, premiumDiscount: 0.1 });
    expect(latestQuote([{ Date: "2026-06-01", Close: 50, NAV: null, "Market Price": null, "Premium/Discount (%)": null }])).toEqual({ nav: null, price: { value: 50, date: "2026-06-01" }, premiumDiscount: null });
    expect(latestQuote([])).toEqual({ nav: null, price: null, premiumDiscount: null });
  });

  test("catalog row and meta have the standard keys, one metrics key set with returnsBasis and performanceAsOf last", () => {
    const { meta, row } = assembleFund(inputsFor());
    expect(Object.keys(row)).toEqual([
      "ticker", "name", "category", "fundPage", "dataFile", "cusip", "isin", "ter", "terValue", "nav", "navValue", "aum", "aumValue",
      "asOfDate", "inceptionDate", "exchange", "closePrice", "closePriceValue", "premiumDiscount", "premiumDiscountValue",
      "distributions", "returns", "metrics", "holdings", "history",
    ]);
    expect(Object.keys(row.metrics)).toEqual(["ytd", "tr1y", "tr3y", "tr5y", "tr10y", "cagr3y", "cagr5y", "cagr10y", "siAnn", "dividendYield", "dividendYieldText", "dividendYieldBasis", "secYield", "secYieldText", "returnsBasis", "performanceAsOf"]);
    expect(Object.keys(meta)).toEqual(["ticker", "name", "category", "categoryPath", "source", "providerIds", "legalStructure", "identifiers", "inception", "expenseRatio", "nav", "marketPrice", "premiumDiscount", "aum", "yields", "returns", "distributions", "holdings", "history"]);
    expect(row).toMatchObject({ dataFile: "./funds/VOO/meta.json", ter: "0.03%", terValue: 0.03, nav: "$101.00", navValue: 101, aum: "$1.0T", aumValue: 1e12, asOfDate: "Jun 01 2026", closePrice: "$101.10", premiumDiscount: "0.10%", holdings: 2, history: 2, distributions: { frequency: "Quarterly", exDate: "03/27/2026", dividend: "1.8" } });
    expect(row.returns.monthEnd).toMatchObject({ asOfDate: "May 29 2026", ytd: 12.72, yr1: 15.7, yr3: null, sinceInception: null });
    expect(meta.yields).toMatchObject({ dividendYield: 1.05, secYield: null, secYieldText: "—", secYieldKind: "not published" });
    expect(previousValues(meta)).toMatchObject({ portId: "0968", frequency: "Quarterly", netAssets: "$1.0T", netAssetsAsOf: "2026-05-31", expense: 0.03, dividendYield: 1.05, secYield: null });
    expect(Object.keys(assembleFund(inputsFor({ yahooRows: [], pageRows: [] })).row.metrics)).toEqual(Object.keys(row.metrics));
    // dividendYieldBasis: official-other with a published yield, null exactly when the yield is null, same key set either way
    const noYield = assembleFund(inputsFor({ dividendYield: null })).row.metrics;
    expect([row.metrics.dividendYieldBasis, noYield.dividendYieldBasis, noYield.dividendYield]).toEqual(["official-other", null, null]);
    expect(Object.keys(noYield)).toEqual(Object.keys(row.metrics));
    // a retained row from before the key existed gets the code beside its own yield, in the same key order
    const { dividendYieldBasis: _drop, ...legacy } = row.metrics;
    const kept = withYieldBasis({ ticker: "VOO", metrics: legacy });
    expect([kept.metrics.dividendYieldBasis, Object.keys(kept.metrics)]).toEqual(["official-other", Object.keys(row.metrics)]);
    expect(withYieldBasis({ metrics: { ...legacy, dividendYield: null } }).metrics.dividendYieldBasis).toBeNull();
    const index = buildIndex([{ holdings: 3, history: 4 }, { holdings: 2, history: 1 }], "2026-01-01T00:00:00.000Z");
    expect([Object.keys(index), index.counts, index.source.provider]).toEqual([["generatedAt", "source", "counts", "funds"], { funds: 2, holdings: 5, history: 5 }, "Vanguard"]);
  });

  test("the metric filters read the standard metrics: PERFORMANCE_* annualized, TOTAL_RETURN_* cumulative", () => {
    const { row } = assembleFund(inputsFor({ yahooRows: LONG_ROWS, officialYtd: null, officialOneYear: null, officialAsOf: null }));
    const fm = filterMetricsOf(row);
    expect([fm.performance["10Y"], fm.totalReturn["10Y"], fm.aum, fm.ter]).toEqual([row.metrics.cagr10y, row.metrics.tr10y, 1e12, 0.03]);
    const cfg = (c: Record<string, string>) => readConfig(resolveControls(file(), c));
    expect(cases([{ PERFORMANCE_10Y: "15:20" }, { TOTAL_RETURN_10Y: "300:500" }, { AUM: "large", TER: ":0.05", DIVIDEND_YIELD: "1:2" }]).map((c) => passesMetricFilters(fm, cfg(c)))).toEqual([true, true, true]);
    expect(cases([{ PERFORMANCE_10Y: "20:" }, { TOTAL_RETURN_10Y: ":100" }]).map((c) => passesMetricFilters(fm, cfg(c)))).toEqual([false, false]);
  });
});

// ===========================================================================
// Pipeline: the real run() against a mocked fetch, writing into a per-test temp dir
// ===========================================================================
function mockFeed(opts: { delayMs?: number; failYahoo?: boolean; noHoldings?: boolean; nportAsOf?: string; nportSeries?: string; urls?: string[]; adjclose?: number[]; holdingsWeightKey?: string; down?: boolean; downTicker?: string; chartDays?: number; inception?: string } = {}) {
  const inflight = new Set<string>();
  let peak = 0;
  const epoch = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000;
  const fetchMock = (async (input: any) => {
    const url = String(input?.url ?? input);
    opts.urls?.push(url);
    const ticker = /\/(?:chart\/|profile\/)([A-Z]+)(?:-|\?)/.exec(url)?.[1] ?? "";
    if (ticker) { inflight.add(ticker); peak = Math.max(peak, inflight.size); }
    if (opts.delayMs) await new Promise((resolve) => realSetTimeout(resolve, opts.delayMs));
    try {
      if (opts.down || (opts.downTicker && url.toLowerCase().includes(`/${opts.downTicker.toLowerCase()}`))) return new Response("down", { status: 404 });
      if (opts.nportAsOf) {
        if (url.includes("company_tickers_mf")) return Response.json({ fields: ["symbol", "cik", "seriesId", "classId"], data: [["VOO", "36405", "S000002839", "C000007773"]] });
        if (url.includes("company_tickers")) return Response.json({});
        if (url.includes("browse-edgar")) return new Response(`<feed><entry><filing-type>NPORT-P</filing-type><accession-number>0001234567-26-000001</accession-number><filing-date>2026-04-20</filing-date><filing-href>https://www.sec.gov/Archives/edgar/data/36405/000123456726000001/</filing-href></entry></feed>`);
        if (url.includes("/Archives/edgar/")) return new Response(`<edgarSubmission><formData><genInfo><regCik>0000036405</regCik><seriesName>Vanguard S&amp;P 500 ETF</seriesName><seriesId>${opts.nportSeries ?? "S000002839"}</seriesId><repPdDate>${opts.nportAsOf}</repPdDate></genInfo><fundInfo><netAssets>1000</netAssets></fundInfo><invstOrSec><name>Old Filing Co</name><cusip>999999999</cusip><balance>1</balance><valUSD>5</valUSD><pctVal>100</pctVal><assetCat>EC</assetCat></invstOrSec></formData></edgarSubmission>`);
      }
      if (url.includes("advisors.vanguard.com")) return new Response('<html>"portId": "0970"</html>');
      if (url.includes("fundDetails")) {
        return Response.json({ marketData: { body: { fundIdentifiers: { cusip: "922908769" }, exchange: "New York Stock Exchange Arca", fundCharacteristics: { fundInceptionDate: opts.inception ?? "2001-05-24" } } } });
      }
      if (url.includes("finance.yahoo.com")) {
        if (opts.failYahoo) return new Response("down", { status: 404 });
        const days = ["2024-12-31", "2025-06-01", "2025-12-31", "2026-06-01"].slice(-(opts.chartDays ?? 4));
        const adj = [100, 110, 115, 121].slice(-(opts.chartDays ?? 4));
        return Response.json({ chart: { result: [{ timestamp: days.map(epoch), indicators: { quote: [{ open: adj, high: adj, low: adj, close: adj, volume: adj }], adjclose: [{ adjclose: opts.adjclose ?? adj }] }, events: { dividends: { [epoch("2026-03-27")]: { amount: 1.8, date: epoch("2026-03-27") } } } }] } });
      }
      if (url.includes("AdditionalFundData")) {
        return Response.json({
          holdingDetails: { asOfDate: "05/31/2026", equityHoldings: opts.noHoldings ? [] : [{ ticker: "AAA", holdingName: "A Corp", [opts.holdingsWeightKey ?? "marketValuePercentage"]: "100.00%", cusip: "123456789" }] },
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

async function runOffline(controls: Record<string, string>, existingDir?: string, opts: Parameters<typeof mockFeed>[0] & { softDeadlineMs?: number; lines?: string[] } = {}) {
  const dir = existingDir ?? mkdtempSync(join(tmpdir(), "vanguard-feed-"));
  if (!existingDir) tempDirs.push(dir);
  const feed = mockFeed(opts);
  globalThis.fetch = feed.fetchMock;
  console.log = (line?: unknown) => { opts.lines?.push(String(line)); };
  try {
    await run(readConfig(resolveControls(file(), { REQUEST_SLEEP: "0", MAX_RETRIES: "1", ...controls })), pathToFileURL(`${dir}/`), opts.softDeadlineMs);
    return { dir, peak: feed.peak() };
  } finally {
    Object.assign(console, realConsole);
    globalThis.fetch = realFetch;
  }
}
const textOf = (dir: string, path: string) => readFileSync(join(dir, path), "utf8");
const jsonOf = (dir: string, path: string) => JSON.parse(textOf(dir, path));
const filesOf = (dir: string): string[] => (readdirSync(dir, { recursive: true }) as string[]).filter((f) => statSync(join(dir, f)).isFile()).sort();
const backdate = (dir: string): void => { for (const f of filesOf(dir)) utimesSync(join(dir, f), 1_000_000_000, 1_000_000_000); };
const touched = (dir: string): string[] => filesOf(dir).filter((f) => statSync(join(dir, f)).mtimeMs !== 1_000_000_000_000);

describe("pipeline", () => {
  test("a run writes the standard index, meta and holdings pages with the same metrics key set on every row", async () => {
    const { dir } = await runOffline({ TICKERS: "VOO VTI" });
    const index = jsonOf(dir, "index.json");
    expect(Object.keys(index)).toEqual(["generatedAt", "source", "counts", "funds"]);
    expect(index.counts).toEqual({ funds: 2, holdings: 2, history: 10 });
    const voo = index.funds.find((fund: any) => fund.ticker === "VOO");
    expect([voo.metrics.cagr3y, voo.metrics.performanceAsOf, voo.navValue, voo.cusip, voo.isin, voo.exchange, voo.inceptionDate, voo.dataFile]).toEqual([null, "2026-06-01", 101, "922908769", "US9229087690", "New York Stock Exchange Arca", "May 24 2001", "./funds/VOO/meta.json"]);
    expect(voo.metrics.tr1y).toBeCloseTo(10, 6);
    expect(voo.distributions).toEqual({ frequency: null, exDate: "03/27/2026", dividend: "1.8" });
    for (const fund of index.funds) expect(Object.keys(fund.metrics)).toEqual(Object.keys(voo.metrics));
    // every row carries the 52-week keys from its history pages (range-52w block)
    const RANGE_KEYS = ["week52Low", "week52High", "range52w", "range52wClose", "range52wAsOf", "range52wSince", "range52wBasis"];
    for (const fund of index.funds) expect(Object.keys(fund.metrics)).toEqual(expect.arrayContaining(RANGE_KEYS));
    expect(Object.keys(jsonOf(dir, "funds/VOO/meta.json"))).toEqual(Object.keys(assembleFund(inputsFor()).meta));
    const holdings = jsonOf(dir, "funds/VOO/holdings/001.json");
    expect(holdings.headers).toEqual(HOLDINGS_HEADERS_BASE);
    expect(holdings.rows[0]).toMatchObject({ Name: "A Corp", Ticker: "AAA", Identifier: "123456789", Weight: "100.00%" });
  });

  test("a metric filter keeps a failing fund out of the feed", async () => {
    const { dir } = await runOffline({ TICKERS: "VOO", AUM: "10M:20M" });
    expect(jsonOf(dir, "index.json").funds).toEqual([]);
  });

  test("a one-ticker run over an existing feed keeps every row and every fund's files", async () => {
    const { dir } = await runOffline({ TICKERS: "VOO VTI" });
    const before = jsonOf(dir, "index.json");
    const vtiMeta = textOf(dir, "funds/VTI/meta.json");
    await runOffline({ TICKERS: "VOO" }, dir);
    const after = jsonOf(dir, "index.json");
    expect(after.funds.map((f: any) => f.ticker)).toEqual(["VOO", "VTI"]);
    expect(after.funds.find((f: any) => f.ticker === "VTI")).toEqual(before.funds.find((f: any) => f.ticker === "VTI"));
    expect(textOf(dir, "funds/VTI/meta.json")).toBe(vtiMeta);
  });

  test("a rerun with identical upstream data changes no byte and leaves the index (stamp included) untouched", async () => {
    const { dir } = await runOffline({ TICKERS: "VOO VTI" });
    backdate(dir);
    const first = filesOf(dir).map((f) => textOf(dir, f));
    await runOffline({ TICKERS: "VOO VTI" }, dir);
    expect(filesOf(dir).map((f) => textOf(dir, f))).toEqual(first);
    // write only on change: not even the per-fund meta and page files are rewritten (mtimes stay untouched)
    expect(touched(dir)).toEqual([]);
  });

  test("two runs on the same source data write zero changes even when Yahoo adjusted closes jitter across a cent boundary", async () => {
    // Yahoo float32 noise seen live: AAM SPDV 2024-11-12 came back as 31.544998 and 31.545001 a minute apart
    const { dir } = await runOffline({ TICKERS: "VOO" }, undefined, { adjclose: [100.005001, 110.004999, 115.005001, 121.004999] });
    backdate(dir);
    const first = filesOf(dir).map((f) => textOf(dir, f));
    await runOffline({ TICKERS: "VOO" }, dir, { adjclose: [100.004998, 110.005002, 115.004999, 121.005002] });
    expect(filesOf(dir).map((f) => textOf(dir, f))).toEqual(first);
    expect(touched(dir)).toEqual([]);
    // a real change beyond the noise is still written
    await runOffline({ TICKERS: "VOO" }, dir, { adjclose: [99.9, 110.1, 115.2, 121.3] });
    expect(jsonOf(dir, "funds/VOO/history/001.json").rows.map((row: any) => row["Adj Close"]).filter((v: unknown) => v !== null)).toEqual([99.9, 110.1, 115.2, 121.3]);
  });
});

describe("pipeline 2", () => {
  test("console output: TICKERS=all, one catalog line, fund lines, two done lines from the reporter", async () => {
    const lines: string[] = [];
    const { dir } = await runOffline({ TICKERS: "VOO VTI" }, undefined, { lines });
    const all = lines.flatMap((line) => line.split("\n"));
    expect(all.filter((line) => line.startsWith("[ catalog  ] "))).toHaveLength(1);
    expect(all.some((line) => line === "")).toBe(false);
    expect(all.at(-2)).toMatch(/^\[ done {5}\] 2 funds: 2 updated, 0 unchanged, 0 kept, 0 skipped, 0 failed in \d+\.\ds$/);
    expect(all.at(-1)).toBe("[ done     ] counts: 2 funds / 2 holdings rows / 10 history rows");
    lines.length = 0;
    await runOffline({ TICKERS: "VOO VTI" }, dir, { lines });
    expect(lines.at(-2)).toMatch(/ 2 funds: 0 updated, 2 unchanged, 0 kept, 0 skipped, 0 failed in /);
    lines.length = 0;
    await runOffline({ TICKERS: "VOO" }, dir, { lines, failYahoo: true }).catch(() => {});
    expect(lines.at(-2)).toMatch(/ 1 fund: 0 updated, 0 unchanged, 0 kept, 0 skipped, 1 failed in /);
    lines.length = 0;
    await runOffline({ TICKERS: "VOO", AUM: "10M:20M" }, dir, { lines });
    expect(lines.at(-2)).toMatch(/ 1 fund: 0 updated, 0 unchanged, 0 kept, 0 skipped, 0 failed, 1 filtered in /);
  });

  test("a failed required source keeps the whole fund as published, and a run where every fund failed exits with an error", async () => {
    const { dir } = await runOffline({ TICKERS: "VOO" });
    backdate(dir);
    await expect(runOffline({ TICKERS: "VOO" }, dir, { failYahoo: true })).rejects.toThrow("every selected fund failed");
    expect(touched(dir)).toEqual([]);
    expect(jsonOf(dir, "index.json").funds[0].ticker).toBe("VOO");
  });

  test("holdings that fail the guard keep the fund exactly as published and report it failed", async () => {
    const { dir } = await runOffline({ TICKERS: "VOO" });
    backdate(dir);
    const published = filesOf(dir).map((f) => [f, textOf(dir, f)]);
    // Vanguard renames marketValuePercentage in the IRR holdings: every Weight becomes "—"
    await expect(runOffline({ TICKERS: "VOO" }, dir, { holdingsWeightKey: "marketValuePct" })).rejects.toThrow("every selected fund failed");
    expect(touched(dir)).toEqual([]);
    expect(filesOf(dir).map((f) => [f, textOf(dir, f)])).toEqual(published);
  });

  test("a new fund that fails (holdings guard, no source answered, a write error) gets a catalog-only row and no files; that row is never read as published state", async () => {
    const { dir: clean } = await runOffline({ TICKERS: "VOO" });
    const published = jsonOf(clean, "index.json").funds[0];
    // the catalog-only row as written: the range-52w block adds its seven keys (all null without dataFile)
    const [catalogOnly] = await withRange52w(clean, [catalogOnlyRow(["VOO", published.name, published.category])]);
    expect([catalogOnly.dataFile, catalogOnly.holdings, Object.keys(catalogOnly.metrics), catalogOnly.metrics.returnsBasis]).toEqual([null, 0, Object.keys(published.metrics), "unavailable"]);
    const dirs: string[] = [];
    for (const opts of [{ holdingsWeightKey: "marketValuePct" }, { down: true }, {}]) {
      const dir = mkdtempSync(join(tmpdir(), "vanguard-feed-"));
      tempDirs.push(dir);
      dirs.push(dir);
      const blocked = !Object.keys(opts).length;
      if (blocked) { mkdirSync(join(dir, "funds")); writeFileSync(join(dir, "funds/VOO"), ""); } // the fund folder cannot be created
      const lines: string[] = [];
      await expect(runOffline({ TICKERS: "VOO" }, dir, { ...opts, lines })).rejects.toThrow("every selected fund failed");
      expect(lines[lines.length - 2]).toMatch(/ 1 fund: 0 updated, 0 unchanged, 0 kept, 0 skipped, 1 failed in /);
      expect(filesOf(dir)).toEqual(blocked ? ["funds/VOO", "index.json"] : ["index.json"]);
      expect(jsonOf(dir, "index.json").funds).toEqual([catalogOnly]);
    }
    // the next good run publishes the fund exactly like a first run on an empty feed
    await runOffline({ TICKERS: "VOO" }, dirs[0]);
    expect(jsonOf(dirs[0], "index.json").funds).toEqual([published]);
    expect(textOf(dirs[0], "funds/VOO/meta.json")).toBe(textOf(clean, "funds/VOO/meta.json"));
  });
});

describe("pipeline 3", () => {
  test("a closed fund is never fetched or reported failed: its files stay as published, its index row says closed (also off the built-in list), a rerun writes nothing", async () => {
    const entry = { ticker: "VTI", closed: "2026-10-01", source: "https://www.sec.gov/Archives/edgar/data/1/notice.htm" };
    const delisted = { ticker: "VZZZ", closed: "2026-09-01", source: "https://investor.vanguard.com/notice" };
    expect(() => closedFund([{ ...entry, closed: "soon" }], "VTI")).toThrow("CLOSED_FUNDS");
    expect(closedFund([entry], "vti")).toEqual(entry);
    const { dir } = await runOffline({ TICKERS: "VOO VTI" });
    // VZZZ stands for a closed fund the built-in list no longer names: its published row must not be pruned
    const index = jsonOf(dir, "index.json");
    index.funds.push({ ...index.funds[1], ticker: "VZZZ", dataFile: "./funds/VZZZ/meta.json" });
    writeFileSync(join(dir, "index.json"), JSON.stringify(index, null, 2) + "\n");
    backdate(dir);
    const first = filesOf(dir).map((path) => [path, textOf(dir, path)]);
    CLOSED_FUNDS.push(entry, delisted);
    try {
      const urls: string[] = [];
      const lines: string[] = [];
      await runOffline({ TICKERS: "VTI" }, dir, { urls, lines, holdingsWeightKey: "marketValuePct" }); // the guard would reject these holdings
      expect(urls.filter((url) => /vti/i.test(url))).toEqual([]);
      expect(lines[lines.length - 2]).toMatch(/ 0 failed in /);
      expect(touched(dir)).toEqual(["index.json"]);
      for (const [path, text] of first) if (path !== "index.json") expect([path, textOf(dir, path)]).toEqual([path, text]);
      const rows = jsonOf(dir, "index.json").funds;
      expect(rows.map((row: any) => row.ticker)).toEqual(["VOO", "VTI", "VZZZ"]);
      expect(rows[0]).toEqual(index.funds[0]);
      expect(rows[1]).toMatchObject({ status: "closed", closedDate: "2026-10-01", closedSource: entry.source, dataFile: "./funds/VTI/meta.json" });
      expect(rows[2]).toMatchObject({ status: "closed", closedDate: "2026-09-01", dataFile: "./funds/VZZZ/meta.json" });
      backdate(dir);
      await runOffline({ TICKERS: "VOO VTI" }, dir);
      expect(touched(dir)).toEqual([]);
    } finally {
      CLOSED_FUNDS.splice(0, CLOSED_FUNDS.length);
    }
  });

  test("N-PORT freshness: only a strictly newer filing with the same series replaces the published holdings", async () => {
    const { dir } = await runOffline({ TICKERS: "VOO" });
    const names = () => jsonOf(dir, "funds/VOO/holdings/001.json").rows.map((r: any) => r.Name);
    const asOf = () => jsonOf(dir, "funds/VOO/meta.json").holdings.asOfDate;
    expect(names()).toEqual(["A Corp"]);
    const nport = (opts: Parameters<typeof mockFeed>[0]) => runOffline({ TICKERS: "VOO", EDGAR_FALLBACK: "true" }, dir, { noHoldings: true, ...opts });
    await nport({ nportAsOf: "2026-03-31" });
    expect([names(), asOf()]).toEqual([["A Corp"], "2026-05-31"]);
    await nport({ nportAsOf: "2026-05-31" });
    expect([names(), asOf()]).toEqual([["A Corp"], "2026-05-31"]);
    await nport({ nportAsOf: "2026-06-30", nportSeries: "S000009999" });
    expect([names(), asOf()]).toEqual([["A Corp"], "2026-05-31"]);
    await nport({ nportAsOf: "2026-06-30" });
    expect([names(), asOf()]).toEqual([["Old Filing Co"], "2026-06-30"]);
    expect(nportIsFresh("2026-06-30", "", 0)).toBe(true);
    expect([nportIsFresh("2026-03-31", "2026-05-31", 1), nportIsFresh("2026-05-31", "05/31/2026", 1), nportIsFresh("", "2026-05-31", 1), nportIsFresh("2026-06-30", "", 1)]).toEqual([false, false, false, false]);
  });

  test("the soft deadline stops taking new funds but still writes the index", async () => {
    const { dir } = await runOffline({ TICKERS: "VOO VTI" }, undefined, { softDeadlineMs: -1 });
    expect(jsonOf(dir, "index.json").funds).toEqual([]);
  });

  test("MAX_FETCHES writes a cursor, a full pass removes it", async () => {
    const { dir } = await runOffline({ TICKERS: "VOO VTI BND", MAX_FETCHES: "2" });
    expect(filesOf(dir)).toContain("update-state.json");
    await runOffline({ TICKERS: "VOO VTI BND", MAX_FETCHES: "0" }, dir);
    expect(filesOf(dir)).not.toContain("update-state.json");
  });
});

describe("pipeline 4", () => {
  test("a HISTORY_RANGE run after a full run keeps the older history and distributions and writes nothing (Q25)", async () => {
    const { dir } = await runOffline({ TICKERS: "VOO" });
    backdate(dir);
    const first = filesOf(dir).map((f) => [f, textOf(dir, f)]);
    // Yahoo answers the 1y window with its last two days only; the older published rows and the dividend stay
    await runOffline({ TICKERS: "VOO", HISTORY_RANGE: "1y" }, dir, { chartDays: 2 });
    expect(filesOf(dir).map((f) => [f, textOf(dir, f)])).toEqual(first);
    expect(touched(dir)).toEqual([]);
    expect(jsonOf(dir, "funds/VOO/meta.json").history.totalRows).toBe(5);
    // a window that does not overlap the published history keeps the fund as published (the chart counts as failed)
    await expect(runOffline({ TICKERS: "VOO", HISTORY_RANGE: "1y" }, dir, { chartDays: 2, adjclose: [50, 60] })).rejects.toThrow("every selected fund failed");
    expect(touched(dir)).toEqual([]);
  });

  test("a relaxed guard still keeps numeric published weights from an all-dash sheet (Q24)", async () => {
    const { dir } = await runOffline({ TICKERS: "VOO" });
    backdate(dir);
    HOLDINGS_GUARD_RELAX.VOO = ["numeric", "sum"];
    try {
      await expect(runOffline({ TICKERS: "VOO" }, dir, { holdingsWeightKey: "marketValuePct" })).rejects.toThrow("every selected fund failed");
    } finally {
      delete HOLDINGS_GUARD_RELAX.VOO;
    }
    expect(touched(dir)).toEqual([]);
    expect(holdingsWeightCount(["Name", "Weight"], [{ Name: "A", Weight: "—" }, { Name: "B", Weight: "2%" }])).toBe(1);
  });

  test("TICKERS outside the built-in list and the published feed stops the run before any request or write (Q27)", async () => {
    const { dir } = await runOffline({ TICKERS: "VOO" });
    backdate(dir);
    const urls: string[] = [];
    await expect(runOffline({ TICKERS: "VOO NOPE" }, dir, { urls })).rejects.toThrow("TICKERS: NOPE not in the Vanguard catalog or published feed; nothing was fetched or written");
    expect([urls, touched(dir)]).toEqual([[], []]);
    // a catalog-only row of a ticker the list does not name (an old mistyped entry) is not "known" and is dropped
    const index = jsonOf(dir, "index.json");
    writeFileSync(join(dir, "index.json"), JSON.stringify({ ...index, funds: [...index.funds, catalogOnlyRow(["NOPE", "NOPE", "US Equity"])] }, null, 2) + "\n");
    await expect(runOffline({ TICKERS: "NOPE" }, dir)).rejects.toThrow("TICKERS: NOPE not in");
    await runOffline({ TICKERS: "VOO" }, dir);
    expect(jsonOf(dir, "index.json").funds.map((row: any) => row.ticker)).toEqual(["VOO"]);
  });

  test("NEW FUNDS announces a fund on its first successful publish, a failed new fund as not published yet (Q28)", async () => {
    const { dir } = await runOffline({ TICKERS: "VOO" });
    const index = jsonOf(dir, "index.json");
    writeFileSync(join(dir, "index.json"), JSON.stringify({ ...index, funds: [...index.funds, catalogOnlyRow(["VTI", "Vanguard Total Stock Market ETF", "US Equity"])] }, null, 2) + "\n");
    const summaryDir = mkdtempSync(join(tmpdir(), "vanguard-summary-"));
    tempDirs.push(summaryDir);
    process.env.GITHUB_STEP_SUMMARY = join(summaryDir, "summary.md");
    const news = (lines: string[]) => lines.flatMap((line) => line.split("\n")).filter((line) => line.startsWith("NEW FUNDS"));
    let lines: string[] = [];
    await runOffline({ TICKERS: "VOO VTI BND" }, dir, { lines, downTicker: "BND" });
    expect(news(lines)).toEqual(["NEW FUNDS: VTI", "NEW FUNDS (not published yet): BND"]);
    expect(readFileSync(join(summaryDir, "summary.md"), "utf8")).toContain("### NEW FUNDS\n\nNEW FUNDS: VTI\nNEW FUNDS (not published yet): BND\n");
    lines = [];
    await runOffline({ TICKERS: "VOO VTI BND" }, dir, { lines, downTicker: "BND" });
    expect(news(lines)).toEqual([]);
    lines = [];
    await runOffline({ TICKERS: "BND" }, dir, { lines });
    expect(news(lines)).toEqual(["NEW FUNDS: BND"]);
  });
});

// ===========================================================================
describe("network", () => {
  test("httpFetch applies a timeout signal and retries network errors and transient statuses up to MAX_RETRIES", async () => {
    globalThis.setTimeout = ((callback: () => void) => realSetTimeout(callback, 0)) as unknown as typeof setTimeout;
    const calls: any[] = [];
    globalThis.fetch = (async (_url: any, init: any) => {
      calls.push(init);
      if (calls.length === 1) throw new Error("socket hang up");
      if (calls.length === 2) return new Response("busy", { status: 503 });
      return new Response("ok");
    }) as typeof fetch;
    expect(await (await httpFetch("https://example.test/x", {}, 3)).text()).toBe("ok");
    expect(calls).toHaveLength(3);
    expect(calls.every((init) => init.signal instanceof AbortSignal)).toBe(true);
    expect(REQUEST_TIMEOUT_MS).toBe(45_000);
    calls.length = 0;
    globalThis.fetch = asFetch(async () => { calls.push(1); return new Response("nope", { status: 404 }); });
    expect((await httpFetch("https://example.test/y", {}, 3)).status).toBe(404);
    expect(calls).toHaveLength(1);
    calls.length = 0;
    globalThis.fetch = asFetch(async () => { calls.push(1); return new Response("busy", { status: 503 }); });
    expect((await httpFetch("https://example.test/z", {}, 2)).status).toBe(503);
    expect(calls).toHaveLength(3);
  });

  test("a request that stalls is aborted by the timeout signal and retried", async () => {
    globalThis.setTimeout = ((callback: () => void, ms?: number) => realSetTimeout(callback, ms && ms >= 500 ? 0 : ms)) as unknown as typeof setTimeout;
    AbortSignal.timeout = () => realAbortTimeout.call(AbortSignal, 30);
    let calls = 0;
    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      calls += 1;
      if (calls === 1) return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
      return Promise.resolve(new Response(new ReadableStream({ start(controller) { init?.signal?.addEventListener("abort", () => controller.error(init.signal!.reason)); } })));
    }) as unknown as typeof fetch;
    const response = await httpFetch("https://example.test/stall", {}, 2);
    expect(calls).toBe(2);
    await expect(response.text()).rejects.toBeDefined();
  });

  test("lanes: the slot is reserved synchronously, so concurrent callers never share a start time", async () => {
    configureLanes(2, 1);
    const waits: number[] = [];
    const clock = () => 1_000;
    const pause = async (ms: number) => { waits.push(ms); };
    await Promise.all(Array.from({ length: 5 }, () => paceRequest(clock, pause)));
    expect(waits.sort((a, b) => a - b)).toEqual([1000, 1000, 2000]);
  });

  test("CONCURRENCY really runs funds in parallel: peak 1 fund in flight at 1, N at N", async () => {
    const one = await runOffline({ TICKERS: "VOO VTI BND VT", CONCURRENCY: "1" }, undefined, { delayMs: 5 });
    const four = await runOffline({ TICKERS: "VOO VTI BND VT", CONCURRENCY: "4" }, undefined, { delayMs: 5 });
    expect([one.peak, four.peak]).toEqual([1, 4]);
  });

  test("HISTORY_RANGE bounds the Yahoo request as explicit period1/period2, max is an explicit daily window", async () => {
    const now = 1_790_000_000;
    const maxUrl = new URL(yahooChartUrl("VOO", "max", now));
    expect([maxUrl.searchParams.get("range"), maxUrl.searchParams.get("interval"), maxUrl.searchParams.get("period1"), maxUrl.searchParams.get("period2")]).toEqual([null, "1d", "0", String(now)]);
    const url = new URL(yahooChartUrl("VOO", "5y", now));
    expect([url.searchParams.get("range"), Number(url.searchParams.get("period1")), url.searchParams.get("includeAdjustedClose")]).toEqual([null, Math.floor(now - 5 * 365.25 * 86400), "true"]);
    expect([historyWindowStartEpoch("max", now), historyWindowStartEpoch("1y", now)]).toEqual([0, Math.floor(now - 365.25 * 86400)]);
    const urls: string[] = [];
    await runOffline({ TICKERS: "VOO", HISTORY_RANGE: "5y" }, undefined, { urls });
    const request = new URL(urls.find((u) => u.includes("finance.yahoo.com"))!);
    const [period1, period2] = [Number(request.searchParams.get("period1")), Number(request.searchParams.get("period2"))];
    expect(period1).toBeGreaterThan(0);
    expect(Math.round((period2 - period1) / 86_400 / 365.25)).toBe(5);
  });
});

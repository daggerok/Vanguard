/// <reference types="bun" />
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
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
  expect(parsed?.rows[0]["Weight (%)"]).toBe(22.5);
  expect(parsed?.rows[0]["Asset Class"]).toBe("Equity");
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
  expect(parsed.holdings[0]["Weight (%)"]).toBe("13.76");
  expect(parsed.holdings[0]["CUSIP"]).toBe("30231G102");
  expect(parsed.holdings[1]["Coupon"]).toBe("4.125");
  expect(parsed.holdings[1]["Maturity"]).toBe("2030-01-31");
});

test("toIsoDate normalizes SEC and Vanguard date formats", () => {
  expect(toIsoDate("2026-07-31")).toBe("2026-07-31");
  expect(toIsoDate("08/31/2026")).toBe("2026-08-31");
  expect(toIsoDate("")).toBe("");
});


import { test as frequencyLabelTest, expect as frequencyLabelExpect } from 'bun:test';
frequencyLabelTest('Frequency placeholders display None and existing cadence labels stay unchanged', async () => {
  const text = await Bun.file(new URL('../index.html', import.meta.url)).text();
  const start = /^([ \t]*)function (formatDividendFrequency|formatDistributionFrequency)\(/m.exec(text);
  frequencyLabelExpect(start).not.toBeNull();
  const tail = text.slice(start!.index);
  const end = new RegExp('^' + start![1] + '\u007d', 'm').exec(tail);
  frequencyLabelExpect(end).not.toBeNull();
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(tail.slice(0, end!.index + end![0].length));
  const format = new Function(js + '; return ' + start![2] + ';')();
  for (const value of [null, undefined, '', '  ', '-', '‐', '‑', '‒', '–', '—', ' — ']) {
    frequencyLabelExpect(format(value)).toBe('00 - None');
  }
  for (const [input, expected] of [
    ['None', '00 - None'], ['Unknown', '00 - Unknown'], ['Monthly', '01 - Monthly'],
    ['Quarterly', '04 - Quarterly'], ['Semi-annually', '06 - Semi-annually'],
    ['Annually', '12 - Annually'], ['Irregular', '99 - Irregular'],
  ]) frequencyLabelExpect(format(input)).toBe(expected);
});


import { test as headerTest, expect as headerExpect } from 'bun:test';
async function headerSummaryHarness() {
  const source = await Bun.file(new URL('../index.html', import.meta.url)).text();
  const match = /^([ \t]*)function renderHeaderSummary\(/m.exec(source);
  headerExpect(match).not.toBeNull();
  const tail = source.slice(match!.index);
  const end = new RegExp('^' + match![1] + '}', 'm').exec(tail)!;
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(tail.slice(0, end.index + end[0].length));
  const makeNode = (text = ''): any => {
    const node: any = { textContent: text, childNodes: [], dataset: {}, listeners: {} };
    node.replaceChildren = (...children: any[]) => { node.childNodes = children; };
    node.append = (...children: any[]) => { node.childNodes.push(...children); };
    node.addEventListener = (name: string, listener: any) => { node.listeners[name] = listener; };
    return node;
  };
  const panel = makeNode(), subtitle = makeNode(), details = makeNode('Data: source link and updated timestamp');
  subtitle.append(details);
  const document = { getElementById: () => panel, createTextNode: makeNode, createElement: () => makeNode() };
  const render = new Function('document', js + '; return renderHeaderSummary;')(document);
  const text = () => subtitle.childNodes.map((n: any) => n.textContent).join('');
  return { render, panel, subtitle, details, makeNode, text };
}
headerTest('header has no visible subtitle without selection; original details nodes are retained', async () => {
  const h = await headerSummaryHarness();
  h.render(h.subtitle, new Set(), null, () => {});
  headerExpect(h.text()).toBe('');
  headerExpect(h.panel.childNodes).toEqual([h.details]);
  headerExpect(h.panel.childNodes[0]).toBe(h.details);
});
headerTest('header shows sorted selected tickers only, preserving click activation and highlight', async () => {
  const h = await headerSummaryHarness(); const activated: string[] = [];
  h.render(h.subtitle, new Set(['ZZZ', 'AAA']), 'AAA', (ticker: string) => activated.push(ticker));
  headerExpect(h.text()).toBe('2 selected: AAA, ZZZ');
  const links = h.subtitle.childNodes.filter((n: any) => n.dataset.headerFund);
  headerExpect(links[0].className).toContain('underline');
  links[1].listeners.click({ preventDefault() {} });
  headerExpect(activated).toEqual(['ZZZ']);
  headerExpect(h.panel.childNodes[0]).toBe(h.details);
});
headerTest('all selected still lists tickers; clear replaces both summary and selection', async () => {
  const h = await headerSummaryHarness();
  h.render(h.subtitle, new Set(['CCC','AAA','BBB']), 'BBB', () => {});
  headerExpect(h.text()).toBe('3 selected: AAA, BBB, CCC');
  const next = h.makeNode('Fresh detail context'); h.subtitle.replaceChildren(next);
  h.render(h.subtitle, new Set(), null, () => {});
  headerExpect(h.text()).toBe(''); headerExpect(h.panel.childNodes).toEqual([next]);
});
headerTest('header markup supplies a focusable counter and hidden rich panel with dismissal', async () => {
  const html = await Bun.file(new URL('../index.html', import.meta.url)).text();
  headerExpect(html).toMatch(/<button[^>]*aria-controls="app-summary"[^>]*id="ticker-count"/);
  headerExpect(html).toContain('id="app-summary" role="region" aria-label="ETF catalog information" hidden');
  headerExpect(html).toContain("event.key !== 'Escape'");
  headerExpect(html).toContain("trigger.addEventListener('focus', show)");
  headerExpect(html).toContain("trigger.addEventListener('pointerenter'");
});

// ---------------------------------------------------------------------------
// Controls, resolver, config/README/workflow parity
// ---------------------------------------------------------------------------

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
  const c = readConfig(resolveControls(file(), { MAX_FETCHES: 3, AUM: "mid", TER: ":0.2", MAX_RETRIES: 9, TICKERS: "voo, vti;bnd", CATEGORY: "bond", HISTORY_RANGE: "5Y", SKIP_YAHOO: "yes", EDGAR_FALLBACK: "off", TOTAL_RETURN_3Y: "10:" }));
  expect(c.maxFetches).toBe(3);
  expect(c.aumRange).toMatchObject({ min: 2e9, max: 1e10 });
  expect(c.terRange).toMatchObject({ min: Number.NEGATIVE_INFINITY, max: 0.2 });
  expect(c.maxRetries).toBe(5);
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
  expect(yahooChartUrl("VOO")).toBe("https://query1.finance.yahoo.com/v8/finance/chart/VOO?range=max&interval=1d&events=div%2Csplits");
  expect(yahooChartUrl("VOO", "max", now)).toContain("range=max");
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

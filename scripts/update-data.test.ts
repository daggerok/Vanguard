import { expect, test } from "bun:test";
import {
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

/**
 * Acceptance tests for the Vanguard ETF UI contract (index.html).
 *
 * These boot the real inline application script from index.html inside a
 * headless harness (scripts/ui-harness.ts) that serves the actual generated
 * feed from api/vanguard/. Expected values are computed independently from
 * the feed (oracle helpers in the harness) — nothing is hardcoded from
 * other providers.
 */
import { expect, test } from "bun:test";
import {
  AppHandle,
  MemoryStorage,
  catalogTickers,
  createApp,
  expectedWatchlist,
  feedJson,
  sleep,
} from "./ui-harness";

const SORTS_KEY = "vanguard-tab-sorts";
const FILTERS_KEY = "vanguard-tab-filters";
const SELECTED_KEY = "vanguard-selected-etfs";
const ACTIVE_FUND_KEY = "vanguard-active-fund";

async function until(cond: () => boolean, timeoutMs = 30000, stepMs = 20) {
  // flush pending microtasks/render passes before the first check
  await sleep(stepMs);
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for condition");
    await sleep(stepMs);
  }
}

async function bootFresh(storage?: MemoryStorage): Promise<AppHandle> {
  const app = await createApp({ storage });
  await app.boot();
  await until(() => app.run<boolean>("!!staticCatalogSheet && staticCatalogSheet.data.length > 0"));
  return app;
}

// --- DOM helpers -------------------------------------------------------------

function sortButton(app: AppHandle, header: string) {
  const button = app
    .el("table-head")
    .querySelectorAll("button[data-sort]")
    .find((el) => el.dataset.sort === header);
  if (!button) throw new Error(`sort header not found: ${header}`);
  return button;
}

function clickSort(app: AppHandle, header: string) {
  sortButton(app, header).click();
}

function catalogRow(app: AppHandle, ticker: string) {
  const row = app.el("table-body").querySelector(`tr[data-static-ticker="${ticker}"]`);
  if (!row) throw new Error(`catalog row not found: ${ticker}`);
  return row;
}

function toggleRow(app: AppHandle, ticker: string) {
  catalogRow(app, ticker).click();
}

function headerCheckbox(app: AppHandle) {
  const cb = app.el("table-head").querySelector("#select-all-checkbox");
  if (!cb) throw new Error("header select-all checkbox not found");
  return cb;
}

function pillCheckbox(app: AppHandle) {
  const cb = app.el("tabs-bar").querySelector("#select-all-toggle");
  if (!cb) throw new Error("All ETFs pill checkbox not found");
  return cb;
}

function setChecked(el: { checked: boolean; dispatch: (t: string, i?: object) => void }, checked: boolean) {
  el.checked = checked;
  el.dispatch("change", { target: el });
}

function setSearch(app: AppHandle, query: string) {
  const input = app.el("search-input");
  input.value = query;
  input.dispatch("input", { target: input });
}

async function waitForSheet(app: AppHandle, sheetName: string) {
  await until(() => app.run("activeSheetName") === sheetName, 10000);
  // let the async switchSheet (dbSet + render) microtasks fully settle
  await sleep(60);
}

async function clickTab(app: AppHandle, tabId: string) {
  const button = app.el("selected-tabs-bar").querySelector(`button[data-tab="${tabId}"]`);
  if (!button) throw new Error(`tab button not found: ${tabId}`);
  button.click();
  await waitForSheet(app, tabId);
}

function selectedTickers(app: AppHandle): string[] {
  return app.run<string[]>("[...selectedETFs]").sort();
}

function watchlistTabLabel(app: AppHandle): string {
  const match = /Watchlist\s*\(([^)]*)\)/.exec(app.el("selected-tabs-bar").innerHTML);
  return match ? match[1] : "";
}

async function waitWatchlistCount(app: AppHandle, expected: number, timeoutMs = 60000) {
  await until(() => app.run<number>("getDedupedWatchlistRows().length") === expected, timeoutMs);
}

/** True once every selected ETF's holdings finished loading (both app generations). */
async function waitForHoldingsSettled(app: AppHandle, timeoutMs = 300000) {
  await until(
    () =>
      app.run<boolean>(
        "(typeof isHoldingsLoading === 'function' ? !isHoldingsLoading() : !isHoldingsLoading)",
      ),
    timeoutMs,
  );
}

// =============================================================================
// 1. Sort persistence round-trip
// =============================================================================

test("1. per-tab sort survives tabs, checkboxes, buttons, Clear, and reload", async () => {
  const app = await bootFresh();

  // explicit non-default catalog sort
  clickSort(app, "TR 1Y"); // numeric column -> starts descending
  expect(app.run("sortKey")).toBe("TR 1Y");
  expect(app.run("sortDir")).toBe("desc");
  expect(app.el("table-head").innerHTML).toContain("TR 1Y ↓");
  expect(JSON.parse(app.storage.getItem(SORTS_KEY)!)).toEqual({
    "ETF Catalog": { key: "TR 1Y", dir: "desc" },
  });

  // select a fund and round-trip through the Watchlist tab
  toggleRow(app, "VOO");
  await until(() => app.el("selected-tabs-bar").innerHTML.includes("Watchlist"));
  await clickTab(app, "Watchlist");
  expect(app.run("activeSheetName")).toBe("Watchlist");

  // Watchlist gets its own sort, catalog memory must stay untouched
  clickSort(app, "# ETFs");
  expect(app.run("sortKey")).toBe("# ETFs");

  // All ETFs *button* returns to the catalog with the remembered sort
  app.el("tabs-bar").querySelector("#all-etfs-tab-btn")!.click();
  await waitForSheet(app, "ETF Catalog");
  expect(app.run("sortKey")).toBe("TR 1Y");
  expect(app.run("sortDir")).toBe("desc");
  expect(app.el("table-head").innerHTML).toContain("TR 1Y ↓");

  // header Use checkbox + All ETFs pill checkbox must not reset sorting
  setChecked(headerCheckbox(app), true);
  setChecked(pillCheckbox(app), true);
  setChecked(pillCheckbox(app), false);
  setChecked(headerCheckbox(app), false);
  expect(app.run("sortKey")).toBe("TR 1Y");

  // search, Copy Tickers, exports, theme toggle must not reset sorting
  setSearch(app, "bond");
  setSearch(app, "");
  app.el("copy-btn").click();
  app.el("theme-toggle").click();
  expect(app.run("sortKey")).toBe("TR 1Y");

  // Clear removes selection and search only — never the remembered sort
  app.el("reset-btn").click();
  expect(app.run<string[]>("[...selectedETFs]")).toEqual([]);
  expect(app.el("search-input").value).toBe("");
  expect(app.run("sortKey")).toBe("TR 1Y");
  expect(app.run("sortDir")).toBe("desc");
  expect(app.el("table-head").innerHTML).toContain("TR 1Y ↓");
  expect(JSON.parse(app.storage.getItem(SORTS_KEY)!)).toEqual({
    "ETF Catalog": { key: "TR 1Y", dir: "desc" },
    Watchlist: { key: "# ETFs", dir: "desc" },
  });

  // full reload restores both per-tab sorts
  const reloaded = await bootFresh(app.storage);
  expect(reloaded.run("sortKey")).toBe("TR 1Y");
  expect(reloaded.run("sortDir")).toBe("desc");
  expect(reloaded.el("table-head").innerHTML).toContain("TR 1Y ↓");
}, 60000);

test("1b. Watchlist remembers its own sort separately from the catalog", async () => {
  const app = await bootFresh();
  toggleRow(app, "VOO");
  await until(() => app.el("selected-tabs-bar").innerHTML.includes("Watchlist"));
  await clickTab(app, "Watchlist");
  clickSort(app, "Ticker"); // overrides the Weight Sum (%) default
  clickSort(app, "Ticker"); // asc -> desc
  expect(app.run("sortKey")).toBe("Ticker");
  expect(app.run("sortDir")).toBe("desc");

  app.el("tabs-bar").querySelector("#all-etfs-tab-btn")!.click();
  await waitForSheet(app, "ETF Catalog");
  expect(app.run("sortKey")).toBe(""); // catalog was never explicitly sorted

  await clickTab(app, "Watchlist");
  expect(app.run("sortKey")).toBe("Ticker");
  expect(app.run("sortDir")).toBe("desc");
}, 60000);

// =============================================================================
// 2+3. Header select-all is scoped to the visible (filtered) rows
// =============================================================================

test("2. header Use check selects exactly the filtered ETFs", async () => {
  const app = await bootFresh();
  setSearch(app, "S&P 500"); // matches VOO, VOOG, VOOV only
  const visible = app
    .run<Array<{ Ticker: string }>>("getFilteredRows(staticCatalogSheet)")
    .map((row) => row.Ticker)
    .sort();
  expect(visible.length).toBeGreaterThanOrEqual(2);
  expect(visible.length).toBeLessThanOrEqual(4);

  setChecked(headerCheckbox(app), true);
  expect(selectedTickers(app)).toEqual(visible);
}, 60000);

test("3. header Use uncheck removes only visible tickers; hidden selections survive", async () => {
  const app = await bootFresh();

  // a selection that will be hidden by the filter
  toggleRow(app, "BND");

  setSearch(app, "S&P 500");
  const visible = app
    .run<Array<{ Ticker: string }>>("getFilteredRows(staticCatalogSheet)")
    .map((row) => row.Ticker)
    .sort();
  expect(visible).not.toContain("BND");

  setChecked(headerCheckbox(app), true);
  expect(selectedTickers(app)).toEqual([...visible, "BND"].sort());
  // checked state: every visible row selected -> header box is checked
  expect(headerCheckbox(app).checked).toBe(true);

  setChecked(headerCheckbox(app), false);
  expect(selectedTickers(app)).toEqual(["BND"]); // hidden selection survives
  expect(app.el("table-head").innerHTML.includes("Net Assets")).toBe(true);
}, 60000);

// =============================================================================
// 4. All ETFs pill checkbox: whole catalog, filter/tab independent, no nav
// =============================================================================

test("4. All ETFs pill selects the whole non-blacklisted catalog without navigating", async () => {
  const app = await bootFresh();
  const all = catalogTickers();
  app.run("blacklistTickers(['BIV'])");
  await until(() => app.run<string[]>("[...blacklistedETFs]").length === 1);

  // from the Watchlist tab, with a filter active
  toggleRow(app, "VOO");
  await until(() => app.el("selected-tabs-bar").innerHTML.includes("Watchlist"));
  setSearch(app, "bond");
  await clickTab(app, "Watchlist");
  setChecked(pillCheckbox(app), true);

  expect(app.run("activeSheetName")).toBe("Watchlist"); // no navigation
  const selected = selectedTickers(app);
  expect(selected).not.toContain("BIV");
  expect(selected.length).toBe(all.length - 1);
  expect(selected).toEqual(all.filter((t) => t !== "BIV").sort());

  // checked state reflects the whole catalog, not the filtered view
  expect(pillCheckbox(app).checked).toBe(true);

  // unchecking clears the catalog selection and still does not navigate
  setChecked(pillCheckbox(app), false);
  expect(app.run("activeSheetName")).toBe("Watchlist");
  expect(selectedTickers(app)).toEqual([]);

  // the pill also works from a fund detail tab
  app.el("tabs-bar").querySelector("#all-etfs-tab-btn")!.click();
  await waitForSheet(app, "ETF Catalog");
  setSearch(app, "");
  toggleRow(app, "VTI");
  await until(() => app.el("selected-tabs-bar").innerHTML.includes("VTI Holdings"));
  await clickTab(app, "Holdings");
  await waitForSheet(app, "Holdings");
  setChecked(pillCheckbox(app), true);
  expect(app.run("activeSheetName")).toBe("Holdings"); // still no navigation
  expect(selectedTickers(app).length).toBe(all.length - 1);
}, 120000);

// =============================================================================
// 5. Watchlist reacts to selection: Loading… then exact count
// =============================================================================

test("5. selecting one ETF shows Watchlist Loading then the exact count", async () => {
  const app = await bootFresh();
  // slow the selected fund down so the loading state is observable
  app.stats.latency = (url) => (url.includes("/VOO/") ? 60 : 0);

  toggleRow(app, "VOO");

  // immediately: no misleading exact "Watchlist (0)"
  await sleep(10);
  const labelDuringLoad = watchlistTabLabel(app);
  expect(labelDuringLoad).not.toBe("0");

  const expected = expectedWatchlist(["VOO"]).size;
  await until(() => watchlistTabLabel(app) === String(expected), 60000);
  expect(app.run<number>("getDedupedWatchlistRows().length")).toBe(expected);
}, 120000);

// =============================================================================
// 6. Race-free holdings loading for overlapping rapid selections
// =============================================================================

test("6. rapid overlapping selections load without duplicate or skipped pages", async () => {
  const app = await bootFresh();
  app.stats.latency = (url) => (url.includes("/VOO/") || url.includes("/VTI/") ? 40 : 0);

  toggleRow(app, "VOO");
  toggleRow(app, "VTI"); // second selection while the first is still in flight

  const oracle = expectedWatchlist(["VOO", "VTI"]);
  await waitWatchlistCount(app, oracle.size, 90000);

  // every holdings page fetched exactly once — no duplicates, no gaps
  const vooPages: string[] = feedJson("funds/VOO/meta.json").holdings.pages;
  const vtiPages: string[] = feedJson("funds/VTI/meta.json").holdings.pages;
  for (const page of [...vooPages.map((p) => `./api/vanguard/funds/VOO/${p}`), ...vtiPages.map((p) => `./api/vanguard/funds/VTI/${p}`)]) {
    expect(app.stats.counts.get(page) ?? 0).toBe(1);
  }
  // meta.json requests are deduplicated per ticker while in flight
  expect(app.stats.counts.get("./api/vanguard/funds/VOO/meta.json") ?? 0).toBe(1);
  expect(app.stats.counts.get("./api/vanguard/funds/VTI/meta.json") ?? 0).toBe(1);

  // an overlapping security reports both funds and correct weight aggregates
  const overlap = [...oracle.values()].find((row) => row.funds.size === 2 && row.hasWeight);
  expect(overlap).toBeDefined();
  const appRow = app
    .run<Array<Record<string, unknown>>>("getDedupedWatchlistRows()")
    .find((row) => row.Ticker === overlap!.shown);
  expect(appRow).toBeDefined();
  expect(appRow!["# ETFs"]).toBe(2);
  expect(Number(String(appRow!["Weight Sum (%)"]).replace("%", ""))).toBeCloseTo(overlap!.weightSum, 1);
  expect(Number(String(appRow!["Max Weight (%)"]).replace("%", ""))).toBeCloseTo(overlap!.maxWeight, 1);
}, 180000);

// =============================================================================
// 7. Deselection updates everything immediately
// =============================================================================

test("7. deselecting an ETF updates subtitle, tabs and Watchlist immediately", async () => {
  const app = await bootFresh();
  toggleRow(app, "VOO");
  toggleRow(app, "VTI");
  const both = expectedWatchlist(["VOO", "VTI"]).size;
  await waitWatchlistCount(app, both, 90000);
  expect(watchlistTabLabel(app)).toBe(String(both));

  toggleRow(app, "VTI"); // deselect — everything below must be synchronous

  const onlyVoo = expectedWatchlist(["VOO"]).size;
  expect(app.run<number>("getDedupedWatchlistRows().length")).toBe(onlyVoo);
  expect(watchlistTabLabel(app)).toBe(String(onlyVoo));
  expect(app.el("app-subtitle").innerHTML).toContain("1 selected");
  expect(app.el("app-subtitle").innerHTML).not.toContain(">VTI</a>");
  expect(app.el("selected-tabs-bar").innerHTML).not.toContain("VTI Holdings");
  expect(app.el("selected-tabs-bar").innerHTML).toContain("VOO Holdings");
  expect(app.run("activeFundTicker")).toBe("VOO");
}, 180000);

// =============================================================================
// 8. Select-all loads the complete catalog aggregate; DOM stays bounded
// =============================================================================

test("8. selecting all ETFs aggregates the whole feed and keeps the DOM bounded", async () => {
  const app = await bootFresh();
  const all = catalogTickers();
  setChecked(pillCheckbox(app), true);
  expect(selectedTickers(app).length).toBe(all.length);

  const oracle = expectedWatchlist(all);
  await waitForHoldingsSettled(app, 600000);
  expect(app.run<number>("getDedupedWatchlistRows().length")).toBe(oracle.size);
  expect(watchlistTabLabel(app)).toBe(String(oracle.size));

  // rendered watchlist DOM must stay bounded (chunked), never all rows at once
  await clickTab(app, "Watchlist");
  await until(() => app.run("activeSheetName") === "Watchlist");
  const renderedRows = (app.el("table-body").innerHTML.match(/<tr\b/g) ?? []).length;
  expect(renderedRows).toBeGreaterThan(0);
  expect(renderedRows).toBeLessThanOrEqual(400);
  expect(oracle.size).toBeGreaterThan(1000);

  // scrolling grows the rendered chunk but never the full set at once
  const scroll = app.el("table-scroll");
  scroll.scrollTop = scroll.scrollHeight - scroll.clientHeight - 100;
  scroll.dispatch("scroll", { target: scroll });
  const grownRows = (app.el("table-body").innerHTML.match(/<tr\b/g) ?? []).length;
  expect(grownRows).toBeGreaterThan(renderedRows);
  expect(grownRows).toBeLessThanOrEqual(800);

  // copy/export still operate on the complete filtered result
  const copyCount = app.run<number>(
    "getDedupedWatchlistRows().filter((r) => r._searchIndex.includes('')).length",
  );
  expect(copyCount).toBe(oracle.size);
}, 600000);

// =============================================================================
// 9. Reload restores selection, active fund, and background loading
// =============================================================================

test("9. reload restores selection, active fund and rebuilds the Watchlist", async () => {
  const app = await bootFresh();
  toggleRow(app, "VOO");
  toggleRow(app, "VTI");
  const both = expectedWatchlist(["VOO", "VTI"]).size;
  await waitWatchlistCount(app, both, 90000);
  expect(app.run("activeFundTicker")).toBe("VTI");

  const reloaded = await bootFresh(app.storage);
  expect(selectedTickers(reloaded)).toEqual(["VOO", "VTI"]);
  expect(reloaded.run("activeFundTicker")).toBe("VTI");

  // background loading completes without any checkbox interaction
  await waitWatchlistCount(reloaded, both, 90000);
  expect(watchlistTabLabel(reloaded)).toBe(String(both));
  // active fund sheets were restored in the background
  await until(() => reloaded.run("staticTicker") === "VTI", 30000);
  expect(reloaded.el("selected-tabs-bar").innerHTML).toContain("VTI Holdings");
}, 300000);

// =============================================================================
// 10. Detail sheets render real rows and page onward
// =============================================================================

test("10. Holdings, Historical, Performance and Distributions render real rows", async () => {
  const app = await bootFresh();
  toggleRow(app, "VTI");
  await until(() => app.el("selected-tabs-bar").innerHTML.includes("VTI Holdings"));

  await clickTab(app, "Holdings");
  await waitForSheet(app, "Holdings");
  const firstPageRow = feedJson("funds/VTI/holdings/001.json").rows[0];
  await until(() => app.el("table-body").innerHTML.includes(String(firstPageRow.Ticker)));
  expect(app.run<number>("staticNextPageBySheet.Holdings")).toBe(1);

  // infinite scroll loads the next page without duplicating requests
  const scroll = app.el("table-scroll");
  scroll.scrollHeight = 20000;
  scroll.scrollTop = 20000 - scroll.clientHeight - 100;
  scroll.dispatch("scroll", { target: scroll });
  await until(() => app.run<number>("staticNextPageBySheet.Holdings") === 2, 30000);
  expect(app.stats.counts.get("./api/vanguard/funds/VTI/holdings/002.json") ?? 0).toBe(1);
  const secondPageRow = feedJson("funds/VTI/holdings/002.json").rows[0];
  await until(() => app.el("table-body").innerHTML.includes(String(secondPageRow.Ticker)));

  await clickTab(app, "Historical");
  await until(() => app.run("activeSheetName") === "Historical");
  await until(() => app.el("table-body").innerHTML.includes("<tr"));
  const historyRow = feedJson("funds/VTI/history/001.json").rows[0];
  expect(app.el("table-body").innerHTML).toContain(historyRow.Date);

  await clickTab(app, "Performance");
  await until(() => app.run("activeSheetName") === "Performance");
  await until(() => app.el("table-body").innerHTML.includes("YTD Return") || app.el("table-body").innerHTML.includes("TR 1Y"));

  await clickTab(app, "Distributions");
  await until(() => app.run("activeSheetName") === "Distributions");
  const distributions = feedJson("funds/VTI/meta.json").distributions;
  const latestExDate = distributions.rows[0][1];
  await until(() => app.el("table-body").innerHTML.includes(latestExDate));
  expect(app.el("table-head").innerHTML).toContain("Ex-Date");
  expect(app.el("table-body").innerHTML).toContain(latestExDate);
}, 120000);

// =============================================================================
// 11. Missing/failing fund data produces an explanatory state
// =============================================================================

test("11. a fund whose files fail to load shows an explanatory empty state", async () => {
  const app = await bootFresh();
  toggleRow(app, "VOO");
  await until(() => app.el("selected-tabs-bar").innerHTML.includes("VOO Holdings"));
  await clickTab(app, "Holdings");
  await until(() => app.el("table-body").innerHTML.length > 100);
  expect(app.el("table-body").innerHTML).not.toContain("not available");

  // back to the catalog so rows can be toggled again
  app.el("tabs-bar").querySelector("#all-etfs-tab-btn")!.click();
  await waitForSheet(app, "ETF Catalog");

  // now the selected fund's files "disappear" — the previous table must go
  const priorTicker = String(feedJson("funds/VOO/holdings/001.json").rows[0].Ticker);
  app.stats.blocked.add("funds/VXUS/");
  toggleRow(app, "VXUS"); // becomes the active fund; its files fail to load
  toggleRow(app, "VOO"); // deselect VOO so VXUS is the only remaining fund
  await until(() => app.run("activeFundTicker") === "VXUS");
  await clickTab(app, "Holdings"); // must show the failure state, not VOO's table
  await until(() => app.el("table-body").innerHTML.toLowerCase().includes("could not load"), 10000);
  const body = app.el("table-body").innerHTML;
  expect(body).not.toContain(priorTicker); // prior fund's table is gone
  expect(body.toLowerCase()).toContain("could not load");
}, 120000);

// =============================================================================
// 12. Identifier fallbacks: bonds, cash, numeric tickers, zero weights kept
// =============================================================================

test("12. bond rows fall back to identifiers; cash and zero-weight rows are kept", async () => {
  const app = await bootFresh();
  // BND: bond rows without exchange tickers, USD cash rows, zero-weight
  // positions. VXUS: many identifier-only international bond rows.
  toggleRow(app, "BND");
  toggleRow(app, "VXUS");
  const oracle = expectedWatchlist(["BND", "VXUS"]);
  await waitForHoldingsSettled(app, 240000);
  expect(app.run<number>("getDedupedWatchlistRows().length")).toBe(oracle.size);
  expect(watchlistTabLabel(app)).toBe(String(oracle.size));

  const rows = app.run<Array<Record<string, unknown>>>("getDedupedWatchlistRows()");
  const tickers = new Set(rows.map((r) => String(r.Ticker)));

  // bond rows whose Ticker is "—" must appear under their CUSIP/ISIN
  const bondByIdentifier = [...oracle.values()].filter((r) => r.key.startsWith("C:") || r.key.startsWith("I:"));
  expect(bondByIdentifier.length).toBeGreaterThan(100);
  for (const sample of bondByIdentifier.slice(0, 25)) {
    expect(tickers.has(sample.shown)).toBe(true);
  }

  // cash positions are kept, not aggressively dropped
  expect(oracle.has("T:USD")).toBe(true);
  expect(tickers.has("USD")).toBe(true);

  // zero-weight rows with otherwise valid data are kept
  const zeroWeight = [...oracle.values()].find((r) => r.hasWeight && r.weightSum === 0);
  expect(zeroWeight).toBeDefined();
  expect(tickers.has(zeroWeight!.shown)).toBe(true);
}, 300000);

test("12b. numeric local tickers are used as keys, not dropped", async () => {
  const app = await bootFresh();
  toggleRow(app, "VPL");
  const oracle = expectedWatchlist(["VPL"]);
  await waitForHoldingsSettled(app, 240000);
  expect(app.run<number>("getDedupedWatchlistRows().length")).toBe(oracle.size);
  const rows = app.run<Array<Record<string, unknown>>>("getDedupedWatchlistRows()");
  const tickers = new Set(rows.map((r) => String(r.Ticker)));
  // SK hynix trades locally as 000660 — the numeric ticker must be the key
  expect(oracle.has("T:000660")).toBe(true);
  expect(tickers.has("000660")).toBe(true);
  expect(rows.find((r) => String(r.Ticker) === "000660")!["# ETFs"]).toBe(1);
}, 300000);

// =============================================================================
// 13. Sticky columns
// =============================================================================

test("13. sticky classes are on catalog Use/Ticker and Watchlist Ticker cells", async () => {
  const app = await bootFresh();
  toggleRow(app, "VOO");
  await until(() => app.el("selected-tabs-bar").innerHTML.includes("Watchlist"));

  const head = app.el("table-head").innerHTML;
  expect(head).toContain("catalog-sticky-col catalog-sticky-use");
  expect(head).toContain("catalog-sticky-col catalog-sticky-ticker");
  const body = app.el("table-body").innerHTML;
  expect(body).toContain("catalog-sticky-col catalog-sticky-use");
  expect(body).toContain("catalog-sticky-col catalog-sticky-ticker");

  await clickTab(app, "Watchlist");
  await until(() => app.run("activeSheetName") === "Watchlist");
  const wHead = app.el("table-head").innerHTML;
  const wBody = app.el("table-body").innerHTML;
  expect(wHead).toContain("watchlist-sticky-col watchlist-sticky-ticker");
  expect(wBody).toContain("watchlist-sticky-col watchlist-sticky-ticker");
}, 120000);

// =============================================================================
// 14. Malformed localStorage cannot crash boot
// =============================================================================

test("15. index.json / meta.json / page manifests stay consistent", () => {
  const index = feedJson("index.json");
  expect(Array.isArray(index.funds)).toBe(true);
  expect(index.funds.length).toBeGreaterThan(0);
  for (const fund of index.funds) {
    const meta = feedJson(`funds/${fund.ticker}/meta.json`);
    for (const kind of ["holdings", "history"] as const) {
      const manifest = meta[kind] ?? {};
      const pages: string[] = manifest.pages ?? [];
      expect(manifest.totalRows ?? 0).toBe(fund[kind] ?? 0);
      let rows = 0;
      for (const page of pages) {
        const payload = feedJson(`funds/${fund.ticker}/${page.replace(/^\.\/+/, "")}`);
        expect(Array.isArray(payload.headers)).toBe(true);
        expect(Array.isArray(payload.rows)).toBe(true);
        rows += payload.rows.length;
      }
      expect(rows).toBe(manifest.totalRows ?? 0);
    }
  }
}, 120000);

test("14. malformed localStorage is sanitized and boot still succeeds", async () => {
  const storage = new MemoryStorage();
  storage.setItem(SORTS_KEY, "{this is not json");
  storage.setItem(FILTERS_KEY, "{this is not json");
  storage.setItem("vanguard-site-state", '{"sortKey": 42, "sheetSort": "oops"}');
  storage.setItem(SELECTED_KEY, "{broken");
  storage.setItem("vanguard-blacklisted-etfs", "not-an-array");
  storage.setItem(ACTIVE_FUND_KEY, "  ###not a ticker### ");

  const app = await bootFresh(storage);
  expect(app.run<number>("staticCatalogSheet.data.length")).toBeGreaterThan(100);
  expect(app.run<string[]>("[...selectedETFs]")).toEqual([]);
  expect(app.run("Object.keys(sheetSort).length")).toBe(0);
  expect(app.run("Object.keys(sheetFilter).length")).toBe(0);
  expect(app.run("sortKey")).toBe("");

  // structurally valid but semantically invalid sort entries are dropped too
  storage.setItem(SORTS_KEY, JSON.stringify({
    "ETF Catalog": { key: "", dir: "asc" },
    Watchlist: { key: "Ticker", dir: "sideways" },
    Holdings: { key: "Ticker", dir: "desc" },
  }));
  storage.setItem(FILTERS_KEY, JSON.stringify({
    "ETF Catalog": 123,
    Watchlist: "",
    Holdings: "valid-query",
  }));
  const second = await bootFresh(storage);
  expect(second.run("Object.keys(sheetSort).length")).toBe(1); // only Holdings survives
  expect(second.run("sheetSort.Holdings")).toEqual({ key: "Ticker", dir: "desc" });
  expect(second.run("Object.keys(sheetFilter).length")).toBe(1); // only Holdings survives
  expect(second.run("sheetFilter.Holdings")).toBe("valid-query");
}, 120000);

// =============================================================================
// 16. Per-tab filter persistence across views
// =============================================================================

test("16. per-tab filter persistence: each tab keeps its own search query independently", async () => {
  const app = await bootFresh();

  // 1. On "ETF Catalog", search for "vg" (matches 9 ETFs, reproduces image-1)
  setSearch(app, "vg");
  const visibleFunds = app
    .run<Array<{ Ticker: string }>>("getFilteredRows(staticCatalogSheet)")
    .map((r) => r.Ticker)
    .sort();
  expect(visibleFunds.length).toBe(9);
  expect(app.el("ticker-count").textContent).toContain("9 ETFs");
  expect(JSON.parse(app.storage.getItem(FILTERS_KEY)!)).toEqual({
    "ETF Catalog": "vg",
  });

  // Select VGHY so detail tabs and Watchlist appear
  toggleRow(app, "VGHY");
  await until(() => app.el("selected-tabs-bar").innerHTML.includes("VGHY Holdings"));

  // 2. Click Performance tab: search must NOT carry over "vg" (fixes image-2 bug)
  // Instead, Performance tab has its own empty filter and shows all 13 metrics (image-3)
  await clickTab(app, "Performance");
  await waitForSheet(app, "Performance");
  expect(app.el("search-input").value).toBe("");
  expect(app.el("ticker-count").textContent).toContain("13 items");
  expect(app.el("table-body").innerHTML).not.toContain("No matching items found.");
  expect(app.el("table-body").innerHTML).toContain("YTD Return");

  // 3. Set a specific filter on Performance tab
  setSearch(app, "return");
  expect(app.el("search-input").value).toBe("return");
  const perfBody = app.el("table-body").innerHTML;
  expect(perfBody).toContain("YTD Return");
  expect(perfBody).not.toContain("Net Asset Value");
  expect(JSON.parse(app.storage.getItem(FILTERS_KEY)!)).toEqual({
    "ETF Catalog": "vg",
    Performance: "return",
  });

  // 4. Switch to Holdings tab: search is empty, shows full holdings
  await clickTab(app, "Holdings");
  await waitForSheet(app, "Holdings");
  expect(app.el("search-input").value).toBe("");
  expect(app.el("table-body").innerHTML).not.toContain("No matching items found.");

  // Type a filter on Holdings tab
  setSearch(app, "treasury");
  expect(app.el("search-input").value).toBe("treasury");

  // 5. Switch back to ETF Catalog: restores "vg" and shows exactly 9 filtered ETFs
  app.el("tabs-bar").querySelector("#all-etfs-tab-btn")!.click();
  await waitForSheet(app, "ETF Catalog");
  expect(app.el("search-input").value).toBe("vg");
  expect(app.el("ticker-count").textContent).toContain("9 ETFs");

  // 6. Switch back to Performance: restores "return"
  await clickTab(app, "Performance");
  await waitForSheet(app, "Performance");
  expect(app.el("search-input").value).toBe("return");

  // 7. Switch to Watchlist: search is initially empty
  await clickTab(app, "Watchlist");
  await waitForSheet(app, "Watchlist");
  expect(app.el("search-input").value).toBe("");

  // Set filter on Watchlist
  setSearch(app, "US");
  expect(app.el("search-input").value).toBe("US");

  // 8. Full reload: ETF Catalog restores "vg", all tab filters preserved in storage
  const reloaded = await bootFresh(app.storage);
  expect(reloaded.el("search-input").value).toBe("vg");
  expect(reloaded.el("ticker-count").textContent).toContain("9 ETFs");
  expect(JSON.parse(reloaded.storage.getItem(FILTERS_KEY)!)).toEqual({
    "ETF Catalog": "vg",
    Performance: "return",
    Holdings: "treasury",
    Watchlist: "US",
  });

  // 9. Clear button clears selection AND all per-tab searches
  reloaded.el("reset-btn").click();
  expect(reloaded.el("search-input").value).toBe("");
  expect(reloaded.storage.getItem(FILTERS_KEY)).toBeNull();
  expect(reloaded.el("ticker-count").textContent).toContain("116 ETFs");
}, 120000);

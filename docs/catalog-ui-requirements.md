# Catalog UI implementation plan: distribution frequency column + pinned columns

This is a concrete, ready-to-execute implementation plan for two catalog-table features, written specifically for this repository's actual code. It assumes zero context beyond this file.

## Architecture note (read this first)

**Vanguard has no `app.tsx` and no separate JS/TS build.** The entire app — HTML markup, the `<style>` block, and all application logic — lives in one file: `index.html` (~2732 lines). There is no JSX, no Babel, no React; the app logic is plain vanilla JavaScript in a single inline `<script>` tag. Concretely:

- `<style>` block: `index.html` lines 47–193.
- Theme bootstrap script (FOUC guard): lines 37–45. Theme localStorage key is **`vanguard-theme`** (see line 39, and `THEME_KEY` constant at line 616).
- Main application `<script>` (all logic described below lives here): starts at line 455.
- The catalog `<table>` markup shell (mostly placeholder, filled in by JS): lines 417–442, inside `<div id="table-scroll">` (lines 413–416, `overflow-x-auto overflow-y-auto`).
- The actual header/row HTML is generated at runtime by `renderTable(data, headers)` (function starts at line 2166) and `sortHeader(header)` (line 2429). Do not edit the static `<thead>`/`<tbody>` placeholder markup at lines 417–441 except where noted — it's replaced by JS on load.

Both features below are edits to `index.html` only, plus one feature (distribution frequency) also touches `scripts/update-data.ts` because the raw data does not exist anywhere in this repo yet and must be fetched.

---

## 1. Distribution frequency column

### Current state: does not exist, and the raw data is not fetched yet

Verified by inspection:
- `staticCatalogSheet.headers` (index.html, lines 1394–1417) has no frequency-related column.
- `scripts/update-data.ts` has no `frequency` field anywhere (checked with `grep -in frequency`).
- The per-fund `Distributions` tab (`index.html` lines 1213, 1925–1926) has no backing data source at all right now — every `api/vanguard/funds/*/meta.json` has an empty `"worksheets": {}` object, and `scripts/update-data.ts` never populates a `Distributions` worksheet. It is effectively a dead tab today. Leave it alone; this plan does not touch it.

**The raw provider field does exist and is reachable.** `scripts/update-data.ts`'s `officialProfile()` already calls Vanguard's workplace API (`fetchWorkplaceFundDetails(portId)`, defined at line 173) and stores the full response in the local variable `workplace` (line 257). That same response contains a field this code does not currently read:

```
workplace.marketData.body.fundCharacteristics.fundDistributionFrequency
```

Confirmed live via `GET https://workplace.vanguard.com/investments/product-details/fund/api/fundDetails?portIds=0923` (VYM's portId) on 2026-09-17, which returned (trimmed):

```json
{
  "marketData": {
    "body": {
      "fundCharacteristics": {
        "fundDistributionFrequency": "Quarterly",
        ...
      }
    }
  }
}
```

This is Vanguard's own equivalent of SPDR's `fund.distributions.frequency` — a single enum-like string, not something to recompute from history. Use it as-is; do not add a second data source or infer cadence from dividend-history rows.

### 1a. Fetch and persist the raw field — `scripts/update-data.ts`

In `officialProfile()`, the `if (workplace?.investmentsData?.body) { ... }` block (lines 270–318) reads several fields off `workplace`, but `fundCharacteristics` lives under a sibling path (`workplace.marketData.body`), not inside that `investmentsData` block, and must not be nested inside it. Add a new line right after that block closes, before the "Fallback to advisor parsing" comment:

```ts
// index.html line numbers not applicable here — scripts/update-data.ts, insert after line 318, before line 320 ("// Fallback to advisor parsing if workplace missing")

  // Vanguard's own payout-cadence label. Independent of the investmentsData.body
  // block above — it lives under marketData.body.fundCharacteristics instead.
  const distributionFrequency: string | null =
    workplace?.marketData?.body?.fundCharacteristics?.fundDistributionFrequency ?? null;
```

Then add it to the function's return object. Current return statement (line 339):

```ts
  return { url: advisorUrl, netAssets, etfAssets, expense, dividend, sec, ytd, oneYear, portId, workplaceRaw: workplace ? true : false };
```

Change to:

```ts
  return { url: advisorUrl, netAssets, etfAssets, expense, dividend, sec, ytd, oneYear, portId, distributionFrequency, workplaceRaw: workplace ? true : false };
```

Then in `run()`, the `meta` object (lines 413–443) builds what gets written to each fund's `meta.json` and to `api/vanguard/index.json`'s `funds[]` array (via `catalog.push({ ...meta, ... })` at line 445 — this is the same object `index.html`'s `fund` variable reads from). Add the field right after `secYieldAsOf` (line 430), before `ytdReturn` (line 431):

```ts
      secYieldAsOf: official.sec?.asOf ?? null,
      distributionFrequency: official.distributionFrequency ?? null,
      ytdReturn: officialYtd ?? metrics.totalReturn["1Y"] ?? null,
```

No other change to `scripts/update-data.ts` is needed. `catalog.push({ ...meta, holdings: 0, history: rows.length })` (line 445) will carry `distributionFrequency` through automatically since it spreads `meta`.

This step requires re-running the data updater (`bun scripts/update-data.ts`, or however the repo's GitHub Actions job invokes it) to actually populate `distributionFrequency` in `api/vanguard/index.json` and each fund's `meta.json`. Until that runs, `fund.distributionFrequency` will simply be `undefined` for all funds and the new column will render as `00 - —`/`00 - Unknown` everywhere — which is correct, safe fallback behavior, not a bug.

### 1b. Normalize to a sortable code — `index.html`

Add a new top-level helper function, matching this repo's existing helper style (`formatPercent`, `getHeaderTooltip`, `escapeHtml`, `sanitizeTicker` — all plain top-level `function name(...) {}` declarations, JSDoc optional). Place it in section 8 ("Static Catalog & Paginated Worksheets Loading"), directly above `async function loadStaticCatalog()` (currently line 1369), since that is the only place it's called:

```js
      /**
       * Normalizes Vanguard's raw distribution-frequency label into a
       * two-digit sortable code, e.g. "04 - Quarterly". Unknown/blank
       * values sort first ("00 - ..."), irregular cadences sort last
       * ("99 - Irregular"), keeping ascending sort meaningful.
       * @param {unknown} value
       * @returns {string}
       */
      function formatDividendFrequency(value) {
        const raw = String(value ?? "").trim();
        const normalized = raw
          .toLowerCase()
          .replace(/[‐‑‒–—]/g, "-")
          .replace(/\s+/g, " ");
        if (!normalized || normalized === "-") return "00 - —";
        if (normalized === "monthly") return "01 - Monthly";
        if (normalized === "quarterly") return "04 - Quarterly";
        if (
          normalized === "semi-annual" ||
          normalized === "semi-annually" ||
          normalized === "semiannual"
        )
          return "06 - Semi-annually";
        if (normalized === "annual" || normalized === "annually")
          return "12 - Annually";
        if (normalized === "none") return "00 - None";
        if (normalized === "unknown") return "00 - Unknown";
        if (normalized === "irregular") return "99 - Irregular";
        return raw;
      }
```

This is a direct port of SPDR's `formatDividendFrequency` — same codes, same fallback conventions — since the interaction contract is meant to stay consistent across provider repos.

### 1c. Add the column header tooltip

`COLUMN_TOOLTIPS` (the dictionary object starting at `index.html` line 470) has one entry per header, e.g. `"SEC Yield"` at line 528. Add a `"Frequency"` entry near it (insert after the `"SEC Yield"` entry, i.e. after line 529):

```js
        "SEC Yield":
          "SEC Yield (30-Day SEC Yield) — Standardized yield required by the U.S. SEC, based on income earned over the trailing 30 days after fund expenses. Useful for comparing income funds.",
        Frequency:
          "Distribution Frequency — How often the fund pays cash distributions, from Vanguard's workplace fundDetails feed (fundCharacteristics.fundDistributionFrequency). Coded for sorting: 01 - Monthly, 04 - Quarterly, 06 - Semi-annually, 12 - Annually, 00 - Unknown/None/—, 99 - Irregular.",
```

`getHeaderTooltip()` (line 590) already looks up `COLUMN_TOOLTIPS[header]` by exact match and falls back to heuristics, so no other change is needed there — the native `title` attribute is applied automatically by both `sortHeader()` (line 2436, via `getHeaderTooltip(header)`) and the export/tooltip machinery.

### 1d. Add the column to the catalog headers and data — placement

`staticCatalogSheet.headers` (index.html, lines 1394–1417) currently is:

```
Ticker, Fund Name, Type, NAV, Net Assets, Expense, Dividend Yield, SEC Yield, YTD Return, TR 1Y, TR 3Y, TR 5Y, TR 10Y, CAGR 3Y, CAGR 5Y, CAGR 10Y, SI Ann., Return As Of, Inception, Holdings, History, As Of
```

`"SEC Yield"` and `"YTD Return"` both exist verbatim, in that order, at lines 1402–1403 — this matches the required placement exactly (after SEC Yield, before YTD Return). Change:

```js
            headers: [
              "Ticker",
              "Fund Name",
              "Type",
              "NAV",
              "Net Assets",
              "Expense",
              "Dividend Yield",
              "SEC Yield",
              "YTD Return",
```

to:

```js
            headers: [
              "Ticker",
              "Fund Name",
              "Type",
              "NAV",
              "Net Assets",
              "Expense",
              "Dividend Yield",
              "SEC Yield",
              "Frequency",
              "YTD Return",
```

Then in the `data:` mapping just below (lines 1418–1445+), add the field in the same relative position, between `"SEC Yield"` (line 1429) and `"YTD Return"` (line 1430):

```js
                "SEC Yield": fund.secYield || "—",
                Frequency: formatDividendFrequency(fund.distributionFrequency),
                "YTD Return": formatPercent(totalReturn.YTD ?? fund.ytdReturn),
```

No other data-shape change is required. `fund` here is one entry of `index.funds` from `api/vanguard/index.json`, and after step 1a that array carries `distributionFrequency` on every fund.

### 1e. Sorting and export — no code changes needed, verify only

- Sorting: `isNumericColumn("Frequency")` (function at line 2485) will evaluate to `false`, because `sortableNumber("04 - Quarterly")` (line 2539) returns `null` for non-pure-numeric strings — this is correct and expected (same as e.g. `Ticker` or `Fund Name`). `compareSortableValues()` (line 2520) then falls back to `String(...).localeCompare(..., { numeric: true })`, which sorts `"00 - —"` < `"01 - Monthly"` < `"04 - Quarterly"` < `"06 - Semi-annually"` < `"12 - Annually"` < `"99 - Irregular"` correctly out of the box. **Do not add special-case sort logic for this column** — the existing generic machinery already produces the right order because of the two-digit zero-padded prefix.
- CSV/TXT export: `generateFileContent()` (line 2580) builds catalog export rows generically from `currentSheet.headers` and `row[h]` (lines 2622–2628) — since `"Frequency"` is now in `staticCatalogSheet.headers` and every row object has a `Frequency` key, both `Export .csv` and `Export .txt` buttons will include it automatically, in the same header/value order as the visible table. No export code changes needed. Just re-verify column order in an exported file after implementing 1a–1d.

---

## 2. Horizontally pinned catalog columns

### Current state: does not exist in any form

Verified: `grep -n "sticky\|pinned" index.html` only matches the vertical header stickiness (`sticky top-0 z-20` on `<thead id="table-head">`, line 420) and an unrelated CSS comment about scroll-height fixing (line 103). There is **no** horizontal column pinning today, safe or broken — this is a from-scratch addition, not a fix.

### Real column identities and current widths

From `renderTable()` (lines 2166–2318):

- **Row-number `#` column** (not pinned, per spec): header `<th class="py-3.5 px-4 w-12 text-center" ...>#</th>` (line 2187); body `<td class="py-2.5 px-4 text-slate-400 dark:text-slate-500 text-xs text-center font-mono">` (line 2237). Width: `w-12` (3rem). Leave untouched.
- **`Use` column** (pin this — checkbox + blacklist button): header at lines 2193–2202, currently `class="py-3.5 px-4 w-20 text-center"` (width `w-20` = 5rem already declared on the header only). Body cell at lines 2243–2258, currently `class="py-2.5 px-4 text-center"` — **no width class today**; must add one for the sticky offset math to hold.
- **`Ticker` column** (pin this — second pinned column): this is `headers[0]` for the catalog sheet (`currentSheet.tickerCol` is truthy for `"Ticker"`). Header comes from the generic `sortHeader()` (line 2429–2442, called via `headers.map((header) => sortHeader(header))` at line 2206) — **no special-casing and no width class today**. Body cell at lines 2266–2269: `class="py-2.5 px-4 font-mono font-semibold text-blue-600 dark:text-blue-400"` wrapped around an `<a data-fund-view="...">` — **no width class today** either.

So: unlike SPDR (which already had a `w-20` width on both cells), Vanguard's `Ticker` column and the `Use` column's body cell have no explicit width anywhere yet. Both must get one as part of this change, or the `left` offset math for the second pinned column will be wrong.

**Chosen widths (repo-specific decision for this plan):** keep `Use` at the width it already advertises on its header — `5rem` (`w-20`) — and give `Ticker` the same `5rem` (`w-20`), which comfortably fits Vanguard's tickers (2–5 uppercase letters, e.g. `VYM`, `BNDW`, `VTWO`) in the existing `font-mono font-semibold` styling. This gives:

- `Use` pinned column: `left: 0`, `width/min-width: 5rem`.
- `Ticker` pinned column: `left: 5rem` (= Use column's width), `width/min-width: 5rem`.

### 2a. CSS — add to the `<style>` block (`index.html`, inside lines 47–193)

Add this block right before the closing `</style>` tag (i.e., just above line 193). Class names follow this repo's convention of hyphenated utility-like class names (`themed-scroll`, `dz-active`, `dz-loaded`) plus a `catalog-` prefix to make clear these are catalog-only and safe to scope broadly to `#table-scroll` without leaking into the Watchlist/Holdings/Historical/Performance tables that reuse the same `#table-scroll` container (see note below).

```css
      /* Horizontally pinned catalog columns (Use + Ticker). Scoped to a
         dedicated class, not to :nth-child, because #table-scroll also
         renders the Watchlist, Holdings, Historical, and Performance
         sheets, which have a different column shape and no pinned
         columns of their own. */
      #table-scroll table {
        min-width: max-content;
        border-collapse: separate;
        border-spacing: 0;
        isolation: isolate;
      }
      #table-scroll tbody {
        position: relative;
        z-index: 0;
      }
      #table-scroll tbody tr {
        position: relative;
        z-index: 0;
      }
      #table-scroll .catalog-sticky-col {
        position: sticky;
        background: #ffffff;
        background-clip: padding-box;
      }
      #table-scroll thead .catalog-sticky-col {
        top: 0;
        z-index: 30;
        background: #f8fafc;
      }
      #table-scroll tbody .catalog-sticky-col {
        z-index: 20;
      }
      #table-scroll .catalog-sticky-use {
        left: 0;
        width: 5rem;
        min-width: 5rem;
      }
      #table-scroll .catalog-sticky-ticker {
        left: 5rem;
        width: 5rem;
        min-width: 5rem;
        box-shadow: 4px 0 6px -6px rgba(15, 23, 42, 0.7);
      }
      .dark #table-scroll .catalog-sticky-col {
        background: #172033;
      }
      .dark #table-scroll thead .catalog-sticky-col {
        background: #0f172a;
      }
      #table-scroll tbody tr:hover .catalog-sticky-col {
        background: #f8fafc;
      }
      #table-scroll tbody tr.selected-row .catalog-sticky-col {
        background: #eff6ff;
      }
      .dark #table-scroll tbody tr:hover .catalog-sticky-col {
        background: #1f2a3d;
      }
      .dark #table-scroll tbody tr.selected-row .catalog-sticky-col {
        background: #19274e;
      }
```

**Note on the `border-collapse` conflict:** the `<table>` element already carries a Tailwind `border-collapse` utility class (`class="w-full text-left border-collapse whitespace-nowrap"`, line 417), which sets `border-collapse: collapse`. The new rule `#table-scroll table { border-collapse: separate; ... }` overrides it because an ID+type selector beats a single class selector — you do not need to edit the `<table>` element's class list. Just be aware this is happening, and verify visually that row borders still look correct after the change (they should — Tailwind's `divide-y` on `<tbody>` and `border-b` on each `<tr>` draw the borders, not `border-collapse`).

**Where these colors come from (so you don't have to re-derive them or guess):** Vanguard's table container is `bg-white dark:bg-slate-800/50` sitting on top of `<body class="... dark:bg-slate-900 ...">`. Unlike SPDR (whose dark cell background was already a flat opaque `#1e293b`), Vanguard's *default* dark-mode row background is itself translucent (`slate-800` at 50% alpha over `slate-900`), so it needs pre-blending too, not just the hover/selected states:

| State | Light (already opaque, reused as-is) | Dark (translucent Tailwind class today → pre-blended solid hex) |
|---|---|---|
| Default row | `#ffffff` (`bg-white`) | `slate-800/50` over `slate-900` → **`#172033`** |
| Row hover | `#f8fafc` (`hover:bg-slate-50`, already solid) | `slate-700/30` over the default above → **`#1f2a3d`** |
| Row selected | `#eff6ff` (`.selected-row`, already solid, `!important`) | `rgba(30,64,175,.22)` over the default above → **`#19274e`** |
| Header row | `#f8fafc` (`bg-slate-50`, already solid) | `slate-900/95` over `slate-900` body → flattens to plain **`#0f172a`** |

If this repo's dark palette tokens (`slate-800`, `slate-900`, `slate-700`, the `.selected-row` blue) ever change, these four hex values must be recomputed the same way — flatten each translucent layer against the solid background actually behind it in that state, don't reuse a neighboring provider repo's numbers.

**Do not point pinned cells at `.selected-row`'s own `rgba(...)` rule or at `hover:bg-slate-700/30` directly** — both are translucent and were designed to tint a full-width row; a pinned cell repaints on top of columns that have scrolled behind it, so translucency there lets that scrolled-under text bleed through. Use the solid hex values above instead.

### 2b. Markup — header cells (`renderTable()`, `index.html`)

The `Use` header (lines 2193–2202) currently:

```js
              <th class="py-3.5 px-4 w-20 text-center" title="${escapeHtml(
                getHeaderTooltip("Use"),
              )}">
```

Add the two sticky classes directly to this `<th>` (same element, no wrapper):

```js
              <th class="catalog-sticky-col catalog-sticky-use py-3.5 px-4 w-20 text-center" title="${escapeHtml(
                getHeaderTooltip("Use"),
              )}">
```

The `Ticker` header is generated generically by `headers.map((header) => sortHeader(header))` (line 2206), which has no awareness of `isCatalog` or column index today. Change the call site to pass that information:

```js
            ${headers
              .map((header, index) =>
                sortHeader(header, isCatalog && index === 0),
              )
              .join("")}
```

Then update `sortHeader()` (lines 2429–2442) to accept and apply it:

```js
      function sortHeader(header, isPinnedTicker = false) {
        const active = sortKey === header;
        const arrow = active ? (sortDir === "asc" ? " ↑" : " ↓") : "";
        const tooltip = getHeaderTooltip(header);
        const isNumeric = isNumericColumn(header);
        const align = isNumeric ? " text-right" : "";
        const pinnedClass = isPinnedTicker
          ? " catalog-sticky-col catalog-sticky-ticker"
          : "";

        return `<th class="py-3.5 px-4${align}${pinnedClass}" title="${escapeHtml(
          tooltip,
        )}"><button data-sort="${escapeHtml(header)}" title="${escapeHtml(
          tooltip,
        )}" class="uppercase tracking-wider hover:text-blue-600 dark:hover:text-blue-400 focus:outline-none focus:text-blue-600 dark:focus:text-blue-400">${escapeHtml(
          header,
        )}${arrow}</button></th>`;
      }
```

`sortHeader()` is also called from `renderWatchlistTable()` (line 2352) with the old one-argument signature (`sortHeader(header)`) — that call is fine unchanged: `isPinnedTicker` defaults to `false`, so the Watchlist header row is completely unaffected and gets no sticky classes, which is exactly what's required (pinning must not leak into the Watchlist table, or into Holdings/Historical/Performance, which call `renderTable()` with `isCatalog` false and therefore never pass `isPinnedTicker: true`).

### 2c. Markup — body cells (`renderTable()`, `index.html`)

The `Use` body cell (lines 2243–2258) currently starts:

```js
              <td class="py-2.5 px-4 text-center">
```

Change to:

```js
              <td class="catalog-sticky-col catalog-sticky-use py-2.5 px-4 text-center">
```

(Everything inside — the checkbox and the `✕` blacklist button — stays exactly as-is; do not add an overlay or extra wrapper. This preserves click handling: `toggleEtfSelection`/`blacklistTickers` are bound via `tableBody.querySelectorAll(...)` delegation after the HTML is inserted, lines 2290–2314, and don't care about the cell's positioning.)

The `Ticker` body cell is built inside the `headers.map((header, index) => { ... })` block (lines 2262–2283). The relevant branch (`index === 0 && currentSheet?.tickerCol`, catalog case) currently is:

```js
                  if (isCatalog) {
                    return `<td class="py-2.5 px-4 font-mono font-semibold text-blue-600 dark:text-blue-400"><a href="javascript:void(0)" class="hover:underline" data-fund-view="${escapeHtml(
                      value,
                    )}">${escapeHtml(value)}</a></td>`;
                  }
```

Change only the `<td>` class list (do not touch the `<a>` inside it):

```js
                  if (isCatalog) {
                    return `<td class="catalog-sticky-col catalog-sticky-ticker py-2.5 px-4 font-mono font-semibold text-blue-600 dark:text-blue-400"><a href="javascript:void(0)" class="hover:underline" data-fund-view="${escapeHtml(
                      value,
                    )}">${escapeHtml(value)}</a></td>`;
                  }
```

The sibling non-catalog branch (`return \`<td class="py-2.5 px-4 font-mono font-semibold text-blue-600 dark:text-blue-400">...\`</td>\`;`, used by Holdings/Historical/Performance ticker columns) must be left unchanged — those tables must not get pinned columns.

### 2d. Why `isolation: isolate` + per-row `z-index: 0` matters here specifically

Vanguard's table rows already have a global `tr { transition: background-color 0.15s ease; }` rule (index.html lines 97–100) and `.selected-row` overrides with `!important` (lines 113–118) — neither sets `position` or `z-index` today, so every `<tr>` currently participates in the same flat stacking context as its ancestors. Once `.catalog-sticky-col` cells get `position: sticky` with a real `z-index` (20 for body, 30 for header), that z-index is meaningless unless it is scoped per-row — otherwise a sticky cell in row 5 could out-rank an ordinary cell in row 6 depending on paint order, instead of only out-ranking the *other cells in its own row* as they scroll underneath it. The `#table-scroll tbody, #table-scroll tbody tr { position: relative; z-index: 0 }` rule from step 2a creates that per-row stacking context. This CSS rule targets `tbody`/`tr` unconditionally under `#table-scroll` (not gated to catalog), but that is safe: it only establishes stacking contexts and does not itself add any sticky/pinned visual behavior to the Watchlist/Holdings/Historical/Performance tables, since those tables' cells never get the `.catalog-sticky-col` class.

### 2e. Mandatory verification (do not skip)

This exact class of bug — sticky positioning that looks correct at `scrollLeft = 0` but silently disappears once you actually scroll right — shipped once already in the sibling SPDR repo and was only caught by scrolling a real rendered table, not by reading the CSS. For Vanguard:

1. Serve the app locally (`bunx serve . -p 1234` per `README.md`) and open the ETF Catalog tab.
2. Scroll the `#table-scroll` container all the way to the right (there are ~20 columns after this change; use the horizontal scrollbar or `Shift`+wheel).
3. Confirm both the `Use` checkbox+blacklist column and the `Ticker` column remain visible, fully opaque, and clickable at every scroll position — not just near `scrollLeft = 0`.
4. Confirm the pinned header cells stay above the pinned body cells and above the table's own vertical sticky header row when scrolling both directions at once.
5. Toggle dark mode and repeat steps 2–4.
6. Hover a row and select a row (click anywhere in the row outside the checkbox/link/blacklist button) while scrolled right, in both themes, and confirm no scrolled-under column text is visible bleeding through the pinned `Use`/`Ticker` cells.
7. Switch to the Watchlist tab and to a fund's Holdings/Historical/Performance tabs and confirm none of their columns are pinned or visually different — this feature must not have leaked into them.
8. Confirm search, sort (including sorting by the new `Frequency` column, ascending and descending), row selection, lazy-loading of more static rows, and the responsive table-height calculation (`fitTableScrollHeight`) all still work.

---

## Acceptance checklist

- [ ] `scripts/update-data.ts`: `officialProfile()` reads `workplace.marketData.body.fundCharacteristics.fundDistributionFrequency` into `distributionFrequency` and returns it; `run()`'s `meta` object includes `distributionFrequency`.
- [ ] `api/vanguard/index.json` and each fund's `meta.json` include `distributionFrequency` after re-running the updater.
- [ ] `index.html`: new top-level `formatDividendFrequency(value)` function added near `loadStaticCatalog()`, matching SPDR's normalization codes (`00 -`, `01 -`, `04 -`, `06 -`, `12 -`, `99 -`).
- [ ] `COLUMN_TOOLTIPS["Frequency"]` added, naming the source feed and the numeric codes.
- [ ] `staticCatalogSheet.headers` has `"Frequency"` positioned immediately after `"SEC Yield"` and immediately before `"YTD Return"`.
- [ ] `staticCatalogSheet.data` row-mapping sets `Frequency: formatDividendFrequency(fund.distributionFrequency)` in the same relative position.
- [ ] Catalog table visibly renders a **Frequency** column between **SEC Yield** and **YTD Return**, sortable, showing `00 -`/`99 -`-coded values, with a header tooltip.
- [ ] CSV and TXT exports of the ETF Catalog include the `Frequency` column in the same position as the visible table.
- [ ] `Use` and `Ticker` are the only two pinned catalog columns; `#` is not pinned; no other column is pinned.
- [ ] Both pinned `<th>`/`<td>` elements have `position: sticky` applied directly to themselves (via `.catalog-sticky-col` + `.catalog-sticky-use`/`.catalog-sticky-ticker`), never to a nested wrapper.
- [ ] `Use` pinned at `left: 0`, width `5rem`; `Ticker` pinned at `left: 5rem`, width `5rem`; both have explicit `width`/`min-width`.
- [ ] Sticky header cells use `z-index: 30`; sticky body cells use `z-index: 20`; `#table-scroll table` uses `border-collapse: separate; border-spacing: 0; isolation: isolate`; `#table-scroll tbody`/`tr` use `position: relative; z-index: 0`.
- [ ] Pinned-cell backgrounds are solid hex, not translucent `rgba(...)`/Tailwind `/NN` opacity classes, for default/hover/selected states in both light and dark theme (`#ffffff`/`#172033`, `#f8fafc`/`#1f2a3d`, `#eff6ff`/`#19274e`, header `#f8fafc`/`#0f172a`).
- [ ] Ticker cell has the right-edge shadow (`box-shadow: 4px 0 6px -6px rgba(15,23,42,.7)`).
- [ ] Pinned cells use the same padding/typography classes as ordinary cells — no extra wrapper element, no compensating margins.
- [ ] `.catalog-sticky-col` and friends are applied only via explicit classes on catalog cells (gated by `isCatalog` / the `isPinnedTicker` argument to `sortHeader`), never via `:nth-child` scoped to `#table-scroll` — verified by confirming Watchlist/Holdings/Historical/Performance tables have zero pinned columns.
- [ ] Checkbox, blacklist button, and ticker link remain clickable after scrolling right.
- [ ] Verified in a real/headless browser by actually scrolling to the far right in both themes — not signed off from CSS review alone.
- [ ] Search, sort, row selection, dark theme, lazy-loading, and the table-height calculation still work after both changes.

## Handoff summary

Vanguard is a single `index.html` app (no `app.tsx`) — every change above is inside that one file, except the data-fetch addition to `scripts/update-data.ts`. Neither feature exists in this repo today: there is no distribution-frequency column or data field anywhere (the raw value, `fundDistributionFrequency`, is confirmed available from Vanguard's already-called workplace `fundDetails` API and just isn't being read yet), and there is no column pinning in any form, safe or broken, so section 2 is a from-scratch addition rather than a fix. Follow sections 1 and 2 in order — section 1's data change should land and the updater should be re-run before section 2's UI change, so the new column has real values to test pinning/scrolling against — then run through the acceptance checklist above, in particular the manual/headless real-browser scroll-to-the-right check in both themes, which is the one step a static code review cannot substitute for.

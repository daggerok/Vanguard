# Vanguard ETF UI contract

This document is the normative UI contract for the single-file application in
`index.html`, shared in spirit with the other daggerok provider apps (SPDR,
iShares, Amplify, WisdomTree) while using this repository's own tab names,
identifiers and payload schema. Acceptance tests for every section live in
`scripts/ui.test.ts` and run against the real generated feed in
`api/vanguard/`.

## Storage keys (localStorage)

| Key | Content |
| --- | --- |
| `vanguard-selected-etfs` | JSON array of selected ETF tickers |
| `vanguard-active-fund` | active fund ticker (removed when none) |
| `vanguard-blacklisted-etfs` | JSON array of blacklisted tickers |
| `vanguard-tab-sorts` | JSON map `tab -> { key, dir }` of **explicitly chosen** sorts |
| `vanguard-tab-filters` | JSON map `tab -> query` of **explicitly entered** filters |
| `vanguard-site-state` | legacy/aux state (search text, backward-compat sort keys) |
| `vanguard-theme` | `dark` / `light` |

Malformed values are sanitized at boot and can never crash the app: only a
non-empty sort key plus `asc`/`desc` is accepted; non-string or empty filter
values are dropped; broken JSON falls back to defaults.

## 1. Sort persistence

- Every tab (ETF Catalog, Watchlist, Holdings, Historical, Performance,
  Distributions) remembers its own last **explicitly selected** column and
  direction in `vanguard-tab-sorts`.
- The remembered sort is restored whenever the tab is reopened and after a
  full reload. A tab that was never explicitly sorted keeps its default:
  ETF Catalog and detail sheets = source order, Watchlist = Weight Sum (%) desc.
- **No button or checkbox may reset sorting** — not row Use checkboxes, not
  the header Use select-all, not the All ETFs pill checkbox, not tab buttons
  (including the All ETFs button), not search, Copy Tickers, CSV/TXT export,
  theme toggle, blacklist actions, and not Clear.
- **Clear removes the selection and the searches only**; remembered sorts
  survive in memory and in localStorage.
- Defaults are never written to storage as remembered sorts; only column
  header clicks record a sort.

## 1b. Per-tab filter persistence

- Every tab (ETF Catalog, Watchlist, Holdings, Historical, Performance,
  Distributions) remembers its own search query in `vanguard-tab-filters`.
- The search input is scoped to the current view: typing in the search input
  filters only the active tab and persists its filter.
- Switching tabs restores that tab's search query into the search input.
- Tabs with no explicit filter default to empty (`""`), rendering their full
  unfiltered data (preventing cross-view search collisions such as a catalog
  search for "vg" wiping out the 13 metrics on the Performance tab).
- Backspacing/clearing the input removes the entry for that tab.
- **Clear removes the selection and all per-tab searches** from memory and
  from `vanguard-tab-filters`.
- Filter persistence survives tab switches and full page reloads.
- Malformed storage is sanitized at boot and can never crash the app.

## 2. Selection scopes

Three distinct operations:

1. **Row Use checkbox** — toggles exactly one ETF.
2. **Header Use checkbox** (in the catalog table head) — scope is exactly the
   rows currently rendered by the catalog table: catalog + active search
   filter + blacklist exclusion. Checking selects exactly those visible rows;
   unchecking deselects exactly those visible rows; selections hidden by
   another filter survive. Its checked state is computed with `.every(...)`
   over the visible rows (true iff every visible row is selected), never by
   comparing selection size to a catalog count.
3. **All ETFs pill checkbox** — scope is always **every non-blacklisted ETF in
   the entire catalog**, independent of any category/detail/Holdings/
   Distributions/Watchlist tab and of any search filter. Checking selects the
   whole catalog; unchecking clears the whole-catalog selection. Clicking it
   toggles selection only and never navigates to All ETFs. Its checked state
   is `.every(...)` over all non-blacklisted catalog tickers.

## 3. Immediate selection reactivity

After every selection writer — row toggle, header select-all, All ETFs pill,
blacklist removal from selection, Clear, and localStorage restore — the app
updates immediately (no extra click needed):

- selected ETF count and clickable ticker badges in the subtitle (the active
  fund is highlighted);
- active fund ticker (falls back to another selected fund when the active one
  is deselected);
- detail-tabs panel visibility and per-sheet counts (Holdings, History,
  Performance, Distributions);
- Watchlist tab visibility, loading state and count;
- `vanguard-selected-etfs` / `vanguard-active-fund` in localStorage.

Clicking a catalog ticker, a selected ticker badge in the subtitle, or an ETF
badge inside a Watchlist row activates that fund and opens/loads its detail
view.

On reload: selection restores; the active fund restores if still selected
(otherwise the first selected fund); the active fund's sheets load in the
background; selected holdings start loading in the background; the Watchlist
rebuilds without any checkbox interaction.

## 4. Holdings & Watchlist reactivity

`ensureHoldingsForSelected()` runs after selection restore, after every row
selection change, after either select-all control, after blacklist changes
that alter selection, and whenever the Watchlist tab is opened.

- The Watchlist tab count is the number of **deduplicated holding rows**, not
  the number of selected ETFs.
- While holdings are loading the tab never shows a misleading exact count: it
  shows `Watchlist (Loading…)` when nothing is aggregated yet and
  `Watchlist (N+)` while partial results stream in. Once loading finishes it
  shows the exact deduplicated count.
- The Watchlist table mirrors this: `Loading holdings… X of Y selected ETFs
  loaded.` while loading; the search-specific empty state when a search
  matches no rows; and only after loading completes with no usable holdings:
  `Holdings data is not available yet. Run the data refresh workflow to fetch
  official Vanguard holdings (SEC N-PORT-P fallback).`
- Deselecting ETFs immediately removes their positions and recomputes count,
  Weight Sum, Max Weight, ETF badges, # ETFs and Market Value/Sector fields.
  Because holdings overlap, deselecting one ETF does not guarantee every count
  decreases — but all values exactly reflect the remaining selection.

## 5. Watchlist aggregation & identifier fallbacks

Columns: Ticker/security key, Name, ETFs (clickable badges), # ETFs,
Weight Sum (%), Max Weight (%), Market Value, Sector, Asset Class, Exchange,
Location.

Dedupe key fallback order (blank values, `-`, `--`, `—`, `N/A`, `NA`, `NONE`,
`NULL` count as missing):

1. Ticker (any non-placeholder ticker, including numeric local listing codes
   such as `005930`);
2. CUSIP;
3. ISIN;
4. Identifier / Security ID;
5. SEDOL / FIGI;
6. published security name (last resort for legitimate cash/futures/swaps/
   derivatives without any identifier).

A literal `-` Ticker must not prevent fallback to a valid identifier. Keys are
namespaced by type so identifier values never collide with tickers.

Rows are never aggressively dropped: bond positions without exchange tickers,
cash positions (e.g. the `USD` rows published by the Vanguard IRR feed),
futures/swaps/derivatives and zero-weight rows with otherwise valid data all
remain in the aggregation. `scripts/ui.test.ts` (tests 12/12b) proves these
rows are retained against the real feed.

## 6. Cache & paging races

- `meta.json` requests are deduplicated per ticker while in flight (detail
  view and Watchlist loader share one request).
- Each ticker has at most one holdings-page writer: concurrent callers reuse
  the same in-flight promise; the cache entry is written exactly once, after
  all pages arrived in source order — two rapid selection updates can never
  duplicate page 1 or skip another page.
- Page envelopes are cached and in-flight page requests deduplicated, so the
  detail-view pager and the Watchlist background loader reuse the same
  request/cache instead of double-fetching pages.
- Holdings loading runs with bounded concurrency (6 funds at a time) when All
  ETFs selects the whole catalog; queued work for an ETF deselected meanwhile
  is safely skipped; in-flight loads finish into the cache and are ignored by
  the aggregation, which only reads the current selection.
- The aggregation is memoized and invalidated whenever selection or loaded
  rows change; progressive rerenders are throttled (~150 ms) and happen even
  while the user stays on the catalog tab.
- Every page listed in `meta.json holdings.pages` is loaded for complete
  aggregation.

### Large-Watchlist rendering

The Watchlist renders in chunks of 250 rows; scrolling near the bottom grows
the rendered chunk. The full deduplicated result is never inserted into the
DOM at once. Copy Tickers / CSV / TXT export always operate on the complete
filtered result, not just the rendered chunk.

## 7. Payload contract

- `api/vanguard/index.json` — catalog; `funds[].holdings`/`funds[].history`
  agree with the per-fund manifests (validated by the acceptance tests'
  feed oracle).
- `api/vanguard/funds/<TICKER>/meta.json` — `holdings.pages[]` and
  `history.pages[]` manifests plus inline Performance data and Distribution
  rows.
- Page rows are keyed by the literal `headers` strings published in each page
  envelope; compact array rows (Distributions) and object rows are both
  normalized by `staticSheet()`; case/spacing differences never blank out
  valid cells.
- The updater (`scripts/update-data.ts`) supports both the legacy Vanguard IRR
  field names (`holdingName`, `marketValuePercentage`, `sector`) and the
  newer ones (`securityLongDescription`, `marketValueBaseCurrency`,
  `shareQuantity`, `gicsSector`, `securityId`), plus the SEC N-PORT-P
  fallback shape; the static feed itself always carries the normalized
  headers above.
- Distributions use the actual ex-date (Yahoo's inner event date, not the
  declaration epoch), rendered under the `Ex-Date` column.

## 8. Detail views

Clicking a selected fund loads its actual data. Holdings, Historical,
Performance and Distributions render real rows when their manifests/rows
exist; infinite scroll loads subsequent pages without duplicate requests.
Switching funds or sheets resets the paging generation. The previous fund's
table is never left visible while the next fund loads (a loading placeholder
is shown), and fetch failures render `Could not load <TICKER> data — ...`
instead of stale rows or a "no search matches" message. Funds without
published data get per-sheet explanatory empty states. Performance is its own
tab here (Metric/Value rows derived from meta.json); this repository does not
use an Overview tab.

## 9. Sticky columns

- Catalog: the **Use** header/body cells are pinned at `left: 0` and the
  **Ticker** header/body cells immediately after (`left: 5rem`).
- Watchlist: the **Ticker** header/body cells are pinned at the left edge.
- Sticky positioning is applied directly to each `th`/`td` (not a nested
  span), with opaque light/dark backgrounds, correct z-index, and matching
  hover/selected-row backgrounds so scrolled text never bleeds through.
- Only the table area scrolls (`overscroll-behavior: contain` plus a fitted
  max-height); the document never scrolls vertically.

## 10. Acceptance tests

`scripts/ui.test.ts` boots the real inline application script inside a
headless harness (`scripts/ui-harness.ts`: minimal fake DOM, localStorage,
IndexedDB and a file-backed `fetch` over `api/vanguard/`) and covers:

1. sort round-trip through tabs/checkboxes/buttons/Clear/reload;
2. header Use check selects exactly the filtered rows;
3. header Use uncheck keeps hidden selections;
4. All ETFs pill scope from Watchlist/detail tabs, blacklist exclusion, no
   navigation;
5. one ETF: Watchlist Loading → exact deduplicated count;
6. rapid overlapping selections: no duplicate/skipped pages, exact overlap
   aggregates (# ETFs, Weight Sum, Max Weight);
7. deselection updates subtitle/badges/tabs/Watchlist immediately;
8. select-all exact full-catalog aggregate vs. an independently computed
   oracle, with bounded DOM rendering;
9. reload restores selection, active fund and background loading;
10. Holdings (incl. next-page load), Historical, Performance, Distributions
    render real rows;
11. failing fund files produce an explanatory state replacing the prior table;
12. identifier fallbacks for bonds, cash and numeric local tickers are kept;
13. sticky classes present on catalog Use/Ticker and Watchlist Ticker cells;
14. malformed localStorage cannot crash boot;
15. index.json / meta.json / page manifests stay consistent;
16. per-tab filter persistence across all catalog, detail, and Watchlist views.

Run them with `bun test` (or `bun test scripts/ui.test.ts`). Expected values
are computed from this repository's generated feed, never copied from another
provider.

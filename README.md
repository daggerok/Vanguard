# Vanguard ETF Holdings to Watchlist

Vanguard ETF catalog and holdings browser using the shared daggerok ETF application contract.

## Current implementation target

This repository is being built to combine:

- official Vanguard fund metadata and performance metrics;
- daily historical prices/NAV data;
- Vanguard holdings exports where available;
- SEC EDGAR N-PORT-P fallback holdings;
- the shared ETF catalog, fund detail, Watchlist, filtering, blacklist, and export UI.

The generated data will live under `api/vanguard/` and the updater will be implemented in `scripts/update-data.ts` using Bun.

## Development

```bash
bun install --frozen-lockfile
bun test                                  # updater tests + UI contract tests
bun test scripts/update-data.test.ts      # data-layer tests only
bun test scripts/ui.test.ts               # UI contract acceptance tests
bunx serve . -p 1234
```

The UI contract tests boot the real inline `index.html` script headlessly
(`scripts/ui-harness.ts` provides a tiny fake DOM/localStorage/IndexedDB and a
file-backed `fetch` over `api/vanguard/`), then verify the acceptance flows
against expected values computed independently from the generated feed.

Data refresh will be exposed through the manually triggered GitHub Actions workflow after the provider updater is complete.

## Data limitations

Vanguard public endpoints may rate-limit automated requests. The updater will use conservative throttling, retries, cached data preservation, and SEC fallback behavior. Official Vanguard performance metrics remain authoritative; daily history is stored separately for charts and historical browsing.

## UI contract notes

The complete contract (with the exact selection scopes, Watchlist behavior and
rendering rules) is documented in [`docs/ui-contract.md`](docs/ui-contract.md).
Summary:

- Search placeholder: `Search ETFs, fund names, holdings, tickers, CUSIPs, ISINs...`
- Selection is persisted per provider in `localStorage` (`vanguard-selected-etfs`, `vanguard-active-fund`); the blacklist in `vanguard-blacklisted-etfs`.
- Sort order is remembered **per tab** (`vanguard-tab-sorts` in `localStorage`, like the checkbox selections) and restored whenever the tab is reopened, including after a full page reload. No button or checkbox ever resets it — row checkboxes, the header Use box, the All ETFs pill checkbox, tab buttons, search, Copy Tickers, exports, theme toggle, blacklist actions and Clear all keep it; Clear clears only the selection and the searches. To return to the default catalog order, click the *Ticker* header (asc). Watchlist defaults to Weight Sum (%) desc; ETF Catalog and detail sheets default to source order. Tabs never explicitly sorted keep their defaults.
- Three distinct selection operations: the row **Use** checkbox toggles exactly one ETF; the **Use checkbox in the table header** operates only on the rows the catalog table currently renders (catalog + active search + blacklist), leaving selections hidden by another filter untouched; the **checkbox inside the All ETFs pill** always toggles every non-blacklisted ETF of the entire catalog, from any tab and under any filter, and never navigates.
- Every selection change updates the subtitle count/ticker badges, the active fund, the detail-tabs panel, the per-sheet counts, the Watchlist tab and `localStorage` immediately.
- The Watchlist tab shows `Watchlist (Loading…)` (or `N+` while rows stream in) until every selected fund's holdings pages are loaded, then the exact deduplicated count. Deselecting ETFs recomputes the aggregation immediately.
- Watchlist dedupe falls back Ticker → CUSIP → ISIN → Identifier → SEDOL/FIGI → Name (blank/`-`/`N/A` cells count as missing); bond rows without tickers, cash rows and zero-weight rows are kept.
- Holdings pages and `meta.json` requests are deduplicated per ticker, run with bounded concurrency, and are shared between the detail view and the Watchlist loader. Large Watchlists render in 250-row chunks grown on scroll; copy/export always use the complete filtered result.
- Missing or failing fund files produce explanatory states; sticky **Use**/**Ticker** catalog columns and a sticky Watchlist **Ticker** column stay pinned during horizontal scrolling.

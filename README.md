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

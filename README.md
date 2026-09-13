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
bun test scripts/update-data.test.ts
bunx serve . -p 1234
```

Data refresh will be exposed through the manually triggered GitHub Actions workflow after the provider updater is complete.

## Data limitations

Vanguard public endpoints may rate-limit automated requests. The updater will use conservative throttling, retries, cached data preservation, and SEC fallback behavior. Official Vanguard performance metrics remain authoritative; daily history is stored separately for charts and historical browsing.

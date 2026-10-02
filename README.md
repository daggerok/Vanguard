# Vanguard

One of the app's features lets you select Vanguard ETFs in the Watchlist and aggregate their holdings to see how often each ticker appears across the selected funds. Repeated holdings make overlapping exposure visible: the more selected funds include a ticker, the greater its potential influence on the portfolio; gains in that holding may help, while declines may hurt, and actual impact also depends on each fund's position size.  Another feature makes it faster and easier to find funds with stronger growth over different periods, higher dividend yields or distributions, greater Total Return (price performance plus dividends), and other key performance metrics. A single-file client-side tool that reads the generated `./api/vanguard` static feed (official Vanguard fund metrics and holdings, official NAV/premium-discount history merged by date with Yahoo Finance for OHLC/volume and distributions, SEC EDGAR N-PORT-P as fallback) into a searchable ETF/asset-class catalog with per-fund tabs, watchlist aggregation, ticker copy and CSV/TXT export — the same look, feel, columns and business logic as the sibling applications.

## Using Bun

```bash
bunx degit daggerok/Vanguard#main ./12345 && cd $_
bunx serve . -p 1234
open http://0:1234
```

The published application is available at <https://daggerok.github.io/Vanguard/>.

## Updating the static Vanguard data

Run the updater with Bun:

```bash
bun test
bun scripts/update-data.ts
```

Run `bun scripts/update-data.ts -h` (or `--help`) to print every control with its default and usage examples.

Defaults live in `scripts/update-data.config.json` (every control as a string). The **Update Vanguard ETF data** GitHub Actions workflow and the command line use the same `resolveControls` function from `scripts/update-data.ts`. Precedence: file defaults < `advanced` JSON < nonblank workflow inputs < protected Actions variable/environment. A blank workflow input inherits the file value, and scheduled runs use the file defaults as-is. Controls without an individual workflow input are set through the `advanced` JSON object, e.g. `{"AUM": "10B:", "HISTORY_RANGE": "5y"}`. All supplied filters use **AND** logic.

### Data sources

| Block | Source |
| --- | --- |
| Catalog (all US Vanguard ETFs) | Fund list embedded in the updater (`FUNDS_SEED`), checked against `https://investor.vanguard.com/etf/list` and `https://api.vanguard.com/rs/gre/gra/1.7.0/datasets/auw-holdings` (official API) |
| Holdings per fund | `https://investor.vanguard.com/investment-products/etfs/profile/{TICKER}#holdings` (holdings table) |
| Daily NAV/market-price/premium-discount history | Same `AdditionalFundData` response's `historicalPrice` + `premiumDiscountDetails` blocks (official, merged by date; ~21 months of daily premium/discount, longer month-end-only NAV) |
| Daily OHLC/volume; distributions; history fallback | Yahoo Finance chart API - the only source for Open/High/Low/Volume and for dividend/split events, and for any date the official blocks above don't cover |
| Fallback | SEC EDGAR N-PORT-P for holdings fallback |

### Metrics and caveats

Each fund carries a derived `metrics` object that powers the catalog columns shared with the sibling sites:

- `ytd` / `tr1y` - official YTD and 1-year returns -> *YTD Return*, *TR 1Y*
- `cagr3y` / `cagr5y` / `cagr10y` - published annualized 3Y/5Y/10Y figures -> *CAGR 3Y/5Y/10Y*
- `tr3y` / `tr5y` / `tr10y` - cumulative 3Y/5Y/10Y figures `(1 + CAGR)^n - 1` -> *TR 3Y/5Y/10Y*
- `siAnn` - since-inception annualized -> *SI Ann.*
- `dividendYield` - 12-month trailing yield or indicated yield (latest distribution x frequency / price), an estimate derived from Yahoo Finance distributions and price
- `secYield` - 30-day SEC yield when published; `-` otherwise

Official NAV, market price and premium/discount come from Vanguard; Open/High/Low/Volume and distributions come from Yahoo Finance and are not official fund data. Values a source does not publish are left unavailable, not zero. Each holdings sheet records its as-of date and source, and SEC N-PORT-P is used only when the Vanguard feed has no holdings.

### Update controls

| Environment variable | Default | Meaning |
| --- | --: | --- |
| `MAX_FETCHES` | `0` | `0` updates every selected fund; a positive value updates that many funds per run and resumes after the saved cursor (`api/vanguard/update-state.json`) on the next run, wrapping to the start after the last fund. |
| `REQUEST_SLEEP` | `0` | Seconds to wait after each fund update (nonnegative number). |
| `CONCURRENCY` | `4` | Number of parallel fund update workers (integer >= 1). |
| `AUM` | `:` | Fund net assets in dollars, `min:max`; amounts accept `K`/`M`/`B`/`T` suffixes or the `nano`/`micro`/`small`/`mid`/`large` presets. Funds without the value are skipped. |
| `TER` | `:` | Expense ratio percent, `min:max`. Funds without the value are skipped. |
| `DIVIDEND_YIELD` | `:` | Vanguard trailing dividend yield percent, `min:max`. Funds without the value are skipped. |
| `SEC_YIELD` | `:` | 30-day SEC yield percent, `min:max`. Funds without the value are skipped. |
| `TICKERS` | all | Space-, comma- or semicolon-separated ticker allowlist, e.g. `VTI VOO BND VUG`; empty updates every fund. |
| `CATEGORY` | empty | Keep funds whose catalog category contains this text, case-insensitive (`Bond`, `US Equity`, `Sector`, `International Equity`, `Global Equity`, `Real Estate`). |
| `HOLDINGS_PAGE_SIZE` | `250` | Rows in each generated current-holdings JSON page (integer >= 1). |
| `HISTORY_PAGE_SIZE` | `1000` | Rows in each generated daily-history JSON page (integer >= 1). |
| `MAX_RETRIES` | `2` | Retries after the initial SEC request (integer >= 1, at most 5 are used). Only HTTP 408/425/429/5xx are retried, with exponential backoff. |
| `HISTORY_RANGE` | `max` | `max` or `Ny` (e.g. `5y`): limits the Yahoo request window and the published history rows. Returns that need a longer window than the range are left unavailable. |
| `SEC_UA` | `daggerok ETF feed daggerok@gmail.com` | User-Agent sent to SEC EDGAR and Vanguard endpoints; redacted in the config log. In Actions the protected `SEC_UA` repository variable wins when nonblank. |
| `SKIP_YAHOO` | `false` | Do not request Yahoo Finance; previously published history rows and distributions are kept (`true`/`false`). |
| `EDGAR_FALLBACK` | `true` | Use SEC N-PORT-P holdings when the Vanguard feed has none (`true`/`false`). |
| `VERBOSE` | `false` | Print per-fund retry and fallback notices (`true`/`false`). |
| `PERFORMANCE_YTD` | `:` | Annualized return percent for the period, `min:max`: YTD is the official Vanguard figure with a Yahoo adjusted-close fallback, 1Y is the official 1-year figure with a Yahoo fallback, 3Y/5Y/10Y are CAGR from Yahoo adjusted closes. Funds with no value for the period pass. |
| `PERFORMANCE_1Y` | `:` | See `PERFORMANCE_YTD`. |
| `PERFORMANCE_3Y` | `:` | See `PERFORMANCE_YTD`. |
| `PERFORMANCE_5Y` | `:` | See `PERFORMANCE_YTD`. |
| `PERFORMANCE_10Y` | `:` | See `PERFORMANCE_YTD`. |
| `TOTAL_RETURN_YTD` | `:` | Cumulative total return percent for the period, `min:max` (same sources as `PERFORMANCE_*`; 3Y/5Y/10Y are `(1 + CAGR)^n - 1`). Funds with no value for the period pass. |
| `TOTAL_RETURN_1Y` | `:` | See `TOTAL_RETURN_YTD`. |
| `TOTAL_RETURN_3Y` | `:` | See `TOTAL_RETURN_YTD`. |
| `TOTAL_RETURN_5Y` | `:` | See `TOTAL_RETURN_YTD`. |
| `TOTAL_RETURN_10Y` | `:` | See `TOTAL_RETURN_YTD`. |

Filters take `min:max` with exactly one colon (an empty side is unbounded) and are combined with AND. Filter values come from the fund's freshly fetched data, falling back to its last published metadata. A fund that fails the filters, is not selected by `TICKERS`/`CATEGORY`, or falls outside the current `MAX_FETCHES` batch keeps its previously published data and catalog row. Invalid values fail the run before any request. The raw-download setting `STORE_RAW_DOWNLOADS` is not offered because the updater downloads no source files.

### Examples

```bash
TICKERS="VTI VOO BND VUG" bun scripts/update-data.ts
CONCURRENCY=2 REQUEST_SLEEP=1 bun scripts/update-data.ts
VERBOSE=true TICKERS=VOO bun scripts/update-data.ts
AUM="10B:" TER=":0.1" CATEGORY=Bond bun scripts/update-data.ts
MAX_FETCHES=20 HISTORY_RANGE=5y bun scripts/update-data.ts
```

## TypeScript and verification

The browser app is intentionally build-free: `index.html` carries the markup, styles and bootstrap, and `app.tsx` is TypeScript compiled in the browser with Babel standalone - no build step, no bundler, no `tsconfig.json` needed. Bun runs TypeScript out of the box.

Verification before every publish:

```bash
bun install --frozen-lockfile
bun test
bun build --target=bun scripts/update-data.ts --outfile=/dev/null
git diff --check
```

## Brands table

| Brand | Where to get the data |
| --- | --- |
| **AAM** | [aamlive.com](https://www.aamlive.com/ETF) \| [AAM](https://daggerok.github.io/AAM/) |
| **abrdn (Aberdeen)** | [aberdeeninvestments.com](https://www.aberdeeninvestments.com/en-us/investor/funds/etfs) \| [aberdeen](https://daggerok.github.io/aberdeen/) |
| **Amplify** | [amplifyetfs.com](https://amplifyetfs.com/) \| [Amplify](https://daggerok.github.io/Amplify/) |
| **ARK Invest** | [ark-funds.com](https://www.ark-funds.com/our-etfs/) \| [ARK](https://daggerok.github.io/ARK/) |
| **Capital Group** | [capitalgroup.com](https://www.capitalgroup.com/advisor/investments/exchange-traded-funds.html) \| [Capital-Group](https://daggerok.github.io/Capital-Group/) |
| **Fidelity** | [fidelity.com](https://www.fidelity.com/etfs) \| [Fidelity](https://daggerok.github.io/Fidelity/) |
| **First Trust** | [ftportfolios.com](https://www.ftportfolios.com/Retail/etf/etflist.aspx) \| [First-Trust](https://daggerok.github.io/First-Trust/) |
| **Franklin Templeton** | [franklintempleton.com](https://www.franklintempleton.com/investments/options/exchange-traded-funds) \| [Franklin](https://daggerok.github.io/Franklin/) |
| **Global X** | [globalxetfs.com/explore](https://www.globalxetfs.com/explore) \| [Global-X](https://daggerok.github.io/Global-X/) |
| **Goldman Sachs** | [am.gs.com](https://am.gs.com/en-us/individual/funds?locale=en-us&audience=individual&sf=funds&filters=funds%7CETF&limit=100) \| [Goldman-Sachs](https://daggerok.github.io/Goldman-Sachs/) |
| **Invesco** | [invesco.com](https://www.invesco.com/us/en/financial-products/etfs.html) \| [Invesco](https://daggerok.github.io/Invesco/) |
| **iShares** | [ishares.com](https://www.ishares.com/) \| [iShares](https://daggerok.github.io/iShares/) |
| **JPMorgan** | [am.jpmorgan.com](https://am.jpmorgan.com/us/en/asset-management/adv/products/fund-explorer/etf) \| [JPMorgan](https://daggerok.github.io/JPMorgan/) |
| **NEOS** | [neosfunds.com](https://neosfunds.com/#explore-etfs) \| [Neos](https://daggerok.github.io/Neos/) |
| **Northern Trust** | [etfs.ntam.northerntrust.com](https://etfs.ntam.northerntrust.com/us/en/individual/funds) \| [Northern-Trust](https://daggerok.github.io/Northern-Trust/) |
| **Pacer ETFs** | [paceretfs.com](https://www.paceretfs.com/products/) \| [Pacer](https://daggerok.github.io/Pacer/) |
| **Parametric** | [eatonvance.com](https://www.eatonvance.com/products/etfs.html) \| [Parametric](https://daggerok.github.io/Parametric/) |
| **ProShares** | [proshares.com](https://www.proshares.com/our-etfs/find-proshares-etfs) \| [ProShares](https://daggerok.github.io/ProShares/) |
| **Schwab** | [schwabassetmanagement.com](https://www.schwabassetmanagement.com/products) \| [Schwab](https://daggerok.github.io/Schwab/) |
| **SP Funds** | [sp-funds.com](https://www.sp-funds.com/) \| [SP-Funds](https://daggerok.github.io/SP-Funds/) |
| **SPDR** | [ssga.com](https://www.ssga.com/us/en/intermediary/etfs/fund-finder) \| [SPDR](https://daggerok.github.io/SPDR/) |
| **Sprott ETFs** | [sprottetfs.com](https://sprottetfs.com/) \| [Sprott](https://daggerok.github.io/Sprott/) |
| **Tema ETFs** | [temaetfs.com](https://temaetfs.com/funds) \| [Tema](https://daggerok.github.io/Tema/) |
| **Themes ETFs** | [themesetfs.com/etfs](https://themesetfs.com/etfs) \| [Themes](https://daggerok.github.io/Themes/) |
| **VanEck** | [vaneck.com](https://www.vaneck.com/us/en/etf-mutual-fund-finder/) \| [VanEck](https://daggerok.github.io/VanEck/) |
| **Vanguard** | [investor.vanguard.com](https://investor.vanguard.com/etf/list) \| [Vanguard](https://daggerok.github.io/Vanguard/) |
| **VictoryShares** | [vcm.com VictoryShares ETFs](https://www.vcm.com/products/victoryshares-etfs/victoryshares-etfs-list) \| [VictoryShares](https://daggerok.github.io/VictoryShares/) |
| **WisdomTree** | [wisdomtree.com](https://www.wisdomtree.com/investments) \| [WisdomTree](https://daggerok.github.io/WisdomTree/) |
| **Xtrackers** | [etf.dws.com](https://etf.dws.com/en-us/etf-products/) \| [Xtrackers](https://daggerok.github.io/Xtrackers/) |

## Sibling applications

| Application | Data provider | Repository |
| --- | --- | --- |
| AAM | Official AAM catalog/detail HTML + full holdings XLS + SEC N-PORT holdings fallback + Yahoo market history/dividends | [AAM](https://github.com/daggerok/AAM) |
| abrdn (Aberdeen) | Official Aberdeen gateway + SEC N-PORT holdings fallback + Yahoo history/dividends | [aberdeen](https://github.com/daggerok/aberdeen) |
| Amplify | Amplify ETFs (Firestore data feed) | [Amplify](https://github.com/daggerok/Amplify) |
| ARK Invest | ark-funds.com fund pages + overview/NAV-history/performance JSON + official daily holdings CSV + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance distributions/history fallback | [ARK](https://github.com/daggerok/ARK) |
| Capital Group | Official Capital Group fund data + SEC N-PORT holdings fallback + Yahoo history fallback | [Capital-Group](https://github.com/daggerok/Capital-Group) |
| Fidelity | SEC EDGAR N-PORT-P + Yahoo Finance | [Fidelity](https://github.com/daggerok/Fidelity) |
| First Trust | ftportfolios.com official ETF list + fund summary, holdings, distribution and price-history export pages + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history fallback | [First-Trust](https://github.com/daggerok/First-Trust) |
| Franklin Templeton | franklintempleton.com ETF listings + product pages + SEC EDGAR N-PORT-P | [Franklin](https://github.com/daggerok/Franklin) |
| Global X | globalxetfs.com Next.js catalog and fund pages + dated full-holdings CSV | [Global-X](https://github.com/daggerok/Global-X) |
| Goldman Sachs | am.gs.com fund finder + detail pages + SEC EDGAR N-PORT-P | [Goldman-Sachs](https://github.com/daggerok/Goldman-Sachs) |
| Invesco | invesco.com CSV downloads + Yahoo Finance | [Invesco](https://github.com/daggerok/Invesco) |
| iShares | iShares (BlackRock) product workbooks | [iShares](https://github.com/daggerok/iShares) |
| JPMorgan | am.jpmorgan.com fund explorer + product-data JSON | [JPMorgan](https://github.com/daggerok/JPMorgan) |
| NEOS | neosfunds.com lineup table + official fund pages + daily holdings CSV | [Neos](https://github.com/daggerok/Neos) |
| Northern Trust | etfs.ntam.northerntrust.com funds list + per-fund CSV/JSON downloads | [Northern-Trust](https://github.com/daggerok/Northern-Trust) |
| Pacer ETFs | paceretfs.com product catalog and fund pages (Cloudflare WAF; r.jina.ai proxy fallback) + SEC EDGAR N-PORT-P (Pacer Funds Trust) + Yahoo Finance history/dividends | [Pacer](https://github.com/daggerok/Pacer) |
| Parametric | eatonvance.com ETF catalog and Parametric product pages + SEC EDGAR N-PORT-P holdings + Yahoo Finance history/dividends | [Parametric](https://github.com/daggerok/Parametric) |
| ProShares | proshares.com ETF finder + fund pages + official data host | [ProShares](https://github.com/daggerok/ProShares) |
| Schwab | schwabassetmanagement.com product pages + CSV exports | [Schwab](https://github.com/daggerok/Schwab) |
| SP Funds | sp-funds.com homepage catalog, fund pages and daily holdings CSV + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history/dividends | [SP-Funds](https://github.com/daggerok/SP-Funds) |
| SPDR | SSGA / State Street public feeds | [SPDR](https://github.com/daggerok/SPDR) |
| Sprott ETFs | sprottetfs.com fund pages + SEC EDGAR N-PORT-P (Sprott Funds Trust) + Yahoo Finance history/dividends | [Sprott](https://github.com/daggerok/Sprott) |
| Tema ETFs | Tema official fund pages + dated daily holdings CSV; SEC EDGAR N-PORT-P holdings fallback only + Yahoo Finance price/history/dividend fallback | [Tema](https://github.com/daggerok/Tema) |
| Themes ETFs | themesetfs.com catalog + daily holdings CSV + Yahoo Finance history/dividends + SEC N-PORT-P holdings fallback | [Themes](https://github.com/daggerok/Themes) |
| VanEck | vaneck.com ETF finder + product pages | [VanEck](https://github.com/daggerok/VanEck) |
| Vanguard | Vanguard product pages + SEC EDGAR N-PORT-P | [Vanguard](https://github.com/daggerok/Vanguard) |
| VictoryShares | VCM VictoryShares catalog and product JSON + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance adjusted-market-price history | [VictoryShares](https://github.com/daggerok/VictoryShares) |
| WisdomTree | WisdomTree product table + SEC EDGAR N-PORT-P + Yahoo Finance | [WisdomTree](https://github.com/daggerok/WisdomTree) |
| Xtrackers | Official DWS catalog/US sitemap + PDP/XLSX + SEC N-PORT-P holdings fallback + Yahoo Finance daily prices/history/dividends | [Xtrackers](https://github.com/daggerok/Xtrackers) |

## License

[MIT - same as all sibling ETF repositories.](./LICENSE)

Vanguard® and the fund names/tickers referenced here are trademarks of The Vanguard Group, Inc. This is an independent, unofficial tool; it is not affiliated with, endorsed by, or sponsored by Vanguard. All data is reproduced from Vanguard's own public fund pages, public SEC EDGAR filings and Yahoo Finance for research purposes. All other trademarks, including index names, are the property of their respective owners.

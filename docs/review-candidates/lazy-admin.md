# Issue 19: deferred admin panel candidate

Review only; do not merge without the owner's separate decision.

Only the admin panel moves behind a dynamic import, triggered by its first open.
The component remains mounted after that first use, preserving selected tabs and
usage filters on close/reopen. Loading and chunk errors show a closeable dialog;
a failed chunk can be retried without reloading the workspace or losing a draft.

Same dependency cache, Vite 6.4.5 production build, same source base:

| App mounted, before first admin open | Before | Candidate |
| --- | ---: | ---: |
| JavaScript bytes, static graph plus immediate bootstrap App import | 1,430,953 | 1,398,414 |
| Gzip bytes, each loaded chunk compressed separately | 417,206 | 410,381 |

This saves 32,539 raw bytes / 6,825 gzip bytes on this path, not a measured
first-paint time or a promise of an equally sized network/CPU improvement.
The deferred admin chunk is about 34.7 KB raw / 8.9 KB gzip and loads on use.
The existing large-main-chunk warning remains. Share entry behavior is unchanged.

Synthetic rendering tests cover closed/first-open behavior. A browser fixture
checks loading, opening and preserving a Last 7 days filter on reopen with all
application requests mocked. The production-build offline/chunk-failure test is now completed below.
Physical Windows UI acceptance remains unrun.

Run the fixture at tests/ui/deferred-admin.html with a local development server.
No account, keys, user media or provider quota are needed.

## Actual local startup and offline acceptance (2026-10-28)

Main `0556f1c17d1638941bf05bbd9c879ff683366313` versus this candidate, same
Node 24.19.0/Vite 6.4.5 cache, five alternating fresh-origin navigations per build
on one Mac in the in-app browser. Every sample restarted the actual local HTTP
workspace server with a temporary SQLite database on a different loopback port.
Ready means the real App generation prompt mounted, not a test-only placeholder.

| Measurement | Main | Candidate |
| --- | ---: | ---: |
| App-ready median | 145.8 ms | 147.1 ms |
| App-ready range | 120.8–147.8 ms | 101.7–154.2 ms |
| First-contentful-paint median | 120 ms | 120 ms |
| App chunk bytes | 1,230,723 | 1,198,164 |
| App chunk gzip bytes (same compressor) | 353,845 | 347,012 |

**No actual startup speed improvement is demonstrated.** The smaller initial
bundle is real; these noisy local measurements do not establish a latency win.
This is webview-content startup, not native launcher cold start or physical
Windows/cloud acceptance. The earlier byte table describes the earlier build;
these numbers use the current main baseline and must not be combined with it.

The actual Vite production admin chunk was left unloaded, the synthetic app
server stopped, and opening Admin showed the closeable loading/error dialog.
After the same server/port returned, Try again loaded the real AdminPanel without
reloading the workspace. Selecting Last 7 days, closing and reopening retained
that filter. No importer/fetch mock or provider account was used for this flow.

Reproduction: `node scripts/serve-ui-acceptance.mjs lazy` builds the isolated
esbuild fixture. For the same production flow, run
`node scripts/build-lazy-acceptance.mjs`, then
`node scripts/serve-ui-acceptance.mjs lazy .build/acceptance-lazy-production`. The helper prints a local
control URL: `/launch`, `/offline`, `/online`, `/restart`. It creates only marked
temporary synthetic data. `startup <checkout-local-build-root>` adds visible
App-ready metrics to the real production App. No nonce appears in URLs/logs.

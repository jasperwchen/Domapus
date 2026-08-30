# Benchmark harness

Measures cold-load cost under pinned conditions so before/after claims are
defensible. Built **before** any optimisation work, so the baseline is measured
by the same instrument as every later result.

## Files

| File | Purpose |
|---|---|
| `run.mjs` | one build, N cold loads, median + p95 → `results/<label>.json` |
| `compare.mjs` | 2 files → before/after table · 3+ files → timeline table |
| `history.mjs` | builds and benchmarks historical commits from git worktrees |
| `serve.mjs` | static server that mimics GitHub Pages (gzip + Range) |

## Quick start

    npm run build
    node bench/serve.mjs dist Domapus 4319 &
    node bench/run.mjs --url http://localhost:4319/Domapus/ --label baseline

    node bench/compare.mjs bench/results/baseline.json bench/results/candidate.json

Pass the base path **without slashes** (`Domapus`, not `/Domapus/`). Git Bash
rewrites arguments beginning with `/` into Windows paths.

## Pinned conditions

    CPU throttle   4x        (mobile is where the main-thread cost shows)
    Network        slow4g    1.6 Mbit/s down, 150 ms RTT  (or `cable`)
    Viewport       1440x900
    Cache          disabled, fresh browser context per run
    Runs           10 + 1 discarded warm-up; report MEDIAN and p95
    Map view       PINNED via ?lat=39.5&lng=-98.35&zoom=4&metric=zhvi

**View pinning is not optional.** PMTiles fetches by HTTP range request, so tile
traffic depends on the viewport. Unpinned, tile volume swamps every other signal
and runs are not comparable.

**CPU throttling is not optional either.** Unthrottled, main-thread costs look
almost fine and you under-report your own improvement by roughly an order of
magnitude.

## Two harness bugs worth knowing about

Both were found by sanity-checking the harness against reality rather than
trusting its output — the same technique that found the property-type bug.

**1. Transfer was under-reported 2.3×.** The first version summed
`performance.getEntriesByType("resource")` on the main thread. But
`zip-data.json` is fetched **inside the Web Worker**, and worker-initiated
requests do not appear in the main thread's resource timing. Reported 2.25 MB;
the truth is 5.27 MB. Now collected from Playwright's `response` events, which
do see worker traffic.

**2. `networkidle` fires too early.** The full dataset is deferred behind
`requestIdleCallback`, so it *starts* after the network first goes quiet.
Measuring to `networkidle` missed the single largest cost entirely. The harness
now waits until the resource count stops growing for three consecutive checks.

Paint detection also cannot use `gl.readPixels` — MapLibre creates its context
without `preserveDrawingBuffer`, so the buffer reads back cleared after
compositing. It screenshots a centre crop and uses PNG size as a proxy for pixel
variety, which also works for the non-WebGL Leaflet-era builds.

## Metrics

Everything is browser-native, so the harness runs against **any** build —
including historical commits that cannot be instrumented.

| Metric | Why |
|---|---|
| **TBT** | headline. Sum of long-task time beyond 50 ms — the blocked main thread |
| LCP | payload → first meaningful paint |
| max long task | worst single stall |
| transfer + by kind | payload work, split js / data-json / pmtiles / basemap |
| JS heap | in-memory model cost |
| metric switch | interaction cost — the choropleth re-application path |
| CLS | layout stability |

`performance.measure` marks are collected when present and ignored when absent,
so instrumented builds get extra detail without breaking historical runs.

## Historical benchmarking

    node bench/history.mjs
    node bench/compare.mjs bench/results/era*.json

Each commit is checked out into its own worktree and built with **the data it
shipped**. This is "lived experience" mode and it is the only coherent option
across the project's three architectural eras: the geometry format changed with
the architecture (GeoJSON → PMTiles), so there is no "same app, different data"
to hold constant. A Leaflet build cannot consume PMTiles.

A code-only comparison — holding today's data fixed — is still valid, but only
*within* era 3, where the data contract is stable. Use it to isolate the
optimisation work from data growth.

See `docs/ENGINEERING-LOG.md` Part 5.

## Caveats to state alongside any number

- A local server is not GitHub Pages: no Fastly CDN, no real RTT variance. Fine
  for **relative** comparison when the harness is identical on both sides; the
  headline before/after should come from prod vs a PR preview, which share a CDN.
- Cross-origin basemap tiles report 0 bytes without `Timing-Allow-Origin`, so
  `basemap` transfer is understated. It is constant across compared builds.
- Old commits may fail `npm ci` (yanked packages, Node drift). `history.mjs`
  skips and reports them rather than silently omitting them.
- View pinning needs URL-state support, which not every era has. `run.mjs`
  records `pinnedViewApplied` and warns when it did not take.

## Baseline (era 3 HEAD, local, 2026-08-29)

    LCP             7016 ms   (p95 7024)
    TBT             4178 ms   (p95 4238)
    max long task    740 ms
    transfer        5.27 MB   (data-json + pmtiles + js)
    JS heap         73.8 MB
    metric switch   2650 ms

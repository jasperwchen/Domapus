# Domapus — Engineering Log

A running record of the systematic redesign: what was found, what was wrong, what
was decided, and — deliberately — every misconception that had to be corrected
along the way. The corrections are the most useful part. Kept in chronological
order so the reasoning is legible, not just the conclusions.

---

## Part 1 — The bug that started it

### How it was found

Not by reading code. By checking published output against ground truth.

The site publishes `public/data/zip-data.json`. The raw Redfin TSV was already
downloaded locally. Comparing the two for period 2026-05-31 answered a question
nobody had asked: *does the number on the map match the number in the source?*

### What it was

`scripts/update_market_data.py` selected one row per ZIP with:

    chunk.sort_values('PERIOD_END').drop_duplicates('zip_code', keep='last')

Redfin publishes **five rows** per (ZIP, period) — one per `PROPERTY_TYPE`: All
Residential, Single Family, Condo/Co-op, Townhouse, Multi-Family (2-4 Unit). The
dedup key was `zip_code`. The true primary key is
`(PERIOD_END, REGION, PROPERTY_TYPE)`.

So the surviving row was whichever landed last — and `sort_values` defaults to
`kind='quicksort'`, which is **not stable**. The selection was not even
deterministic across runs or pandas versions.

### Measured blast radius

| | |
|---|---|
| ZIPs published with a price (2026-05-31) | 19,536 |
| **Showing the wrong property type** | **7,285 (37.3%)** |
| Off by >2x | 775 |
| Off by >5x | 33 |
| ZIPs where the correct value was unavailable | **0** |

What the live site was actually plotting:

    62.7%  All Residential          (correct)
    13.1%  Single Family Residential
     9.3%  Condo/Co-op
     8.0%  Townhouse
     6.9%  Multi-Family (2-4 Unit)

Worst cases:

| ZIP | Shown as | Published | Truth (All Residential) | Error |
|---|---|---|---|---|
| 31602 | Multi-Family | $3,526,000 *(1 sale)* | $213,500 *(119 sales)* | 16.5x |
| 33139 Miami Beach | Single Family | $9,975,000 *(24)* | $610,000 *(318)* | 16.4x |
| 10065 Upper East Side | Multi-Family | $15,900,000 *(2 sales)* | $1,272,500 *(75)* | 12.5x |
| 60611 Chicago | Single Family | $3,625,000 *(3)* | $530,000 *(333)* | 6.8x |

Every choropleth color, quantile bucket, side-by-side comparison and PDF export
inherited this.

### The general lesson

The root cause is not the missing filter. It is that `drop_duplicates` was used
as a *filter* without ever asserting the key was unique.

**The rule:** `drop_duplicates` / `groupby().last()` must never be called on an
unasserted key. Either the key is unique and the dedup is a no-op — assert it —
or it is not, and the tie-break must be written down explicitly.

Measured cost of that assertion: **0.53 s on 3.3M rows.** There is no performance
argument against running it every month.

---

## Part 2 — Misconceptions, and how each was caught

Recorded because being wrong in a traceable way is the point. Each was caught by
someone checking the primary source rather than the summary.

### 2.1 — "PERIOD_DURATION is the bug"

**Believed:** Redfin ships 30/90/365-day windows and the dedup mixes them.
**Actually:** `PERIOD_DURATION` is uniformly **90** across all 9.7M rows.
**Caught by:** sampling the column at three byte offsets before asserting it.
**But:** the *class* of bug was real — it was `PROPERTY_TYPE`, not duration.
Looking for one unfiltered grouping key led to finding a different one.

### 2.2 — "The national view renders ~1% of ZIPs"

**Believed:** tile metadata says `dropped_by_rate: 99` at z3, so
`--drop-densest-as-needed` discards 99% of features, biasing the map rural.

**Actually:** `dropped_by_rate` is a **raw count**, not a percentage — it is a
`size_t` counter in tippecanoe's `tile.hpp`. `--drop-densest-as-needed` never
fired at all; `dropped_as_needed` is absent from every zoom entry. Decoding the
real z3 tiles found **31,828 of 33,780 ZCTAs present**, not ~338.

**Caught by:** reading tippecanoe's source and decoding the actual tiles instead
of trusting a field name.

**The conclusion survived anyway, via a different mechanism.** `-pT` disables
tiny-polygon reduction *only at z12*, so at z3–z11 tippecanoe replaces
sub-threshold polygons with dust squares, and `-S 5` collapses survivors into
degenerate rings. Features are present but geometrically annihilated:

| Zoom | Invisible (sub-pixel) | Metro | Non-metro |
|---|---|---|---|
| z3 | 13,600 (40%) | **44.1%** | 25.0% |
| z4 *(default view)* | — | **22.4%** | 13.9% |
| z5 | — | 10.6% | 8.7% |

Right conclusion, wrong mechanism — and the corrected version is more
interesting: it is not a config mistake, it is a **physics limit**. At z4 ground
resolution at latitude 40 is 3,749 m/px; ZCTA 10001 is ~1.2 km across = **0.32
px**. No tiling flag renders a third of a pixel. Only aggregate geography does.

**Refined again by the final spec.** An independent MVT decode put the z3 figure at
**31,828 of 33,780 present (94%)**, and identified the actually-missing ZIPs as
New York, Washington DC and Boston — urban, confirming the bias direction. But
the mechanism is worse than "annihilated": tippecanoe's tiny-polygon reduction
does not leave holes, it **merges a cluster of small ZCTAs into one square
carrying one arbitrary ZIP's value**. A hole is visibly absent; a square is
confidently wrong. That makes it the same failure as the property-type bug — a
plausible-looking value with no signal behind it.

Still open: the sub-pixel share measures 40% by one method and 89.5% by another.
Only one of those may be quoted publicly. Re-measure from true bboxes once
`zcta-geom.csv` exists.

### 2.3 — "The TSV is grouped by ZIP"

**Believed:** each ZIP's full history is contiguous, so a streaming reduce can
bound memory by ZIP.
**Actually:** the file is effectively shuffled — 199,988 distinct runs in the
first 200,000 rows.
**Caught by:** an agent testing the claim instead of accepting it as given.
**Why it mattered:** any streaming design relying on contiguity would have
silently produced wrong output.

### 2.4 — "MONTHS_OF_SUPPLY and PRICE_DROPS are available metrics we ignore"

**Actually:** both are **100% null** across all 9,725,026 rows, for every property
type. They cannot be added.

### 2.5 — "2020 ZCTAs number 33,120"

**Actually:** 33,791. 33,120 is the **2010** delineation.

### 2.6 — "Use a 33k-branch `match` expression for the choropleth"

**Partly right:** `match` evaluation *is* O(1) — MapLibre builds a dict at parse
time; measured ~46 ns per lookup.
**But wrong as a fix:** it is still a *paint-property change*, so it still
triggers the tile reload that is the actual problem (§3.1), and it ships 270 KB
to every tile worker on every metric switch.

### 2.7 — "Prune the README screenshots from the build"

**Wrong:** they are published deliberately so they can be linked from the live
site. Corrected to prune them from **PR previews only**, where nothing links them.

### 2.8 — "First-commit-of-month is a valid historical checkpoint set"

**Believed:** picking the first commit of each month touching `src/` gives a fair
sample of the project's history to benchmark.

**Actually:** three of the first four measured builds were **not functional**, and
each still produced clean, plausible numbers:

| Checkpoint | painted? | data loaded | verdict |
|---|---|---|---|
| `era1-leaflet` (36a7972) | no | 470 bytes total, 3 requests | serves an HTML shell only |
| `era2-maplibre-geo` (89c73b7) | yes | **none** — no geojson, no zip-data | basemap painted, dataset never fetched |
| `era2-late` (e837137) | no | 6.0 MB | data loaded, map never rendered |

The timeline built from them looked authoritative — a tidy monotonic curve of LCP
6000 → 6360 → 7016 ms and TBT 619 → 1212 → 4178 ms — and would have supported a
confident claim about how the app evolved. It was measuring, variously, an empty
page and an app that never loaded its own data.

**Caught by:** checking `painted` and per-kind transfer bytes on each sample
before reading the chart. A build that fetches 470 bytes cannot have a meaningful
Total Blocking Time.

**Fixed two ways:** checkpoints now use **end-of-month** commits (first-of-month
lands mid-work), and `run.mjs` computes a `valid` flag — a result is invalid if
the map never painted or if under 100 KB of housing data was fetched.
`compare.mjs` refuses to chart invalid builds and prints why they were excluded.

This is the same failure as Part 1 wearing different clothes: **a number that
looks reasonable is not evidence that it measured the thing you meant.**

### 2.9 — A patch script that reported success without checking

While adding resume-skip logic to `history.mjs`, the patch script printed
`"resume-skip added"` unconditionally — it never verified that the string it was
replacing had actually been found. The anchor did not match, nothing was
inserted, and the next run silently redid an hour of completed work.

Structurally identical to the bug that started this whole project: an operation
that assumes its precondition instead of asserting it, then reports success.
The fix is the same rule — `assert` the replacement landed, in the same breath as
performing it.

---

### 2.10 — "The diff gate would have caught the bug about six times over"

**Believed:** a threshold near **0.05** on "share of ZIPs whose price moved more than
25% since last month", against roughly **0.30** for the buggy pipeline — a ~6x trip.

**Actually:** a ZIP median is computed over a median of ~14 sales, and that is noisy
enough on its own that **14.1%** of ZIPs move more than 25% in a completely normal
month. Measured over the panel's own 172 month-over-month transitions:

| metric | observed median | observed p99 | threshold (p99 x 1.5) |
|---|---|---|---|
| `median_sale_price` | 0.141 | 0.187 | **0.281** |
| `median_list_price` | 0.140 | 0.197 | 0.296 |
| `median_ppsf` | 0.104 | 0.144 | 0.216 |

A threshold near 0.05 would fire every single month, and a gate that fires every
month is a gate somebody switches off.

**Caught by:** calibrating from the real panel instead of estimating, then running the
finished gate against the last snapshot the broken pipeline actually published.

**The gate still catches it — at 1.2x, not 6x.**

| metric | moved >25% | limit | |
|---|---|---|---|
| `median_sale_price` | **33.9%** of 19,901 | 28.1% | trips |
| `median_list_price` | **30.3%** of 18,885 | 29.6% | trips |
| `median_ppsf` | **22.9%** of 19,753 | 21.6% | trips |
| `zhvi` | 0.0% of 26,262 | 1.0% | passes |

ZHVI passing is the useful part: the defect was Redfin-side, so the gate localises
the fault to a source rather than only saying "something moved".

**And a threshold rule can degenerate.** `zhvi` moved >25% for **zero** ZIPs in all
318 monthly transitions — it is smoothed and seasonally adjusted — so p99 x 1.5 sets
its threshold to **0.0**, a gate that fires on one outlier ZIP. The rule needed a
floor. A calibration rule is itself a claim that has to be checked against the data
it is calibrated on.

### 2.11 — "The chunked feature-state write costs ~15-25 ms across four frames"

**Believed:** `setFeatureState` is expensive enough that writing 33,771 of them must
be spread over animation frames, 8,000 at a time, to stay responsive.

**Actually:** `setFeatureState` costs **0.14 us** — 10,000 calls in 1.4 ms, measured
in-page. The whole ZIP set is about **5 ms**, a third of one frame.

So the chunking was not buying responsiveness, it was **spending four extra frames
waiting**: each chunk dirties the source and MapLibre does a full map render between
frames. Writing the set in one pass took the choropleth apply from **579 ms to 9 ms**
with no other change.

**Caught by:** micro-benchmarking the call in the running page after the
instrumented number refused to match the estimate. The instrumentation was added to
prove the fix worked; it caught a second, smaller mistake inside the fix.

**The general shape:** an optimisation sized against an unmeasured cost can be the
cost. This is the same failure as the property-type bug in a different register — a
plausible number nobody checked against the thing itself.

### 2.12 — "The published wrong value for 30309 is $575,000 across 9 sales"

**Believed:** the live site showed a Townhouse median of $575,000 over 9 sales where
the truth was $407,500 over 140.

**Actually:** the last snapshot the broken pipeline published shows **$360,000 over
105 sales**, and the all-residential truth at that period is **$402,500 over 146**.
Neither number matches the earlier observation.

**And that is a confirmation, not a discrepancy.** `drop_duplicates` on an unproven
key hands the choice to quicksort's pivot, and the pivot depends on the values inside
each 100,000-row chunk. The defect **re-randomizes on every run**, so the wrong value
is a different wrong value each time.

**Consequence for the test suite:** a regression test written against any one
observed wrong value would be testing the coin, not the code. The committed test
asserts the aggregate and asserts the published figure is unreachable from that row.

**The real before/after is worse than the example anyway.** Sales counts are the tell:

| ZIP | published | truth | |
|---|---|---|---|
| 90210 | $1,840,000 / **7** sales | $6,400,000 / **75** sales | median over 7 transactions when 75 existed |
| 60614 | $1,240,000 / **5** sales | $849,500 / **368** sales | median over 5 when 368 existed |
| 30309 | $360,000 / 105 | $402,500 / 146 | |
| 78701 | $541,000 / 72 | $537,000 / 75 | |
| 10001 | $2,637,500 / 30 | $2,637,500 / 30 | the coin landed on the aggregate row |

### 2.13 — "The inherited column bounds describe the data"

**Believed:** the contract ranges carried over from the old feed would hold, give or
take the two scale changes already known about.

**Actually:** they rejected real rows on **six** columns. `median_dom` was bounded at
3,650 days — a 10-year cap — and the feed reaches **18,504**. `median_sale_price` had
a $1,000 floor and the file contains a real **$1.00** sale. `avg_sale_to_list` turned
out to be clamped by Redfin at exactly **[50, 200]**, which is a better contract than
anything that could have been guessed.

**Caught by:** the contract firing on the first smoke run, then scanning all 4,930,000
rows rather than widening the bound until it stopped complaining.

**The bounds are now measured and the measurement is in the comment**, so the next
person to see one fire can tell a units change from a bound that was always wrong.

---

## Part 3 — What the systematic review found

### 3.1 — The most expensive thing in the app

`MapLibreMap.tsx:564` calls `setPaintProperty` with a data-driven expression. In
MapLibre, `StyleLayer.setPaintProperty` returns `isDataDriven || wasDataDriven`,
which `_updatePaintProperty` treats as **`requiresRelayout`**:

    setPaintProperty -> _updateLayer -> _updatedSources['zips'] = 'reload'
      -> TileManager.reload -> VectorTileWorkerSource.reloadTile
      -> full re-bucketing + earcut re-tessellation of every in-view tile
      -> re-serialize to main thread -> complete GPU buffer re-upload

On **every metric switch**, purely because the expression *object* changed.

Underneath, `SourceFeatureState.coalesceChanges` rebuilds a 33,771-entry object
and hands it to every renderable tile; `updatePaintArrays` then loops all 33,771
ids **per tile**. At ~30 tiles: ~1M binary searches and ~1M array allocations per
switch.

**Fix:** set `fill-color` **once** at `addLayer` as a `step` over a class index in
feature-state. The expression object never changes, so no relayout, so no tile
reload. Metric switches become a `Uint8Array` of class indices (0.64 ms for all
33,771 rows, 33 KB on the wire) applied only to ids `querySourceFeatures` reports
as loaded — ~340 at default view instead of 33,771.

### 3.2 — Measured load path

Node 24 / V8, against the real 8.6 MB `zip-data.json`:

| Today | | Proposed | |
|---|---|---|---|
| TextDecoder | 2.4 ms | header parse | 0.3 ms |
| `JSON.parse` | 67.2 ms | zero-copy typed-array views | 0.045 ms |
| rebuild 33,771 objects x 43 props | 173.0 ms | transfer (not clone) | 0.19 ms |
| `structuredClone` of the record | **237.8 ms** | | |
| **total** | **~480 ms** *(~2.4 s mobile)* | **total** | **~0.5 ms** |

The `structuredClone` is pure waste: the same bytes were already in an
ArrayBuffer the worker could have transferred for free.

### 3.3 — Data honesty problems

- **6,659 drawable ZCTAs (19.7% of the map) have no data from either source** and
  are visually indistinguishable from a legitimate low value.
- **26.0%** of latest-period ZIPs have `HOMES_SOLD < 5`; **49.8%** under 20.
  Medians on 1–4 transactions are noise, and they enter the global quantile
  computation on equal footing with ZIPs having hundreds of sales — distorting the
  color scale for *every* ZIP. Observed: ZIP 16436 median $1,500 on 1 sale; ZIP
  91008 median $10,380,000 on 1 sale.
- **`PERIOD_DURATION = 90`** means every row is a trailing 3-month aggregate.
  Consecutive periods share 2 of 3 months, so Redfin's shipped `_MOM` compares two
  windows sharing two-thirds of their transactions. Confirmed arithmetically: ZIP
  30309's shipped MoM reproduces exactly as `407500/418000-1`. The UI labels these
  as monthly. MoM is structurally damped and autocorrelated **by construction** —
  which also means naive forecast confidence intervals built on these residuals
  would be far too narrow.
- **475 Redfin ZIPs** have market data but no ZCTA geometry (USPS point/PO-box
  ZIPs); **50 ZIPs** in the data have no polygon in the tileset at all — they are
  searchable, `flyTo` works, and nothing ever highlights.
- `spatial-index.ts` models every ZCTA as a fixed **0.01° box around its
  centroid**, so viewport queries miss large rural ZCTAs entirely and the
  auto-scale quantiles are computed over a set that is neither what is painted nor
  what intersects the viewport — then the Legend labels those percentiles as
  describing the current view.

### 3.4 — Operational findings

- **`gh-pages` was 800.70 MiB against GitHub Pages' 1 GiB hard limit.** 667 MiB
  (83%) was five stale PR previews, each carrying a full 133 MB copy of the
  tileset. Headroom was 223 MiB = **1.67 more previews before the site stopped
  building.**
- `deploy.yml` (`force_orphan: true`) and `preview.yml` both write `gh-pages` with
  **no concurrency group** on any of the four workflows. Every merge to main 404s
  every open preview.
- The pipeline downloads **1.44 GB into the git working tree** and only removes it
  in a `finally` block.
- Published data is overwritten **in place** with a truncating `open()` — no
  staging, no atomic rename, no rollback.
- The only publish gate is `data_points_changed > 0`. The last run changed **77.8%
  of all ZIPs** — the signature of the property-type bug — and published anyway.
- `.git` is 1.1 GB; three copies of the tileset in history. LFS store is 495 MB
  with only 6 reachable files.
- `requirements.txt` is unpinned (`pandas>=1.5.0`), so a pandas release changing
  `drop_duplicates` semantics silently changes published numbers with no diff.
- **No geometry build script exists.** The 92 MB tileset is an unreproducible
  one-off whose only record is the `generator_options` string in its own metadata.
- z12 alone is **34.13 MB — 39% of the tileset** — encoding a coordinate grid 8x
  finer than a screen pixel can resolve.

---

## Part 4 — Decisions

| Decision | Rationale | Tradeoff accepted |
|---|---|---|
| Filter to `All Residential` | **Lossless**: exists for 3,298,202/3,298,202 (period, ZIP) pairs | Loses per-type breakdown; medians are not decomposable, so 5 types are 5 universes, not a drill-down |
| Assert the primary key before every dedup | Generalizes the bug class; 0.53 s on 3.3M rows | None |
| Immutable paint expression + class-index feature-state | Avoids the relayout entirely | New tiles flash uncolored for one frame until state applies |
| Previews read production data | Preview 133 MB to 2.96 MB | Preview depends on prod being up |
| Keep `force_orphan: true` | Removing it reintroduces the history growth it prevents | Deploys still wipe previews; they re-publish on next PR push |
| Lived-experience benchmarking | The geometry format **is** the architecture across eras — "hold data constant" is not merely worse, it is impossible | Conflates code and data growth; mitigated by a code-only comparison scoped to era 3 |
| Aggregate county layer at low zoom | The only fix for sub-pixel urban ZCTAs; others address presence, not visibility | County is not ZIP; the aggregate must be an honest statistic, not a median of medians |

---

## Part 5 — Three architectural eras

| Era | Dates | Map library | Geometry format |
|---|---|---|---|
| 1 | 2025-07-06 to 07-14 (8 days) | Leaflet | GeoJSON, TopoJSON, GeoJSON.gz |
| 2 | 2025-07-14 to 12-07 (5 months) | MapLibre | raw GeoJSON.gz — **32 MB parsed in-browser** |
| 3 | 2025-12-07 to present | MapLibre | PMTiles (HTTP range requests) |

The remembered "laggy" build is era 2, not the Leaflet era — a subtler and more
instructive mistake than picking the wrong library.

This is also why benchmarking must use each era's own data: a Leaflet build cannot
consume PMTiles. **The data format is not a variable you can hold constant across
an architecture change.**

---

## Part 6 - Measuring before changing

The harness was built **before** any optimisation, so the baseline is measured by
the same instrument as every later result. Comparing a stopwatch to a wall clock
is not a benchmark.

### Baseline - era 3 HEAD, local, 2026-08-29

Pinned at 4x CPU throttle, Slow 4G, 1440x900, cold cache, median of 5 runs:

| Metric | Median | p95 |
|---|---:|---:|
| LCP | 7,016 ms | 7,024 ms |
| **Total Blocking Time** | **4,178 ms** | 4,238 ms |
| Max long task | 740 ms | |
| Transfer | 5.27 MB | |
| JS heap | 73.8 MB | |
| Metric switch | 2,650 ms | |

Run-to-run spread is under 0.2% on LCP, which means the pinning works and any
improvement above ~2% is real signal rather than noise.

### Two bugs in the harness itself

Both found by checking the instrument against reality instead of trusting its
output - the same move that found the property-type bug.

**Transfer was under-reported by 2.3x.** The first version summed
`performance.getEntriesByType("resource")` on the main thread and reported
2.25 MB. But `zip-data.json` is fetched **inside the Web Worker**, and
worker-initiated requests never appear in the main thread's resource timing. The
harness was blind to the single largest file it existed to measure. True figure:
5.27 MB. Now collected from Playwright's `response` events, which see worker
traffic.

**`networkidle` fires before the real work starts.** The full dataset is deferred
behind `requestIdleCallback`, so it begins *after* the network first goes quiet.
Measuring to `networkidle` missed it entirely. The harness now waits until the
resource count stops growing for three consecutive checks.

A third, smaller one: paint detection cannot use `gl.readPixels`, because
MapLibre creates its context without `preserveDrawingBuffer` and the buffer reads
back cleared after compositing. It now screenshots a centre crop and uses PNG
size as a proxy for pixel variety - which also works for the non-WebGL
Leaflet-era builds.

**The lesson repeats:** every significant finding in this project came from
comparing an output against an independent source of truth, never from reading
the code that produced it.


---

## Part 7 — Building it: phases 1-3

Three commits, in the order the plan required, each leaving the site working.

### Phase 1 — the feed migration and the correctness fix

The old feed did not 404; it **froze**. Still 200 OK, `Last-Modified` pinned at
2026-06-02, newest period 2026-05-31. So the pipeline downloaded 1.5 GB, parsed it
cleanly, and republished three-month-old numbers as a success. A silent failure is
worse than a loud one, and this one had a stale-data check that would not trip until
September.

`pipeline/` replaces `scripts/update_market_data.py`. The structural fix is one
sentence: **declare the grain, assert it before any reduction, and ban the reduction
that hid the assumption.** `(PERIOD END, REGION NAME)` is asserted on every run — 0
duplicates in 4,930,000 rows — and CI greps `drop_duplicates` and `groupby().last()`
out of `pipeline/` so a third one cannot appear.

Adding `kind='stable'` would have made the wrong answer *deterministic*, not correct.
That distinction is the whole point.

Two things came out of the migration that were not renames:

**The panel.** The old code kept one row per ZIP and discarded 172 of 173 periods.
`build/panel.parquet` now holds all of it — 173 x 33,952, 4,930,000 rows, 274 MB —
which is what makes any of the statistics or history work possible at all.

**Two columns do not mean what their headers say.** `MEDIAN DAYS ON MARKET YOY (%)`
and `MONTHS OF SUPPLY YOY (%)` are `(now - year_ago) x 100` under a `(%)` suffix that
is a lie. Proof it cannot be a percent change: 43.2% of the values are below −100, and
`(new − old)/old` cannot be. Verified against real lag-12 levels — ZIP 65262's
`median_dom` went 55 to 13, published YoY −4199.07, and −4199.07/100 = −41.99 against
an actual difference of −42.

The trap is that the general rule for this feed is "delete the `* 100`", and the old
code already skipped that multiplication for `dom`. Following the general rule is a
no-op there and ships the column 100x too large. It needs a **division**.

**And a bug of my own, in the same area.** `coerce` ran in two places, so the division
happened twice and `median_dom_yoy` shipped as 0.17 days instead of 16.55. Caught by
checking the output against real lag-12 levels, not by re-reading the code — the same
move that found the original bug.

### Phase 2 — the diff gate and the deploy that never fired

`update_data.yml` pushed its data commit with the default `GITHUB_TOKEN`. GitHub's
loop prevention means a push made with that token **does not trigger workflows**, so
`deploy.yml`'s `on: push` never fired for the data commit and new data sat on `main`
unpublished until an unrelated human push happened to redeploy it.

`deploy.yml` is now callable and `update_data.yml` calls it in the same run graph.
One detail is load-bearing: under `workflow_call` the job inherits the *caller's*
event, so `actions/checkout` defaults to the SHA from when the cron fired — before
the data commit. Deploying that SHA republishes last month's data, and **that symptom
is indistinguishable from the bug being fixed**. The `ref` input exists for exactly
that, and the deploy job prints the SHA and period it is publishing.

The gate itself, and the two corrections it produced, are in 2.8.

### Phase 3 — the choropleth

`setPaintProperty` on a data-driven value makes maplibre-gl mark the source
`'reload'`: every loaded tile is re-sent to the worker, re-parsed from cached PBF,
its fill bucket rebuilt, its GPU buffers re-uploaded. That fired on every metric
change and, in auto-scale mode, on every `moveend`. Nothing in the code said so.

Both paint properties are now constant expressions set once at `addLayer`. The only
thing that varies — which class a ZIP is in — lives in feature-state, which does not
relayout.

**Verified rather than asserted.** `bench/verify-choropleth.mjs` reports 0 tile
requests caused by a metric switch and `map:sourceReload` = 0, and exits non-zero
otherwise.

Writing the **full** ZIP set per epoch rather than only what is on screen is a
correctness decision, not a performance one. MapLibre re-applies accumulated
feature-state to tiles revived from its out-of-view cache, so scoped writes leave
stale state for off-screen ZIPs and **panning back silently shows the previous
metric's colours**. Full-set writes make that impossible instead of mitigating it.
The measured cost of the "optimisation" that was rejected: `querySourceFeatures` at
z3 returns 38,077 feature instances against 33,771 ZIPs, because ZCTAs repeat across
tile boundaries. It is more work, not less, at the zoom it was meant to help.

### Measured, same instrument, same pinned conditions

slow4g / 4x CPU / 1440x900 / 5 runs / pinned view:

| | pre-phase-1 | after phase 1 | after phase 3 |
|---|---|---|---|
| LCP | 7,352 ms | 7,228 ms | **7,012 ms** |
| Total Blocking Time | 5,120 ms | 4,053 ms | **2,934 ms** |
| Long task count | 40 | 38 | **22** |
| Transfer | 4,793,964 B | 5,247,137 B | 5,247,137 B |
| JS heap | 62.4 MB | 64.1 MB | **55.9 MB** |
| **Metric switch** | **3,375 ms** | 3,190 ms | **1,491 ms** |

**The two baselines are not comparable and the phase boundary is why.** Phase 1 took
the latest period from 20,010 reporting ZIPs to **29,738 (+48.6%)**, so transfer moved
for reasons that have nothing to do with any optimisation. Every claim after this
point has to name which baseline it means. The 2026-08-29 figure in Part 6 measures
the *old feed's* payload and stopped being a valid comparand the moment Phase 1
merged.

**And the headline number needs decomposing, because most of it is not the map.**
At the same 4x throttle, with a control run that re-selects the already-selected
option so no metric change happens at all:

| | ms |
|---|---|
| dropdown open + click, **no metric change** | **580** |
| compute the 7 quantile breaks over 33,771 values | 69 |
| build the class map | 32 |
| write 17,053 feature states | **38** |
| React re-render to two frames later | 416 |

The choropleth work is **139 ms**. The rest is a Radix Select under 4x CPU throttle
and React re-rendering a tree that carries 33,771 ZIPs in props. Quoting 1,491 ms as
"the choropleth cost" would be as unexamined as the numbers this project exists to
correct.

### The palette, because a claim you cannot re-derive is a claim you cannot defend

`scripts/palette/derive_ramp.mjs` resamples the 12-hex ramp to 7 classes at equal arc
length in CIELAB, simulates all three colour-vision deficiencies (Machado 2009, in
**linear** RGB — applying those matrices to gamma-encoded values overstates the
remaining contrast), and refuses to emit a ramp whose L* is not monotone or whose
minimum adjacent dE76 under CVD is below 10.

| | 12-hex source | derived 7 |
|---|---|---|
| adjacent dE76 coefficient of variation | 0.2364 | **0.0524** |
| min adjacent dE76, protanopia | 9.01 | **19.34** |
| min adjacent dE76, deuteranopia | 8.43 | **12.68** |
| min adjacent dE76, tritanopia | 7.93 | **12.04** |

### Superseded by these phases

Part 4's decision table lists "Filter to `All Residential`" as the fix. On the new
feed that filter is **dead code** — the file *is* the aggregate, and the
`PROPERTY TYPE` column does not exist. It is not ported. What survives, and matters
more, is the assertion underneath it: the primary key is now the only thing standing
between us and Redfin re-introducing a breakout dimension, so `contracts.py` asserts
those columns stay **absent**.

---

---

*Appended to as work proceeds. Corrections belong in Part 2 — do not quietly edit
an earlier claim; record that it was wrong and how it was caught.*

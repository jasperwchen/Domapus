# Methodology reference (developer-facing)

This document answers "where does this number come from, and what stops it being
wrong". It is not the reader-facing page — that is `src/pages/Methodology.tsx`,
which explains what the numbers mean to someone looking at the map. The two have
different jobs and different audiences; keep them that way.

This file is the reference for the shipped behaviour.

---

## 1. Stage to module to manifest key

Every stage writes `build/` plus a `build/<stage>_report.json` receipt, and the
next stage refuses to start unless the previous receipt says `ok`. Nothing here
touches `public/data/`.

| Stage | Module | Produces | Manifest key |
|---|---|---|---|
| S0 probe | `sources.py` | upstream fingerprint | `upstream`, `fingerprints` |
| S1 acquire | `sources.py` | the raw CSVs, outside the tree | — |
| S2 ingest | `redfin.py`, `zhvi.py`, `panel.py` | `panel.parquet`, `zhvi-panel.parquet` | `panel` |
| S3 assemble | `serialize.py`, `dim.py`, `geom.py`, `changes.py` | `zip-data.json` | `snapshot`, `coverage`, `orphans`, `redfin`, `zhvi`, `changes` |
| S4 gate | `gate.py` | pass/fail | `gate`, `validation` |
| S5 noise | `noise.py` | `msp_rse`, `dom_rse`, `rel` | `noise` |
| S5b forecast | `forecast.py` | `f_h12`, `f_sigma`, `f_tier` | `forecast` |
| S5c spatial | `spatial.py` | `lisa` | `spatial` |
| S6 classify | `classify.py` | class breaks | `classes`, `classing`, `diverging` |
| S7 paint | `paint.py` | `paint/*.u8` | `assets.paint` |
| S8 history | `history.py` | `history/*.json` | `history` |

Supporting: `units.py` maps Redfin headers to our keys, declares the accepted spellings
of each header and which of them a release cannot survive losing; `contracts.py` holds
the declared invariants and raises `PipelineError`.

---

## 2. Constants: fitted, derived, or chosen

The distinction matters because a fitted constant moves every release and a chosen
one does not. Quoting a fitted constant as though it were fixed is how a
methodology page goes stale.

| Constant | Where | Kind | Notes |
|---|---|---|---|
| `K` | `noise.py` | **fitted per release, per series** | `1.2533 × sd(log x)`. Fitted at lag 3 by differencing each period against the mean of its neighbours. Published as `noise.K` and `noise.per_metric[*].K`. **Refit if numpy is bumped** — the shipped value was derived under numpy 2.5.2. |
| `LAG_USED` | `noise.py` | chosen, justified | 3 is the first lag with no shared transactions in a rolling three-month window. `noise.K_lag` publishes every lag so the plateau is checkable. |
| `TIER_EDGES` | `noise.py` | chosen | `0.10, 0.06, 0.04` on the relative standard error. The **edges** are the contract; the implied sample sizes move with `K` and are published as `noise.tier_n_implied`, never hardcoded. |
| `RANKABLE_RSE` | `noise.py` | chosen | `0.10`. Implied `n` published as `noise.rankable_n_implied` (32 on the 2026-07 release). |
| `CLASSES` | `classify.py` and `choropleth.generated.ts` | **measured, not chosen** | 14. The count is the largest that keeps the separable span/classes ratio no worse than the old 7-class ramp gave; 13 and 15 fail. The paint byte imposes a second ceiling of 15 (the class field is the low nibble holding `class + 1`), which `paint.py` raises on. **Both must agree** — `PaintTable.from` refuses to construct when `manifest.classes` and the ramp length disagree. Re-run `derive_ramp.mjs` and the byte check before moving it. |
| `SCHEMES` | `classify.py` | chosen per metric family | log-equal for prices, quantile for counts, equal-anchored-100 for shares, diverging for YoY. |
| `COUNT_METRICS` | `classify.py` | chosen, justified | The metrics exempt from the rankable gate on their break population. See §4. |
| `DIVERGING_BOUND` | `classify.py` | **derived per release** | Smallest multiple of 5 pp not below the pooled p95 of `abs(yoy)`. Published as `diverging.bound`. There is deliberately **no** copy of it in `src/lib/choropleth.ts`. |
| Colour ramp | `choropleth.generated.ts` | **derived at build time** | `scripts/palette/derive_ramp.mjs`. Refuses to emit a ramp whose L\* is not monotone or whose minimum adjacent dE76 under simulated CVD falls below 10. Never hand-edit. |
| `FULL_OPACITY` | `choropleth-painter.ts` | chosen, measured | `1`. Any value below it reintroduces the lightness confound in §5. |
| `MAX_BBOX_SPAN_DEG` | `zip-table.ts` / `geom.py` | chosen, measured | `10`. The widest real ZCTA is 99503 (Anchorage) at 8.3966°. |
| Feed YoY scale | `changes.py` | **derived per release** | Which of `SCALE_CANDIDATES` (1, 100) Redfin's own `median_dom_yoy` / `months_of_supply_yoy` column is on, voted against our lag-12 level difference. Published as `changes.reconciliation.feed_scale`. Derived rather than declared because Redfin moved DOM from x100 under a "(%)" header to x1 under "(DAYS)" for the 2026-08 release. Months of supply is still x100. |

---

## 3. Wire format: the two halves

**`SNAPSHOT_COLUMNS` in `pipeline/serialize.py` and `FIELD_OF` in
`src/lib/zip-table.ts` are one format in two halves. Change them together.**

The format is **positional**: the frontend reads `f` and indexes `d` by position,
so inserting a name in the middle silently shifts every column after it. Add at
the end, or change both sides in one commit.

Three properties, each of which was a real bug:

- **Every column declares its scale.** A missing scale decodes unscaled — a 4.6%
  relative standard error reaches the popup as the number 46. `scales` is asserted
  to cover every name in `f`.
- **Null is not zero.** `0` is legal for `hs`, `dom`, `abv`, `om2`, `cov`, `rel`
  and `lisa`, so a one-pass Int32Array conversion mapping null to 0 destroys real
  zeros. `NULL_SENTINEL` is declared in the envelope and asserted to round-trip.
- **The scale is applied exactly once.** `geom.offsets` returns **degrees**;
  `COLUMNS` applies the `1e4`. It used to apply it in both places, shipping
  degrees × 1e8 under a header saying × 1e4 — see §6.

### The paint byte

One byte per ZIP, indexed by the ZIP read as a base-10 integer:

```
byte = (reliability_tier << 4) | (class_index + 1)

  bits 0-3   class index + 1, in 1..7.  0 => no data for this ZIP
  bits 4-5   reliability tier 0..3
  bits 6-7   reserved, always 0
```

The reliability nibble is **metric-invariant**: it always carries the ZIP's
median-sale-price tier, a property of the transaction sample rather than of
whatever is painted. That is what lets `paint.py` assert the paint table and the
snapshot agree, and it is why `reliabilityOf` takes no metric.

`FADE_EXEMPT` in `paint-table.ts` and the same set in `paint.py` must not drift.
Both are currently inert with respect to opacity (§5) and are retained for the
texture layer.

---

## 4. Break populations

Two different questions, deliberately not the same set:

- **Break population** — which ZIPs' values may set the class boundaries.
- **Classed population** — which ZIPs are assigned a class. Always every ZIP with
  a value.

`classify.compute` asserts `sum(class_counts) == non_null` per metric, which is
what makes conflating them impossible to ship.

The break population is **per scheme**, via `classify.break_population`:

| Metric family | Population | Why |
|---|---|---|
| Sample estimates (`median_sale_price`, `median_ppsf`, `median_dom`) | rankable only (`rel >= 1`) | A median over four sales is an estimate; letting it set a national boundary lets noise move everyone's colour. |
| Shares (`sold_above_list`, and the two panel-only ratios) | rankable only | A share **of** the sales inherits their sampling error. Four sales can only report 0/25/50/75/100%. |
| `months_of_supply` | rankable only | Inventory over the sales **rate**, so it derives from a sale count. |
| Exact counts (`COUNT_METRICS`) | every reporting ZIP | No sampling error exists to gate on, and the gate is a cut on `K / sqrt(n_sales)` — so gating a sale count on it means choosing the boundaries for "how many sold" by looking only at where a lot sold. |
| `zhvi_yoy` | n/a — fixed diverging scale | |

Measured effect of the correction, share of ZIPs in the lowest of seven classes on
the 2026-07 release:

| Metric | Gated (old) | Ungated (current) |
|---|---:|---:|
| `homes_sold` | 68% | 12% |
| `active_listings` | 70% | 13% |
| `pending_sales` | 69% | 11% |
| `new_listings` | 69% | 10% |
| `inventory` | 66% | 10% |

`classing[*].break_gate` records which rule each metric used, so the manifest says
what was done rather than the reader having to infer it.

---

## 5. Why reliability is not an opacity channel

Reliability drove `fill-opacity` — tier 0 at 0.38, the rest at 0.8 — until the
distortion was measured.

The ramp runs light to dark, so **lightness is the value channel**. Compositing a
fill over a near-white basemap also moves lightness. The two are therefore one
perceptual channel used twice, and the reader cannot separate them.

Compositing each ramp colour over Positron's `#FAFAF8` and converting to CIELAB,
with this ramp averaging 14.0 L\* per class step, the error an alpha introduces
on the darkest class, in class-step units:

| alpha | 0.38 | 0.62 | 0.75 | 0.85 | 0.92 | 0.95 |
|---|---:|---:|---:|---:|---:|---:|
| class steps | **3.90** | 2.43 | 1.59 | 0.94 | 0.49 | 0.30 |

Holding the artefact under half a class step needs every alpha at 0.92 or above,
which leaves 0.92–1.00 of usable range — too little to read as a deliberate signal
and exactly enough to be misread as a value difference. **No alpha band is both
visible as uncertainty and not confusable with value.**

The bias was systematic. Reliability tracks sales volume, which tracks urban
density, so the fade lightened rural ZIPs specifically — and
`classing.median_sale_price.selection_effect` measures those ZIPs as genuinely
cheaper (median $275,953 against $394,885). Both errors pointed the same way. Tier
0 is 72% of ZIPs and **78.5% of the drawn land area**.

Where reliability lives now: the hover popup, the detail panel, and the legend's
statement of which population set the scale. The intended fill-side channel is a
**texture overlay gated to zoom ≥ 6** — texture is orthogonal to lightness, which
is the property that made opacity unusable. Deferred, not cancelled.

---

## 6. Invariants, and what enforces each

| Invariant | Enforced by | Failure mode if removed |
|---|---|---|
| A stage never writes `public/data/` | stage receipts, `_require()` | A run passing weak validators overwrites known-good published data. |
| One colour ramp definition | `choropleth.generated.ts`, imported by map, legend and export | The legend shows colours the map never paints. |
| Paint table agrees with the snapshot | `paint.py` assertion before publish | The colour and the number disagree for the same ZIP. |
| `manifest.classes` == ramp length | `PaintTable.from` throws | The legend and the map disagree about what a colour means. |
| Publish decision is a digest, never a count | `manifest.content_digest`, `update_data.yml` | The old gate compared a key with no wire column, so it could never say "unchanged". A missing digest means CHANGED. |
| `map:sourceReload` == 0 | `setPaintPropertyCounted`, and the bench asserts it | Rewriting a data-driven paint value reloads every tile: 3375 ms per metric switch. |
| Bbox decodes to a sane span | `geom.assert_bbox_scale` (pipeline), `ZipTable.checkBounds` (client) | See below. |
| Metric keys match `KEY_ORDER` | positional wire format; golden fixtures on both sides | A wrong name silently reads the neighbouring column. |
| A LISA hold lasts one release | `spatial._apply_hysteresis` reads `manifest.spatial.held`; three-release tests | The published `lisa` column cannot tell a held class from a real one, so the hold comes back as `previous` next month and holds itself again. A ZIP that stopped being an outlier is drawn as one forever. |

### The bbox scale bug, recorded because both failure modes look identical

`geom.offsets` pre-multiplied by `1e4` and `serialize.COLUMNS` applied its declared
`1e4` on top, so the wire carried degrees × 1e8 under a header saying × 1e4.
`ZipTable.boundsOf` honoured the header and divided once, giving every ZIP a
bounding box roughly 1,500 degrees wide.

A box that size intersects every viewport, so `visibleZipRows` accepted every
loaded ZIP and **auto-scale silently scaled to loaded tiles rather than to the
view**. Nothing caught it because that is what auto-scale looks like when it
works. The sidecar exists to fix the opposite bug — a viewport filter using a
0.01° box around each centroid — and the correction overshot by four orders of
magnitude.

Both checks decode and compare against `MAX_SPAN_DEG = 10`, which is the widest
real ZCTA (8.3966°, Anchorage 99503) with headroom, and two orders of magnitude
below any plausible mis-scaling. Checking the **decoded** span is the point: it is
the same arithmetic the frontend does, so the two cannot disagree about what the
wire means.

---

## 7. Manifest keys the reader-facing page depends on

`src/pages/Methodology.tsx` reads every figure it prints from `manifest.json` at
runtime, so it cannot drift from the release that built the map. The cost is that
**removing a key removes a section**. These are load-bearing:

| Key | Section it drives |
|---|---|
| `redfin.period_begin`, `redfin.period_end`, `zhvi.period_end` | 1, sources |
| `classes` | 2, classification |
| `coverage.*` | 7, limitations |
| `noise.K`, `noise.K_lag`, `noise.K_lag_used`, `noise.plateau_ratio` | 3, statistical detail |
| `noise.K_by_sample_size`, `noise.per_metric` | 3, Tables 3 and 4 |
| `noise.tiers`, `noise.tier_n_implied`, `noise.rankable_*` | 3, Table 1 |
| `forecast.backtest.*` | **4 in full** — absent, the whole section disappears |
| `spatial.*` | **5 in full** — absent, the whole section disappears |
| `generated_utc` | footer |

Sections 4 and 5 are conditional on purpose: a release whose forecast or spatial
stage did not run should show nothing rather than an empty table.

`outlierCount()` in `src/lib/manifest.ts` reads `spatial.class_counts.LH` and
`.HL` for the legend's toggle label. `HH` and `LL` are published but not
displayed — see §8.

---

## 8. Why the cluster overlay shows only outliers

Local Moran's I sorts eligible ZIPs into five classes. Measured on the 2026-07
release:

| Class | ZIPs | Median size | Share of drawn area |
|---|---:|---:|---:|
| ns | 6,857 | 135 km² | 80.11% |
| LL | 1,203 | 153 km² | 13.10% |
| HH | 1,349 | 40 km² | 5.93% |
| LH | 20 | 48 km² | 0.60% |
| HL | 27 | 78 km² | 0.26% |

Two consequences. Global Moran's I at 8 neighbours is **0.7343** — price is
strongly clustered nearly everywhere — so HH and LL, which are 2,552 of the 2,599
significant ZIPs, restate what the choropleth underneath already shows. And HH
polygons are about a quarter the size of LL ones, so an overlay painting both laid
down twice as much blue as red and read as "everything is cheap"; the reported
symptom was exactly that.

The informative classes are LH and HL. There are 47, they are 0.86% of the area,
and under the old design they were two of four colours with no key anywhere. The
overlay is now those 47, drawn as circle markers on a client-built GeoJSON source
rather than as fills, with the choropleth left intact underneath.

---

## 9. Label points

`zips-labels` used to be a symbol layer reading `symbol-placement: "point"` off the
**polygon** source. A polygon crossing a vector-tile boundary is clipped into one
piece per tile and MapLibre places a symbol on each piece; multi-part ZCTAs get one
per part. A ZIP straddling a seam was drawn two to four times.

`text-allow-overlap: false` could not help: the copies sat at genuinely different
screen positions, so they never collided and collision detection had nothing to
suppress.

The layer now reads a client-built GeoJSON point source, one feature per ZIP,
rebuilt on `moveend` above zoom 9.5 from ZIPs whose **anchor** is in view. The
anchor is the snapshot's `lat`/`lng`, which `geom.py` sets from the mapshaper
`-points inner` point — guaranteed to lie inside the polygon, chosen because a
centroid of a C-shaped or multi-part ZCTA can land outside it. Filtering on the
anchor rather than the bbox keeps labels independent of the bbox columns, which
`ZipTable` will refuse to serve if they fail §6's check.

No tileset rebuild was needed. The alternative — a label-point layer inside
`us_zip_codes.pmtiles` — is structurally cleaner and needs no snapshot, but the
tileset is committed to git by decision, so it would add a permanent ~47 MB blob
to history for labels alone.

---

## 10. Benchmarks

`bench/run.mjs` measures load **and** interaction. The metric set is fixed and
versioned: every key in `METRIC_KEYS` and every id in `SCENARIO_IDS` is emitted on
every run, as `null` where the build or browser cannot supply it. A null and a zero
are different claims.

`SCHEMA_VERSION` lives in `bench/scenarios.mjs` (not `run.mjs`, which exits on
import without `--url`). Bump it on any change to either list or to what an
existing key means. `bench/compare.mjs` refuses to compare across a bump rather
than lining up two partially-overlapping sets and calling the difference a
regression — which is the guard the repo lacked when phase 0 and phase 3 stopped
being comparable.

Never quote a performance number that is not in `bench/results/`.

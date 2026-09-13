# Domapus — open work

**Open items only.** Finished work, rationale and the append-only agent log live in
`docs/CHANGES.md`. When something here is done, delete it from this file and record it
there. This file is the *progress*; `docs/FINAL-SPEC-08-2026.md` is the *plan*.

`[ ]` todo · `[~]` in progress · `[!]` blocked

---

## Conventions

**The spec is `docs/FINAL-SPEC-08-2026.md`, and it is deliberately untracked.**

- **One spec file. That exact name.** There is no `FINAL-SPEC.md`. An earlier agent recreated
  that older name, worked in it from a stale base, and silently reverted ~12 fixes before the
  fork was caught and merged (see CHANGES.md). If you find a second spec file, you are looking
  at a fork — merge it, do not adopt it.
- **Untracked on purpose.** It is a local working document, not a shipped artifact, and it
  churns far too fast to be worth reviewing in diffs.
- Because it is untracked there is **no git history and no recovery**. Back it up to the
  session scratchpad before any bulk edit. Every edit should assert a unique anchor match
  before applying — that is what caught the fork. (One snapshot exists by accident:
  `1249f88..d5b662f` carried the file. Use `git show 1249f88:docs/FINAL-SPEC-08-2026.md` if
  the working copy is ever lost.)
- `docs/CHANGES.md` and `docs/todos.md` **are** tracked. Keep them that way.
- `docs/ENGINEERING-LOG.md` is **not** tracked, same reasoning as the spec. Its history up to
  `50cc65b` is in git if an earlier version is ever wanted.
- `datap/` renamed to `temp-data/`.

---

## Phases 0-5 — LANDED. Rationale and measurements in CHANGES.md.

On `main` and pushed. Phases 4 and 5 are commit `477acd1`.

| | phase0 | phase1 | phase3 | **phase5** |
|---|---|---|---|---|
| LCP | 7352 ms | 7228 ms | 7012 ms | **6212 ms** |
| TBT | 5120 ms | 4053 ms | 2934 ms | **2695 ms** |
| metric switch | 3375 ms | 3190 ms | 1491 ms | **647 ms** |
| **bytes to first colour** | — | — | 2,570,348 B | **27,780 B** |

**phase0 and phase1 are not comparable.** Phase 1 took the latest period from 20,010
reporting ZIPs to 29,738 (+48.6%), so transfer moved for reasons unrelated to any
optimisation. Name the baseline in every claim.

**Never quote a performance number that is not in `bench/results/`.**

---

## Phases 6 and 7 — LANDED 2026-09-06. Rationale and measurements in CHANGES.md.

| | phase3 | phase5 | **phase7** |
|---|---|---|---|
| LCP | 7012 ms | 6212 ms | **6224 ms** |
| TBT | 2934 ms | 2695 ms | **2997 ms** |
| metric switch | 1491 ms | 647 ms | **564 ms** |
| bytes to first colour | 2,570,348 B | 27,780 B | **27,780 B** |
| tile transfer @ pinned view | — | 1,052,980 B | **1,426,268 B** |
| tileset archive | 92.6 MB | 92.6 MB | **46.9 MB** |
| ZCTAs present at z4 | 32,939 | 32,939 | **33,780** |

**Fixing the coverage bug cost bytes, and the claim must be stated that way.** Tile transfer
at the default view went UP 35%, because z4 now ships all 33,712 ZCTAs instead of dropping 841
and merging tiny ones into squares; the archive cut came from dropping z11/z12, zooms this
view never requests. TBT moved for the same reason. **Do not repeat §3.7's "1.9x page weight
after Phase 6" — it is wrong in sign for the tile component.** The defensible claims are the
deploy footprint (92.6 -> 46.9 MB) and the coverage fix itself.

`dist` is 198 MB (history 121, tileset 45, snapshot 11), under the 300 MiB guard.

## Phase 6 — closed

- **DECIDED 2026-09-06 (user): the tileset stays committed in git.** `public/data/us_zip_codes.pmtiles`
  is the 46.9 MB archive, tracked, and `deploy.yml` needs no download step. The cost accepted
  is that each geometry rebuild adds a permanent ~47 MB blob to history; geometry is a roughly
  annual job, so that is a slow clock. **Do not re-open this as a "cleanup" without asking.**
  §5.9's release path is not dead — `geometry.yml` still cuts a `geometry-vN` release when
  handed a tag, which is the escape hatch if repo size ever does become the problem.

---

## Decided 2026-09-12 and implemented. Rationale in CHANGES.md.

All five answered by the user in one pass; each landed the same session. Kept here only as
the short form of what was decided, because each one changes an invariant someone could
otherwise undo by accident.

1. **`computeQuantileBuckets` deleted.** It cut plain equal-count quantiles for every metric,
   which is the scheme mismatch `class-source.ts` documents. Auto-scale uses `fitBreaks`.
   `d3-scale` went with it — nothing else in `src/` imported it.
2. **Forecast tiers 0 and 1 collapsed.** Under 24 observations now gets no forecast. Tier 1
   was documented as a metro growth path that was never written, so a 12-23-observation ZIP
   would have been handed the ordinary shrunk AR(1) output under a weaker label.
3. **Empty classes are notched in the legend, not dropped.** The break stays as cut.
4. **Both halves of export identity.** The period is in the filename and, when the title is
   off, in the attribution row.
5. **Kaggle: shelved.** Redfin's terms are the answer; see below.

## Kaggle — CLOSED 2026-09-12. Do not re-open without new terms from Redfin.

**The terms were read, and they do not permit it.** Redfin's Terms of Use grant only "a
limited, personal, non-exclusive, non-transferable, non-sublicensable, revocable license to
access, view, and use the Services" (2.3.2), prohibit creating "derivative works based upon,
or attempt to commercially gain from your use" (2.3.3), and state the Terms "do not provide
you a license to use, reproduce, distribute, display or provide access to any portion of the
Services on Third Party Sites" (2.3.4). Redfin sells enterprise licensing separately for
large-scale commercial use.

**The distinction that matters.** Redfin explicitly welcomes *citing* the data — its support
documentation asks only for a citation and a link on first reference. That is what Domapus
does today, and it is squarely permitted. Uploading a dataset to Kaggle is the other thing:
redistributing the data itself on a third-party site, which is what 2.3.4 names.

**And the benefit was never large.** The honest case for Kaggle was discovery — reaching a
data-science audience that will not find a GitHub Pages map. That is a marketing channel, and
a "download the data" link on Domapus itself buys most of it, because the artifacts are
already public static files. To be interesting to a Kaggle audience the upload would have to
carry the full 173-period panel rather than one month, which is the maximal version of exactly
the redistribution the terms refuse.

Publishing only Domapus's *own* derived columns — the `rel` tier, `msp_rse`, `lisa`, the
forecast — would be a much weaker redistribution claim, since those are computed here rather
than copied. It is also much less useful without the levels they describe, which is the part
that cannot be shipped. That is the trade if this is ever revisited.

---

## Standing rule, not an open item

**±20% diverging bound is derived, never chosen.** `classify.derive_diverging_bound()`
recomputes it from the pooled ZHVI panel every run (p95 |yoy| = 18.85% over 6,137,683 lag-12
cells, share clamped 4.07%). It has rounded to 20 on every start window tested. If a release
ever produces a different bound, that is a regime change worth seeing, not a number to
override.

---

## Benchmark protocol

- [ ] Per phase, per spec §8.7: `node bench/run.mjs` on the built `dist/` at the pinned view,
      **before and after**, result into `bench/results/` and a line here.
- [ ] **Final full benchmark after the last phase lands**, same pinned conditions as the
      2026-08-29 baseline (slow4g / 4x CPU / 1440x900 / 5 runs / pinned view).

---

## Facts established — do not re-derive

### Publishing surfaces (measured 2026-09-06)

- **`gh-pages` is NOT at 800.70 MiB and the cleanup commit is obsolete.** `deploy.yml` uses
  `peaceiris/actions-gh-pages@v4` with `force_orphan: true`, which replaces the branch with one
  fresh commit per deploy. The branch is **1 commit, 119.88 MiB, no `pr-preview/`**. The prepared
  cleanup commit `a2e8476` is 7 commits and a **133.45 MiB** tree from 2026-08-29 — bigger and
  older. Pushing it would revert the live site and regrow the branch. **Do not push it.**
- The `data-2026-07` release exists and carries all seven `zip-data-*.json.gz` snapshots plus the
  123,065,811 B ZHVI vintage. `.gitattributes` is empty and `public/data/archive/**` is untracked,
  so **Phase 0.2 is finished** and the LFS pull per checkout has actually stopped.

### The feed (measured on all 4,930,000 rows, 2026-09-04)

| fact | value |
|---|---|
| rows | **4,930,000**, 0 ragged, 0 duplicate `(PERIOD END, REGION NAME)` |
| periods `P` | **173**, 2012-03-31 .. 2026-07-31, strictly descending |
| distinct ZIPs `Z` | **33,952** ever · **29,738** latest · 26,148 latest with `HOMES SOLD` |
| `FREQUENCY` / `REGION TYPE` / `LAST UPDATED` | uniform across all rows |
| MoM non-null cells | **0**. Redfin publishes no ZIP-level MoM, deliberately |
| window length | 92 d x2,857,977 · 91 x1,026,380 · 90 x733,207 · 89 x312,436 |

**Every constant derived from `171 x 24,619` is void.** `P` and `Z` are measured at S2 every
run and written to `manifest.panel`; do not carry a period count forward from any document.

### The statistics (measured 2026-09-05, shipped)

- **K = 0.5598** for `median_sale_price`; `median_dom` 1.4576; `avg_sale_to_list_ratio` 0.0749.
- **The rankable gate is `rse < 10%`, which is n >= 32** — not 30, which was only ever true at
  the dead feed's K. Derived per release as `manifest.noise.rankable_n_implied`.
  **9,456 of 25,603 reporting ZIPs (36.9%)** qualify.
- **Tier edges imply n >= 32 / 88 / 196**, not 30 / 81 / 182.
- **Selection effect:** rankable median price $394,884 vs excluded $275,953; bottom-class share
  **24.8% of thin ZIPs vs 5.5% of reliable ones** — four times the spec's estimate.
- **LISA gated (n = 9,456):** I = 0.7699 / 0.7343 / 0.6862 / 0.6363 at k = 4/8/16/32.
  `lisa_median_n_by_class` = ns 87 · HH 74 · LL 68 · LH 77 · HL 86, against the ungated
  HH 38 · ns 22 · LL 5 · LH 6 · HL 2. **Never quote the ungated figures.**
- **Forecast:** MASE 0.395 / 0.592 / 0.697 / 0.680; shipped band coverage 82.8 / 80.7 / 82.0 /
  87.9 against nominal 80. 83 origins ≈ **20 independent**.

### Geometry

- 2020 ZCTA count is **33,791** (not 33,120, the 2010 delineation). `zcta-meta.csv` has 33,771
  rows — a *derived* file, 20 short. Use 33,791 as the denominator for coverage percentages.
- `zcta-geom.csv`: **33,780 rows**, 2,058,046 B. Max lon extent **8.3966° at 99503**, which is
  83,966 at x1e4 and overflows int16 — bbox offsets must be **int32**. Post-territory-filter
  the tallest is 99701 at 2.7511°, which *fits* int16; do not let a later reader "optimise"
  latitude on the strength of that.
- **Median vertex spacing 292.9 m** over 5,624,668 segments after the 20 m simplify (p25 188.3,
  p75 472.2, p95 1,569.3). At z10 one CSS pixel is ~117 m, so the median segment is ~2.5 px.
  **Do not take the TIGER branch.**
- Sub-pixel share from true bboxes: z2 91.7% · **z3 62.1%** · **z4 31.4%** · z5 15.7% · z6 7.4%
  · z7 3.2% · z8 1.1% · z9 0.4% · z10 0.1%. Quote 62.1% (z3) and 31.4% (z4, default view).
- CRS is NAD83 geographic, not WGS84 — sub-2 m, immaterial here, but record it. The raw dataset
  bbox crosses the antimeridian (Adak AK to Guam), so any global-bbox or mean-centroid
  computation over *all* features is garbage. The territory filter drops 11 features
  (96799 + 7 Guam + 3 Northern Marianas); Puerto Rico and USVI are retained.

### Environment

- **Python 3.14 is `py -3.14`** (3.14.5); bare `python` is 3.13.5 and bare `pip` targets 3.14,
  which is how a wheel-less pin once slipped through. Use `py -3.14 -m pytest tests` and
  `py -3.14 -m pipeline` to match CI.
- Pins as shipped: `pandas==2.3.3` `requests==2.33.0` `pytest==9.1.1` `pyarrow==25.0.1`
  `numpy==2.5.2` `scipy==1.18.1` `statsmodels==0.15.0`. **K was derived under numpy 2.5.2** —
  do not bump it without refitting. Every pin needs a cp314 wheel; CI installs with
  `--only-binary=:all:` so a wheel-less pin fails immediately.
- **Do NOT add** `geopandas` / `libpysal` / `esda`. Not for wheel reasons (that claim is false)
  — because Local Moran's I is ~40 lines of numpy and is more explainable hand-written, and
  because KNN weights are right on their merits: ZCTA islands produce zero-neighbour units for
  which contiguity-based Moran's I is undefined.

### Dataset choice — CONFIRMED, do not reopen

`housing_market/monthly/all_zips.csv`. The other four ZIP-level families are `property_types`
(2.86 GB, reintroduces the aggregation bug), `zips_in_top_50_metros` (364 MB, coverage loss),
and `price_drops` / `delistings_relistings` / `contract_cancellations` (0.56-0.67 GB each, all
publishing 16 days behind `housing_market`, so a shared staleness contract would false-trip).
`housing_market/zip_lookup.csv` is 403.

Timeline, verified online: the new Data Center launched 2026-05-12, the old feed kept publishing
for three more weeks and stopped 2026-06-02 — no deprecation notice, no 404.

---

## Change detection and the publish gate — LANDED 2026-09-06. Rationale in CHANGES.md.

Verified by a full offline run: 33,771 ZIPs, **0 moved, 0 cells**, where the old code
reported a constant 28,919. Content correctly reported CHANGED, because the `zhvi_yoy`
paint table moved (the symmetric diverging scale, now published).

`[ ]` **Acceptance-test the `update_data.yml` changes on a dispatch before trusting them.**
Three of the four are step-ordering or `if:` guards that CI cannot exercise, and
`update_data.yml` has not been dispatched since they landed:
- the `Did upstream change?` short-circuit (dispatch with nothing changed upstream),
- the `sha256sum -c` paint verification (should pass; corrupt a table locally to see it
  fail — done locally, not in CI),
- `git add -A public/data/paint` staging last month's hashed files as deletions.

**The `sha256sum -c` check lives in `update_data.yml`, not `deploy.yml`.** An earlier note
here said `deploy.yml`; it has no such step. Deploy trusts what the data run committed. So a
hand-committed `public/data/paint` bypasses the verification entirely.

---

## Export - LANDED 2026-09-12. Measurements and rationale in CHANGES.md.

The export takes the pipeline's published class boundaries instead of cutting 14 plain
quantiles of its own, paints through the live map's `match` expression instead of a `step`
that MapLibre rejected on 670 of 869 metros, draws preview and file from one set of layout
numbers, and keeps its legend and insets off the data (measured: 0 ZCTAs covered, down from
164 under the legend and 8 under the Hawaii inset). Open follow-ups:

- [ ] **Export memory, MEASURED 2026-09-12 on the dev host. The estimate was right; the
      question of whether a phone survives it is still open.** Chrome, national view,
      `median_ppsf`, title and legend on:

      | | |
      |---|---|
      | JS heap before opening the dialog | 54.8 MB |
      | JS heap with the dialog open | 196.0 MB (**+141.2**) |
      | main export map GL canvas | 3402 x 2148 = 7.31 Mpx = **29.2 MB** at 4 B/px |
      | two inset canvases | 648 x 504 each = 2.6 MB total |
      | live map behind the dialog | 1280 x 880 = 4.3 MB |
      | all canvas backing while open | **34.7 MB**, of which ~30.4 is the dialog's |
      | transient full export canvas | 3600 x 2700 = **38.9 MB**, only during the export call |

      So peak is roughly **196 MB of heap plus ~74 MB of canvas**. `EXPORT_SCALE = 3` is what
      buys `drawImage` a 1:1 copy instead of a 1.51x upscale, and the earlier "~30 MB" note was
      accurate for the persistent GL backing store.

      **What is still unknown is the only part that matters.** A desktop measurement cannot
      tell you whether a phone with a few hundred MB of per-tab budget loses the WebGL context
      here, and memory pressure is not something the harness can emulate. This needs a real
      low-end device, or a decision to drop `EXPORT_SCALE` to 2 (a 1.51x upscale, ~13 MB
      instead of 29) and accept the softer image.

---

## UI/UX pass — LANDED 2026-09-12. B1-B9 all shipped; rationale in CHANGES.md.

Plan and the measurements behind it: `docs/UIUX-PLAN.md`. The batch record below is kept
only because it is the **schema-2 bench baseline**: `bench/results/uiux.json`, gitSha
bca751e, slow4g / 4x CPU / 1440x900 / 5 runs, pinned view.

  | | phase7 (schema 1) | uiux (schema 2) |
  |---|---|---|
  | LCP | 6224 ms | 6480 ms |
  | TBT | 2997 ms | 3997 ms |
  | transfer | 5.52 MB | 5.49 MB |
  | bytes to first colour | 27,780 B | 28,255 B |
  | metric switch | 564 ms (wall clock) | 40 ms (app measure) |
  | map:sourceReload | not measured | 0 |

  **THIS TABLE IS NOT A COMPARISON AND `compare.mjs` WILL REFUSE TO PRINT IT.** Three things
  moved at once: the metric set (schema 1 -> 2), the definition of `metricSwitchMs` (wall
  clock -> the app's own `map:metricSwitch` measure, which is why it drops two orders of
  magnitude), and the server (`serve.mjs` did not gzip `.u8`, so every earlier local run on
  port 4319 overstated gating bytes ~3.8x). Bytes is the only near-like-for-like row, and
  the +475 B is the manifest gaining `break_gate` and `bottom_class_share`.

  TBT drifted upward across runs within one session on this host (2804 -> 4426 in the first
  pass) while LCP stayed flat. That is host load, not the app. Treat TBT from this session
  as soft.

  Interaction rows, median of 5, as dropped frames / worst frame: pan.z4 60 / 383 ms ·
  pan.z7 49 / 200 ms · pan.z10 74 / 183 ms · zoom.in 18 / 333 ms · zoom.out 13 / 117 ms ·
  hover.sweep 54 / 267 ms · click.sidebar 3 / 267 ms · metric.cycle 55 / 633 ms ·
  search.flyTo 47 / 250 ms · toggle.autoScale 95 / 333 ms · toggle.outliers 89 / 150 ms.

  **pan.z4 and the two legend toggles are the worst rows, and are where an interaction fix
  should start.** There is no prior number for any of them, so these are the first.

### Open after this pass

- `[ ]` **Deferred, not cancelled: the reliability texture overlay.** A diagonal hatch on
  tier-0 ZIPs, gated to zoom >= 6, via a runtime-generated canvas pattern and one extra fill
  layer whose `fill-opacity` is a constant `case` on the existing `rel` feature-state.
  Texture is orthogonal to lightness, which is the property that made opacity unusable.
- `[ ]` **Re-baseline the bench at 14 classes.** `bench/results/uiux.json` is a valid
  schema-2 baseline, but it was taken at gitSha `bca751e` — seven classes, before the colour
  work. Any interaction comparison against it now straddles a palette change. Same pinned
  conditions. Do this before touching `pan.z4` or the legend toggles, or the fix has nothing
  honest to be measured against.

### Measured facts this pass depends on — do not re-derive

- `noise.tiers` = {0: 24315, 1: 5109, 2: 3515, 3: 832}. Tier 0 is 72.0% by count and
  **78.5% of drawn land area**.
- Opacity over Positron `#FAFAF8`, lightness error in class-step units (ramp averages 14.0 L*
  per step): a=0.38 -> 3.90, 0.62 -> 2.43, 0.75 -> 1.59, 0.92 -> 0.49, 0.95 -> 0.30. No alpha
  band is both visible as uncertainty and not confusable with value. That is why opacity is
  1.0 and the channel moved.
- `classing.median_sale_price.selection_effect`: faded ZIPs median $275,953 vs $394,885
  ranked. The fade and the class assignment skew the same direction.
- Bottom-class share **before B7**: sold_above_list 74%, active_listings 70%, homes_sold 68%;
  price and time metrics 13-21%. **Those numbers are superseded — do not quote them.** As
  shipped 2026-09-12: sold_above_list 33.8%, active_listings 0.0%, homes_sold 0.0%,
  median_sale_price 10.6%, median_ppsf 12.7%, median_dom 9.1%, months_of_supply 7.1%,
  zhvi 7.3%, zhvi_yoy 0.2%.
- LISA area share: ns 80.1%, LL 13.1%, HH 5.9%, LH 0.60%, HL 0.26%. HH polygons are median
  40 km2 against LL's 153 km2, which is why only blue is visible. Moran's I at k=8 is 0.7343,
  so HH/LL largely restates the choropleth. LH+HL is 47 ZIPs. This is B8.
- **Bbox decode bug (fixed in B1, published 2026-09-12).** `geom.offsets()` multiplied by 1e4
  and `serialize` applied the declared 1e4 scale again, so the wire value was degrees x 1e8.
  Verified against the shipped `public/data/zip-data.json`: max `be - bw` is 83,966 raw, which
  at the declared 1e4 scale is **8.3966 deg** — exactly the figure `geom.py` cites for
  Anchorage 99503. `ZipTable.checkBounds` no longer has anything to log and auto-scale runs on
  real bounds.

---

## Open question: the count and time metrics are unmarked noise

`median_dom`, `months_of_supply`, `homes_sold` and `active_listings` read as camouflage
because at ZIP level they largely are noise — two thirds of the way to random, measured
above. The scale is honest; what is missing is that a 3-sale ZIP's median DOM paints at
full strength beside a 300-sale ZIP's. The rankable gate keeps thin ZIPs from SETTING the
breaks but still paints them, and the fill has carried no reliability channel since the
opacity fade was removed (it was a lightness signal on a lightness ramp). The deferred
texture overlay in `choropleth-painter.ts` is the intended fix. 14 classes makes the
speckle more visible without making it more or less honest.


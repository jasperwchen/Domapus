# Domapus — open work

**Open items only.** Finished work, rationale and the append-only agent log live in
`docs/AGENT-LOG.md`. When something here is done, delete it from this file and record it
there. This file is the *progress*; `docs/FINAL-SPEC-08-2026.md` is the *plan*.

`[ ]` todo · `[~]` in progress · `[!]` blocked

---

## Conventions

**The spec is `docs/FINAL-SPEC-08-2026.md`, and it is deliberately untracked.**

- **One spec file. That exact name.** There is no `FINAL-SPEC.md`. An earlier agent recreated
  that older name, worked in it from a stale base, and silently reverted ~12 fixes before the
  fork was caught and merged (see AGENT-LOG). If you find a second spec file, you are looking
  at a fork — merge it, do not adopt it.
- **Untracked on purpose**, and as of 2026-09-05 that is finally true. This bullet used to
  claim `.gitignore:129` was `docs/FINAL-SPEC*.md`. **There was no such rule.**
  `docs/FINAL-SPEC.md` was tracked, a previous session staged a `git mv` to the dated name, and
  Phase 1's `git add -A` committed it in `1249f88`. Now untracked (`git rm --cached`) and the
  rule genuinely exists at the end of `.gitignore`. It is a local working document, not a
  shipped artifact, and it churns far too fast to be worth reviewing in diffs.
- Because it is untracked there is **no git history and no recovery** going forward. Back it up
  to the session scratchpad before any bulk edit. Every edit should assert a unique anchor match
  before applying — that is what caught the fork. (One snapshot does exist by accident:
  `1249f88..d5b662f` carried the file. Use `git show 1249f88:docs/FINAL-SPEC-08-2026.md` if the
  working copy is ever lost.)
- `docs/AGENT-LOG.md` and `docs/todos.md` **are** tracked. Keep them that way.
- `docs/ENGINEERING-LOG.md` is **not** tracked (untracked 2026-09-05, same reasoning as the
  spec: a local working document that churns too fast to review in diffs). Its history up to
  `50cc65b` is in git if an earlier version is ever wanted.
- datap/ renamed to temp-data/
---

## Phases 1-3 — LANDED 2026-09-05. Rationale and measurements in AGENT-LOG.

Three commits on `main`, not pushed:

- `1249f88` feat(pipeline): migrate to the new Redfin feed and assert the grain
- `f1542ed` feat(pipeline): add the diff gate and fix the deploy that never fired
- `b57dbee` perf(map): stop reloading every tile on a metric change

Benchmarks, slow4g / 4x CPU / 1440x900 / 5 runs / pinned view:

| | phase0-baseline | phase1-after | phase3-after |
|---|---|---|---|
| LCP | 7352 ms | 7228 ms | 7012 ms |
| TBT | 5120 ms | 4053 ms | 2934 ms |
| transfer | 4,793,964 B | 5,247,137 B | 5,247,137 B |
| heap | 62.4 MB | 64.1 MB | 55.9 MB |
| metric switch | 3375 ms | 3190 ms | 1491 ms |

**phase0 and phase1 are not comparable.** Phase 1 took the latest period from 20,010
reporting ZIPs to 29,738 (+48.6%), so transfer moved for reasons unrelated to any
optimisation. Name the baseline in every claim.

### Still owed on these phases

- [x] **Acceptance-tested the `workflow_call` deploy — PASSED 2026-09-05**, run 33986134801:
      `update-data -> success`, **`deploy / deploy -> success` in the same run graph**,
      `notify -> skipped`. The deploy job's own report confirms the plumbing:
      `ref input : ''` (empty, a forced redeploy with no data commit) ->
      `deploying : 7880a47` (the `github.sha` fallback) -> `period_end: 2026-07-31`.
      Reproduce any time with `gh workflow run update_data.yml -f force_deploy=true`.
- [ ] Run `bench/verify-choropleth.mjs` against the deployed site, not only a local build.
      **How:** `BENCH_URL='https://jasperwchen.github.io/Domapus/?lat=39.5&lng=-98.35&zoom=4&metric=zhvi' node bench/verify-choropleth.mjs --cpu 4`
      It exits non-zero if a metric switch causes any tile request or if
      `map:sourceReload` is not 0.
- [ ] Methodology copy still owed from Phase 1: the `sold_above_list` and `median_list_price`
      series breaks, and why ZHVI has MoM but no Redfin metric does.

### Deviations from the spec, decided during implementation

- **Phase 1 ships Redfin's PUBLISHED YoY**, with the `/100` correction for `median_dom` and
  `months_of_supply`. It does NOT recompute YoY from levels (spec section 4.3's rule).
  Phase 1's own Verify criteria test the divided-published path and section 9 assigns "YoY at
  lag 12" to Phase 5. The panel is what makes that swap cheap.
- **The spec's `RANGES` rejected real rows on six columns.** Bounds are now measured against
  the full 4,930,000-row file and commented with the measurement.
- **The diff-gate threshold is 0.281, not the spec's "near 0.05".** A normal month moves 14.1%
  of ZIPs by more than 25%. The gate still catches the property-type bug, at a 1.2x margin
  rather than the 6x the spec predicted.
- **`CHUNK` is 50,000, not 8,000.** `setFeatureState` costs 0.14 us, so the full ZIP set is
  ~5 ms; chunking at 8,000 spent five frames waiting rather than working.
- **Staleness warns, never hard-fails**, because a hard fail refuses to publish and the
  manifest carrying the outage banner would never be written.

---

## Blocked on user

- [!] Push the gh-pages cleanup commit — 800.70 / 1024 MiB Pages limit
      `git push origin a2e8476913cbeb9f479f4d622ffb133fd8b0a2ce:gh-pages`
- [!] Close the 5 open Renovate PRs (outward action on a public repo)

---

## Redfin feed migration — DONE 2026-09-05

`pipeline/` replaces `scripts/update_market_data.py`. Verified on the real 1.33 GB file:
4,930,000 rows, 173 periods, 33,952 ZIPs, 0 duplicate `(PERIOD END, REGION NAME)`.
Full record in AGENT-LOG. One item did not ship with it:

- [ ] Methodology copy: the `sold_above_list` and `median_list_price` series breaks, and why
      ZHVI has MoM but no Redfin metric does

## Phase 0 — finish it

- [ ] **0.2 is half done.** `lfs: true` is gone from both workflows, but `.gitattributes` still
      carries `public/data/archive/** filter=lfs` and all six archive files are still tracked,
      so the 14.45 MiB LFS pull per checkout has not actually stopped.
      **Do not untrack until the releases exist — see the archive ordering below.**
- [x] **0.3 DONE.** `pipeline/__main__.py` downloads into `tempfile.mkdtemp(dir=RUNNER_TEMP)`
      inside a `try/finally` that removes it. `temp-redfin/`, `temp-data/` and
      `public/data/temp-geo/` are now gitignored, so a killed run leaves nothing `git add -A`
      would stage.

## Archive — blocking order, do NOT reorder

`gh release list` is **empty**. There are no releases at all, so deleting the archive today
destroys the only copy of six monthly snapshots.

1. [ ] Create the `data-YYYY-MM` releases; upload the 6 existing archive files
2. [ ] Verify each asset downloads and its sha256 matches
3. [ ] Only then: `git rm --cached public/data/archive/**` + drop the `.gitattributes` LFS rule

---

## IN PROGRESS — Phase 4 + Phase 5 implementation (2026-09-05)

### Pipeline — LANDED and verified on the real 1.33 GB file

Full run: `py -3.14 -m pipeline --skip-probe --redfin-csv temp-redfin/redfin_data_center-housing_market-monthly-all_zips.csv --zhvi-csv temp-data/Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv`

- [x] P4.1 `requirements.txt`: `numpy==2.5.2`, `scipy==1.18.1`, `statsmodels==0.15.0`
- [x] P4.2 `pipeline/geom.py` — 33,780 bboxes; **all 33,771 snapshot ZIPs get a real
      polygon anchor**, zero centroid fallbacks
- [x] P4.3 `pipeline/noise.py` — **K = 0.5598** (lag 3, plateau 1.037)
- [x] P4.4 `pipeline/classify.py` — 9 painted columns over 9,456 rankable ZIPs
- [x] P4.5 `pipeline/paint.py` — 9 tables, **max byte 0x37 on every one**, cross-artifact
      assertion passes
- [x] P4.6 `pipeline/serialize.py` — 50 columns column-major, round-trip passes
- [x] P4.7 `pipeline/__main__.py` — S5/S6/S7 wired, manifest carries noise/classing/assets
- [x] P5.1 `zhvi.py` writes `build/zhvi-panel.parquet` — 319 x 26,269 = 6,456,323 rows
- [x] P5.3 `pipeline/changes.py` — YoY recomputed at lag 12 + reconciliation contract

**Headline claim MEASURED: 2,568,236 -> 23,638 B gzip = 108.6x** (spec predicted 104x).
New snapshot 12.4 MB raw / 2.49 MB gz, and off the critical path.

### Measurements that CORRECT the spec — do not quote the old numbers

- **K = 0.5598, not 0.5395.** The old value was the dead feed's. Lag sweep
  `0.2369 0.4063 0.5598 0.5805 0.5989 0.6077 0.6050`; the lag-1 attenuation story
  reproduces (predicted 0.5598*0.43 = 0.241 vs measured 0.2369). K by sample size
  0.5176..0.6240 across a 200x range of n, thin buckets highest, as the spec says.
- **The rankable gate is `rse < 10%`, which is now `n >= 32`, not `n >= 30`.**
  `n >= 30` was only ever true at K = 0.5395. `noise.py` derives it and reports
  `rankable_n_implied`. **9,456 of 25,603 reporting ZIPs (36.9%)** are rankable —
  not 8,544 of 20,010 and not the 9,781 the spec's paint-table experiment used.
- **Diverging bound B = 20 CONFIRMED by derivation**, on 6,137,683 finite lag-12
  ZHVI cells: p95 |yoy| 18.85, p97.5 22.72, share >20% 4.07%. Start windows
  2000+/2012+/2016+ give 18.85/18.02/18.60, all rounding to 20.
- **Redfin publishes a +30,993,016% YoY.** ZIP 12207 had a $1 median sale price in
  2025-07. It does not fit int32 at scale 100. `changes.py` nulls a ratio YoY whose
  base is below that metric's own `RANGES` floor; 4 cells suppressed this release.
- **The YoY reconciliation contract needed a propagated tolerance, not a flat one.**
  We recompute from PUBLISHED (rounded) levels; Redfin used unrounded ones, so the
  base's quantisation propagates as `(|yoy|+100) * quant / base` — half a cent on a
  $1.01/sqft base is 41 pp on an 8,400% change. With that: median_sale_price 0 of
  23,738 exceed, median_list_price 1 of 25,625, median_list_ppsf 42 of 25,570,
  median_ppsf 62 of 23,673. Survivors are ZIPs whose base Redfin has RESTATED
  (31905's published YoY implies a 2025-06 level of 491,058.7 vs the 492,250.0 now
  in the file). Contract is therefore a SHARE (gate 1%, worst measured 0.262%).
- **`homes_sold` is never 0 in this feed** — it is null instead. The round-trip's
  null-vs-zero probe now scans for a column with both rather than assuming `hs`;
  it picks `dom`.
- **Section 6.6 assigns no scheme to three painted metrics.** `active_listings`,
  `median_dom` and `months_of_supply` appear in none of its four families. All
  three are right-skewed positives with no anchor value, so they join `quantile`.
- **"Equal interval anchored at 100%" is implemented as a 100-pinned grid whose
  width comes from p1..p99**, not as equal intervals over [0, 100]. The literal
  reading collapses `sold_above_list` into two colours — the exact failure section
  6.6 rejects elsewhere.

### Frontend — LANDED. `npx tsc -b` clean, 84 vitest pass, 37 pytest pass.

- [x] P4.8 `paint-table.ts`, `zip-table.ts`, `snapshot.ts`, `manifest.ts`
- [x] P4.9 worker is a fetch pipe posting Int32Array buffers on a TRANSFER LIST
- [x] P4.10 `HousingDashboard` on `ZipTable`; `isIndexReady` and its three effects
      gone; `spatial-index.ts`, `rbush`, `@types/rbush`, `LegacyClassSource` deleted
- [x] P4.11 `index.html` + `vite.config.ts` — paint map inlines at build time,
      both fetches start in one tick. VERIFIED in `dist/index.html`.
- [x] P4.12 PrintStage renders insets at 400x260 (was 224x144 upscaled), Alaska
      bounds widened to [[-168, 54.5], [-130, 70]], stale comment gone
- [x] P4.13 `src/lib/__tests__/golden.test.ts` — fixtures cut from the REAL build,
      both cross-artifact assertions pass across languages
- [x] P5.2 per-metric K -> `dom_rse`
- [x] P5.4 `pipeline/forecast.py`
- [x] P5.5 `pipeline/spatial.py`
- [x] ACTIVE_LISTINGS fade carve-out

**The carve-out is in feature-state, NOT in the paint expression.** A second
opacity expression swapped in on a metric change calls `setPaintProperty` on a
value MapLibre has seen as data-driven, which marks the source `reload` and
re-parses every tile — the exact 3375 ms regression Phase 3 removed. A
fade-exempt metric's class source reports every ZIP as tier 3 instead, so the
expression is still set once and never rewritten.

### Phase 5 results — measured 2026-09-05, all on the migrated feed

**Forecast** (83 origins, quarterly, expanding window; 41 calibrate / 42 evaluate;
effective independent ~20 because h=12 windows overlap by nine months):

| method (nominal 80%) | h=1 | h=3 | h=6 | h=12 |
|---|---|---|---|---|
| random-walk `sigma*sqrt(h)` | 81.3 | 44.0 | 30.2 | 24.7 |
| AR(1) own closed form | 89.4 | 78.2 | 75.8 | 78.6 |
| **empirical quantiles (shipped)** | **82.8** | **80.7** | **82.0** | **87.9** |

MASE 0.395 / 0.592 / 0.697 / 0.680 — AR(1) beats naive at every horizon.
Median rho 0.789. 26,261 ZIPs forecast; tiers {3: 25,019, 2: 1,250}.

**LISA, gated on `rel >= 1` (n = 9,456).** Moran's I is k-dependent —
**0.7699 / 0.7343 / 0.6862 / 0.6363** at k = 4/8/16/32. Classes:
ns 6,857 · HH 1,349 · LL 1,203 · LH 20 · HL 27. Median 8th-neighbour 15.6 km.
Bonferroni threshold 5.29e-6 is UNATTAINABLE at 999 permutations (would need
189,119), which is the arithmetic that justifies FDR.

**The gate did what it was supposed to do.** `lisa_median_n_by_class` ungated was
HH 38 · ns 22 · LL 5 · LH 6 · HL 2 — a low-sample detector. Gated it is
**ns 87 · HH 74 · LL 68 · LH 77 · HL 86**: the outlier classes are no longer
distinguishable by sample size, so the 27 HL and 20 LH survivors are real.

**Per-metric K**: `median_dom` 1.4576, `avg_sale_to_list_ratio` 0.0749, against
`median_sale_price` 0.5598. Reusing one K across them would have been wrong by
2.6x and 7.5x respectively.

- [x] P5.6 LISA overlay layer, `+-x% (n sales)` in the popup, reliability caveat in
      the legend, forecast disclaimer, `/methodology` page (reads every figure from
      `manifest.json` at runtime — a hand-copied methodology page drifts)

### BENCHMARK — `bench/results/phase5-after.json`, 3 runs, slow4g / 4x CPU / 1440x900

| | phase3 baseline | phase5-after | |
|---|---|---|---|
| **Bytes before first colour** | **2,570,348 B** | **27,780 B** | **92.5x** |
| Metric switch | 1848 ms | 647 ms | 2.9x |
| LCP | 7240 ms | 6212 ms | -14.2% |
| TBT | 3914 ms | 2695 ms | -31.1% |
| Long task count | 26 | 18 | -30.8% |
| Transfer | 5.01 MB | 5.17 MB | +3.1% WORSE |
| Requests | 41 | 45 | +9.8% WORSE |
| JS heap | 56.0 MB | 63.7 MB | +13.8% WORSE |
| CLS | 0.001 | 0.004 | worse, but both far under the 0.1 threshold |

`class:assign` (48 ms) and `class:breaks` (94 ms) are **gone** — the pipeline does
that work now. `store:construct` is 5 ms.

The three regressions are honest and expected: the snapshot went 38 -> 50 columns
so it is bigger, and the manifest and paint table are two more requests. None of
them is on the path to first colour any more.

**`GATES_FIRST_COLOR` in `bench/run.mjs` changed with the architecture**, which is
the metric working rather than cheating: the snapshot no longer gates paint, so
counting it would report 2.5 MB and claim the phase changed nothing.
`gatingBytesLegacy` still reports it under the old definition.

### Four bugs found by running the real app, not by tests

1. **The painter's write-skip cache keyed on the class index alone.** Reliability
   used to be metric-invariant on the client too, so `k` was the only thing that
   could differ between epochs. It is not any more — ACTIVE_LISTINGS is exempt
   from the reliability fade and expresses that by reporting every ZIP as tier 3 —
   so a ZIP whose class happened to match under both metrics kept the previous
   metric's tier and stayed faded on a map that must not fade anything. Now keyed
   on both, with a regression test.
2. **The map never initialised if its container measured 0x0 at mount.** `tryInit`
   gives up at zero size and the ResizeObserver only ever resized a map that
   already existed, so it never retried. Symptom: permanently blank map, no
   canvas, no style request, no error anywhere — and intermittent, because it came
   down to layout timing. Pre-existing; surfaced because the new load order
   changes when the container settles.
3. **`loadedZips()` threw when called before the `zips` source existed.** It is
   called from the map's own `load` handler, which fires when the STYLE is ready —
   the source is added later. Guarded.
4. **`<link rel="preload" as="fetch">` needs `crossorigin` even same-origin.**
   Without it the preload and the fetch land in different cache entries and the
   file downloads twice: measured 27,780 -> 55,560 B before first colour. The
   obvious repair (`credentials: 'omit'` on the fetch) makes it worse, because
   `crossorigin` means credentials mode SAME-ORIGIN, not omit.

### Still to do

- [ ] **Publication is staged but NOT committed** (user's call). `public/data/` now
      holds the new snapshot, manifest and `paint/`; `public/data/zip-data.json`,
      `manifest.json` and `last_updated.json` show as modified and `paint/` as
      untracked. The build inlines the paint map from `public/data/manifest.json`,
      so reverting them makes the frontend fall back to a runtime manifest fetch.
- [ ] `docs/FINAL-SPEC-08-2026.md` still quotes the dead-feed K (0.5395), `n >= 30`,
      and the ungated LISA figures in several places. The spec is the plan; these
      measurements supersede it.
- [ ] The forecast's tier-1 rung (metro growth path for 12-23 observations) is
      reported but never exercised — every ZHVI ZIP has >= 24 months, so the branch
      is untested against real data.

---

## Phase 4 — spec boundary corrected 2026-09-05, now implementable

`noise.py` and `classify.py` **moved from Phase 5 into Phase 4**. Reason: the paint byte is
`(reliability_tier << 4) | (class_index + 1)` and §9 had assigned both fields to Phase 5, so
Phase 4 as written emitted a file whose every byte was undefined while §7.6 claimed `PaintTable`
was the class authority "Phase 4 onward". They are also the two Phase 5 modules needing no new
dependency beyond numpy — `calibrate_K` reads `median_sale_price` and `homes_sold`, both already
in `build/panel.parquet`. Phase 4 18 h -> 26 h, Phase 5 34 h -> 26 h.

Phase 5 keeps forecasting, LISA, YoY at lag 12, the methodology page, and the reliability-fade UI.
Its only new dep is `statsmodels` (test-only). **Not `libpysal`/`esda`** — §6.11 rejects them on
the merits and LISA is ~15 lines of numpy. The P3 bullet below said otherwise; it is corrected.

- [x] Settle the Phase 4/5 boundary in the spec (§9 both entries, §7.6 rationale, §9.1 hours,
      §6.6's `[VERIFY in Phase N]` marker, the panel paragraph, new §4.3 reserved-column table).
- [ ] **Declare `numpy` in `requirements.txt`** — P3's "added when something actually imports
      them" rule fires here: `noise.py` is that something. Must be **>= 2.3.2** for the cp314
      wheel. Note the working tree is numpy 2.2.4 / pyarrow 19.0.1 on Python 3.13.5 while CI is
      3.14 on pyarrow 25.0.1, so **`K` must be derived under `py -3.14`**, not bare `python`, or
      a 3.13-only constant gets committed.
- [x] **`public/data/zcta-geom.csv` BUILT 2026-09-05.** 33,780 rows, 2,058,046 B, uncommitted.
      Reproduce with `bash scripts/geometry/build_sidecar.sh`. Assertions run and passing: A2
      (all 5-char, unique), A5 (all offsets finite, in range, `be > bw`, `bn > bs`), plus the
      anchor is inside its own bbox for all 33,780 and 2,583 leading-zero ZIPs survived the CSV
      round trip. Max lon extent **8.3966 deg at 99503**, matching the spec's [M] exactly.
      **mapshaper is NOT installed** — the earlier todos claim was wrong; `npx` was fetching it
      on demand. The script pins `mapshaper@0.7.58` via `npx --package`. If the geometry step is
      meant to be reproducible, pin it in `package.json` devDependencies instead.
- [ ] **Nothing below is committed** (user's call, 2026-09-05). Untracked/modified right now:
      `public/data/zcta-geom.csv`, `scripts/geometry/build_sidecar.sh`,
      `bench/results/phase3-gating-baseline.json`, and edits to `bench/run.mjs`,
      `bench/compare.mjs`, `docs/todos.md`. The spec is untracked by design — **back it up before
      any bulk edit; there is no recovery.**
- [ ] `bench/run.mjs` gains `bytesBeforeFirstPaint`, baseline recorded BEFORE the phase lands.
      The harness collects `transferTotal` and `byKind` today, neither of which stops at first
      colored pixel, so Phase 4's headline claim is currently unmeasurable.
- [ ] `pipeline/noise.py` -> `rel`, `msp_rse`
- [ ] `pipeline/classify.py` -> breaks, anchors, `sum(class_counts)` assertion (closes §12 #12)
- [ ] `paint/<metric>-<hash>.u8` + cross-artifact assertion
- [ ] Snapshot 38 -> 50 columns, short names, dicts + scales + null sentinel; four statistics
      columns ship all-null-but-declared (§4.3 reserved-column table). Breaking wire change:
      pipeline, worker, `types.ts` and the frontend all move in one commit.
- [ ] Delete `spatial-index.ts`, `rbush`, `LegacyClassSource`
- [ ] **Export inset — reassigned here.** The spec told Phase 3 to do this and Phase 3 did not.
      `INSET_W/H = 400/260` (`PrintStage.tsx:311`) is the destination slot for `ctx.drawImage`;
      the offscreen map is still `w-56 h-36` = 224x144 (`:654,664`) and gets upscaled into it.
      Render at 400x260, widen `ALASKA_DEFAULT_BOUNDS` (`:34`) back toward the full state, delete
      the stale "we don't want to rebuild the tileset" comment (`:27-33`). Frontend-only.

## Phase 5 — one hard prerequisite, found 2026-09-05

- [ ] **`zhvi.py` must write `build/zhvi-panel.parquet` before any forecasting work starts.**
      §6.7 forecasts `zhvi` and §6.9 backtests "82 origins over the **ZHVI** panel" across 319
      monthly columns. `build/panel.parquet` is **Redfin only**, so "the panel unblocks Phase 5"
      is true for noise/classing and **false for forecasting**. `zhvi.py:process()` reads all 319
      date columns and returns three — the same defect `update_market_data.py:134` had for Redfin.
      ~26,270 ZIPs x 319 months. Pair with §12 #9 (archive each ZHVI vintage), because Zillow
      overwrites history in place and the backtest is optimistic until real vintages accumulate.
- [ ] §6 still carries dead-feed numbers in six places (§12 #21 is the parent item): the coverage
      row (`20,010 latest / 24,572 ever`), the history row (`171 overlapping windows`), the LISA
      gate size (`8,544 of 20,010`), and both §6.6 classing rows. Recompute against 173 x 33,952.
- [x] §6.2's lag-3 justification cited `PERIOD_DURATION == 90`, a column the new feed does not
      have. Corrected — the conclusion follows from the three-month window, not the day count.

### Phase 4's headline claim is validated — measured 2026-09-05, better than predicted

Encoded a real 100,000-byte paint table from the live snapshot (7 quantile classes over `n >= 30`,
tiers from `rse = 0.5395/sqrt(n)`):

| | measured | spec said |
|---|---|---|
| gating artifact today (`zip-data.json` gzip) | **2,569,567 B** | 2,886,170 (stale) |
| paint table gzip -9 | **24,652 B** | ~32,000 **[E]** |
| reduction | **104x** | 90x |
| max byte | **0x37**, exactly §4.2's legal max | — |

`n >= 30` population is **9,781 ZIPs** on the migrated feed, not §6.5's dead-feed 8,544 — one more
number §12 #11 must recompute.

- [x] **`bench/run.mjs` gains `gatingBytes`; baseline recorded 2026-09-05.** Decided: measure the
      wire size of the artifact that gates first colour, not a runtime race. The timing route was
      rejected because paint detection runs *after* a resource-stability loop that waits up to
      90 s, so nothing is left to attribute by then. `GATES_FIRST_COLOR` matches `zip-data.json`
      and `paint/<metric>-<hash>.u8` so the number survives the phase boundary; `last_updated.json`
      and the tileset are excluded (6 regex cases verified). `compare.mjs` shows it as
      "Bytes before first colour".
      **Baseline `bench/results/phase3-gating-baseline.json`: 2,570,348 B**, 3 runs, slow4g / 4x
      CPU / 1440x900, local `dist`. Agrees with the static gzip measurement (2,569,567 B) and with
      curl against the bench server (2,568,348 B). Phase 4 target: **24,652 B**.

### Spec defects found while building the sidecar — all fixed in the spec

- §5.2 step 1 **did not run as written**: `-simplify ... planar=false` is a syntax error
  (`planar` is a bare flag; spherical is already the default for lat/long). Removed; verified.
- §5.5's example header said `zcta`; the real column is `ZCTA5CE20` (`-filter-fields` retains,
  it does not rename). Fixed.
- §5.5's example row used **`00501`, which is not a ZCTA at all** — verified against all 33,791
  features, the lowest is `00601`. It is a point ZIP with no polygon. Replaced with a real row.
- §4.3's `int32` justification claimed both axes overflow `int16`. Only longitude does. The
  3.3268 deg "tallest" is **96799, American Samoa — deleted by §5.2's own territory filter**.
  Post-filter the tallest is 99701 at 2.7511 deg = 27,511, which *fits* int16. int32 is still
  correct, on longitude alone. Corrected, with a note not to re-optimise latitude later.
- A4's territory-drop list is now measured, not hypothetical: **11 features**, 96799 +
  7 Guam + 3 Northern Marianas. Puerto Rico and USVI retained.
- §5.5's `~1.4 MB` estimate for the sidecar is really 2,058,046 B. Corrected.
- **§4.1/§4.3 called columnar "the shape the repo already uses". It is row-major** —
  `write_snapshot()`'s docstring says so and the live file measures `len(d) == len(z) == 33,771`
  with `len(d[0]) == 38`. Phase 4's snapshot work therefore includes a real transposition on both
  sides of the wire; every frontend reader that indexes `d[i][j]` inverts. Corrected.

## Phase 6 — tooling prerequisite, resolvable

- [ ] **Start Docker Desktop and run `tippecanoe` in a container; commit the Dockerfile.**
      Confirmed 2026-09-05: `tippecanoe: command not found`; Docker Desktop 28.1.1 installed but
      **daemon not running**; WSL present with only the `docker-desktop` distro. `mapshaper 0.7.58`
      works, so §5.2 step 1 and §5.5 run locally today and only §5.3 is blocked. Committing the
      Dockerfile also satisfies §5.9's demand that the exact invocations be the reproducibility
      record. CI-only stays viable as a fallback, but §12 #16 wants a *measured* z2 tile cost,
      which means iterating, which means local.
- [ ] §12 #5 — `mapshaper -info` for median vertex spacing, the only geometry number still open.

## Phase 5+ preparation

### P0 · Irreversible if delayed

- [ ] **Archive the current ZHVI vintage as a release asset.** Zillow overwrites in place, so a
      month not saved can never be backtested. One in hand:
      `datap/Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv` (123,065,811 B, 2026-08-28).
- [ ] **Create the first release at all.** Three things already assume releases exist: the
      archive untrack, `geometry-vN`, and `deploy.yml`'s `gh release download`.

### P1 · The panel EXISTS now

`build/panel.parquet`, written by `pipeline/redfin.py` on every run. Measured
**173 x 33,952 = 4,930,000 rows, 83.9% filled, 274.1 MB** (the spec estimated ~262 MB). It is
gitignored and rebuilt from the full file every month, never appended to — Redfin restates
history continuously and every row carries the same `LAST UPDATED`, so an appended panel would
silently serve numbers Redfin has since revised.

Everything in Phase 5 and Phase 7 can now be built. `P` and `Z` are measured at S3 every run
and written to `manifest.panel`; do not carry a period count forward from any document.

### P2 · Close 3 of the 4 open numbers — offline, from `datap/`

Needs a scratch script, not shipped code. Gates *quoting* any statistic; gates no code.

- [ ] §12 #11 — recompute LISA on the gated `n >= 30` set: Moran's I at k=4/8/16/32, all five
      class counts, the BH count, `lisa_median_n_by_class`. Gating rebuilds the KNN graph, so no
      ungated figure carries over. **Nothing may be published until this is done.**
- [ ] §12 #12 — the 398-ZIP classing gap; add the `sum(class_counts) == non-null count` assertion
- [ ] §12 #7 — per-metric K for `median_dom` and `avg_sale_to_list`
- [x] §12 #3 (sub-pixel share) — **already CLOSED 2026-09-04**, measured straight from the
      shapefile's per-feature bboxes (z3 62.1%, z4 31.4%). This bullet was stale twice over: it
      also called `zcta-geom.csv` a Phase 6 artifact, and §5.5 assigns it to Phase 4.

### P3 · Environment

- [ ] Stats deps: `pyarrow==25.0.1` is pinned and in use. `numpy` is deliberately NOT declared
      — nothing imports it and it arrives transitively via pandas. Still needed for Phase 5:
      **numpy · statsmodels**, added when something actually imports them — numpy's turn is now,
      see the Phase 4 block. **Not `libpysal`/`esda`**: §6.11 rejects them on the merits (LISA is
      ~15 lines of numpy), so this bullet previously overstated the dependency set. `scipy 1.18.1`
      is installed but unpinned and nothing imports it.
      **Every pin must have a cp314 wheel.** `pyarrow==19.0.1` was committed on 2026-09-05
      because it was what happened to be installed locally on 3.13; CI spent four minutes
      compiling Arrow C++ and failed on a CMake error. `pyarrow` cp314 starts at **22.0.0**,
      `numpy` at **2.3.2**. CI now installs with `--only-binary=:all:` so a wheel-less pin fails
      immediately and prints the versions that would work.
- [ ] Reconcile `pytest==8.4.2` (repo) vs `pytest==9.0.3` (spec §6.11)
- [x] **Python 3.14 IS available locally** as `py -3.14` (3.14.5); bare `python` is 3.13.5 and
      bare `pip` targets 3.14, which is how the wheel-less pin slipped through. Use
      `py -3.14 -m pytest tests` and `py -3.14 -m pipeline` to match CI. The full pipeline and
      all 34 tests were re-run on 3.14 on 2026-09-05 and `zip-data.json` came out
      byte-identical to the 3.13 build (sha256 `bd796dfe...`).

### P4 · Phase 6 tooling gap — superseded

Moved to the Phase 6 block above and downgraded from `[!]` to `[ ]`: **Docker Desktop 28.1.1 is
already installed**, its daemon just is not running. The blocker is "start Docker and commit a
Dockerfile", not "acquire tooling".

---

## Open decisions

- [ ] **Does Realtor.com still earn its place?** (spec §6.1a `[RECONSIDER]`, §12 item 20.)
      The freshness argument died when the new Redfin feed was found, and `ACTIVE LISTINGS`,
      `MONTHS OF SUPPLY` and price cuts now all come from Redfin. Genuinely unique remainder:
      `median_listing_price` over **all active inventory** (Redfin's is new-listings-only),
      `pending_ratio`, `quality_flag`. Real but thin, and it costs a fourth estimand to explain.
      The spec should not keep straddling this.
- [ ] **±25% YoY clamp is judgement, not measurement** (§12 item 18). Compute the clamped share
      per year over the full panel, then either confirm ±25% or move it once and freeze it.

---

## Benchmark protocol

- [ ] Per phase, per spec §8.7: `node bench/run.mjs` on the built `dist/` at the pinned view,
      **before and after**, result into `bench/results/` and a line here.
- [ ] **Final full benchmark after the last phase lands**, same pinned conditions as the
      2026-08-29 baseline (slow4g / 4x CPU / 1440x900 / 5 runs / pinned view). Compare against
      `LCP 7016 ms · TBT 4178 ms · transfer 5,531,204 B · heap 73.8 MB · metric switch 2650 ms`.
- [ ] Record final numbers here and in the spec's §11.4 claims table. **Never quote a
      performance number that is not in `bench/results/`.**

---

## Next, in order

Aligned to spec §9. Two items from the old list are gone: the All-Residential filter (dead code
under the new feed) and the county low-zoom layer (cut in §10.3 — 30-day window, no FIPS).

1. Redfin feed migration (above) — everything else is written against a dead file
2. Temp download out of the working tree + atomic publish + diff sanity gate
3. Choropleth: stop calling `setPaintProperty`; constant `match` over a class index
4. Paint byte + typed-array store + real bboxes (Phase 4)
5. Statistics: K, YoY lag 12, gated LISA, classing, forecasting + backtest (Phase 5)
6. Geometry rebuild at `-Z2 -z10`, coverage assertion A7, tiny-ZIP dot layer (Phase 6)
7. History panel + sparkline (Phase 7) — stops discarding 14 years of history

---

## Session state — spec audit, 2026-09-03

Backup of the spec before this session's edits:
`<scratchpad>/FINAL-SPEC-08-2026.backup-preaudit.md` (md5 36c03384e5f5debed2fd9eb0ed5f5b8b).
Measured evidence file: `<scratchpad>/redfin-findings.md` (F1..F7). Raw sample:
`<scratchpad>/all_zips_head.csv`, first 140 MB of the real feed, 17 periods.

**Dataset choice CONFIRMED — `housing_market/monthly/all_zips.csv`.** Re-measured by live HEAD
2026-09-03. Five ZIP-level families exist; the other four are `property_types` (2.86 GB,
reintroduces the aggregation bug), `zips_in_top_50_metros` (364 MB, coverage loss), and
`price_drops` / `delistings_relistings` / `contract_cancellations` (0.56-0.67 GB each, and all
three publish 16 days behind `housing_market` — a shared staleness contract would false-trip).
`housing_market/zip_lookup.csv` is 403. Do not reopen this.

**Timeline, verified online.** New Data Center launched 2026-05-12. The old feed kept publishing
for three more weeks and stopped 2026-06-02 — no deprecation notice, no 404. Redfin's own
announcement says they "unified the Monthly and Weekly Market Trackers into a single pipeline
with one definition per metric" and that "some headline numbers will look different"; that is
the upstream statement of the §1.5.5 series breaks.

### New measured findings not yet in the spec

- **F1 · `MEDIAN DAYS ON MARKET YOY (%)` and `MONTHS OF SUPPLY YOY (%)` are not percents.** They
  are the absolute difference times 100, mislabelled. 43.2% / 27.7% of latest-period values are
  below -100, which a percent change cannot be. Divide by 100 for a change in days / months, or
  recompute from levels. The other 12 YoY columns are genuine.
- **F2 · in the newest period only, level and YoY are computed on different bases.** Redfin
  pre-emptively uplifts the newest period for expected revisions. The published *level* is not
  uplifted; the published *YoY* is. Implied uplift for the 2026-08-03 vintage: homes_sold +2.71%,
  new_listings +1.43%, active_listings +1.21%, pending_sales +0.93%, inventory +7.09%, prices 0%.
  Every older period is exactly 0. So a blanket "recomputed YoY must equal published YoY"
  CONTRACT passes at 100% for prices and rates and hard-fails on every count metric.
- **F3 · bounded columns exceed their bounds.** `sold_above_list` > 100 for 694 ZIPs (max 100.04);
  `avg_sale_to_list` max 184.61. §8.4's RANGES are fraction-scale and reject real rows.
- **F7 · window length is 89-92 days, not 90.** Calendar-aligned rolling 3 months.

### Audit results — 79 findings, all 9 lenses complete

Full set: `<scratchpad>/audit/all-findings.json` (79 objects, each with `spec_lines`,
`what_is_wrong`, `why_it_breaks_implementation`, `evidence`, `proposed_fix`).
26 blocking / 24 major in the first batch of 51; batch 2 added 28 more.

Convergence is the validation: independent lenses rediscovered the same defect repeatedly.
Counts by cluster —

| cluster | findings |
|---|---|
| §4.3 `f` array / snapshot column set (34 vs 38 vs real) | **15** |
| scales: percent vs `ratio x1000` (silent 100x) | 10 |
| YoY recompute CONTRACT hard-fails | 7 |
| `window_days: 90` is false (real window 89-92 d) | 7 |
| staleness clock / the 45-day hard fail | 6 |
| acquisition: range-GET vs the full panel | 6 |
| paint-table count and which metrics get one | 6 |
| `median_dom` / `months_of_supply` YoY is not a percent | 5 |
| RANGES contract rejects real rows | 3 |

**Metric selection, measured.** Pairwise Spearman on the latest period collapses the 14 metrics
to ~5 independent axes. The five count metrics are one latent variable (rho 0.91-0.99;
`new_listings` vs `active_listings` is **0.986**), the four price metrics another (0.81-0.89).
`months_of_supply` is the *least* correlated metric in the whole set (|rho| < 0.54 with
everything) because the ratio cancels the size factor. Ship 8 as map-selectable —
`median_sale_price` `median_ppsf` `median_list_price` `homes_sold` `active_listings`
`median_dom` `sold_above_list` `months_of_supply` — and carry all 14 in the snapshot.
`homes_sold` ships regardless: §6.2's `se = K/sqrt(n)` needs it as `n`.

### Measured on the FULL files, 2026-09-04 — these close section 12 items

Full Redfin CSV (`temp-redfin/redfin_data_center-housing_market-monthly-all_zips.csv`,
1,331,318,985 B) and the Census ZCTA shapefile
(`public/data/temp-geo/cb_2020_us_zcta520_500k/`). Raw output in
`<scratchpad>/fullscan.json`, `<scratchpad>/zipsets.json`, `<scratchpad>/zcta-bbox-scan.json`.

**Integrity CONFIRMED.** Local md5 of the whole file is `b1436909d98d5411891049c3ee882c70`,
byte-identical to the S3 single-part ETag. Whole-object verification works; §4.5's
`md5_verified: true` for Redfin is achievable **on the full-download path only**.

| fact | value | replaces |
|---|---|---|
| rows | **4,930,000** (0 ragged) | 9,725,026 / 3,298,202 |
| periods `P` | **173**, 2012-03-31 .. 2026-07-31, strictly descending | 171 |
| distinct ZIPs `Z` (ever) | **33,952** | 24,619 / 24,572 |
| ZIPs in latest period | **29,738**; 26,148 with `HOMES SOLD` | 20,010 |
| PK `(PERIOD END, REGION NAME)` dups | **0** across 4.93M rows | — |
| `FREQUENCY` / `REGION TYPE` / `LAST UPDATED` | uniform across all 4.93M rows | — |
| MoM non-null cells | **0** across all 4.93M rows | closes §1.5.6 for good |
| window length | 92 d ×2,857,977 · 91 ×1,026,380 · 90 ×733,207 · 89 ×312,436 | `PERIOD_DURATION == 90` |

**Panel is `173 x 33,952`, not `171 x 24,619`.** Every constant derived from 171 is dead,
including the "170 real month-over-month transitions" the diff-gate baseline is calibrated on.

**§12 #6 CLOSED — the 2020 ZCTA count is 33,791**, confirmed three ways (`.shx` file size,
`.shx` header length word, `.dbf` record count). The spec's "one denominator everywhere: 33,771"
is wrong; 33,771 is `zcta-meta.csv`'s count, a derived file. So z3 coverage is
31,828 / 33,791 = 94.19%, and the missing set is **1,963**, not 1,943.

**§12 #22 CLOSED — coverage against the new feed:**

| | new **[M]** | old (dead feed) |
|---|---|---|
| redfin ever / latest | 33,952 / 29,738 | 24,572 / 20,010 |
| latest ZIPs that are ZCTAs | 28,920 | — |
| orphans (Redfin ZIP, no ZCTA) latest / ever | **818 / 1,869** | 474 / 1,506 |
| ZCTAs with no Redfin data ever | **1,708** (5.1%) | — |
| ZCTAs with no Redfin data in latest period | **4,871 (14.4%)** | 6,664 (19.7%) |

**§12 #3 CLOSED — sub-pixel share from true bboxes**, one method throughout: a feature is
sub-pixel when its bbox is under 1 CSS px in *both* axes (256 px tiles, lon scaled by
cos(lat), devicePixelRatio 1).

  z2 91.7% · **z3 62.1%** · **z4 31.4%** · z5 15.7% · z6 7.4% · z7 3.2% · z8 1.1% ·
  z9 0.4% · z10 0.1% · z11 0.0%

Neither the old 40% nor the 89.5% figure survives. Quote 62.1% (z3) and 31.4% (z4, default view).

**§12 #18 MEASURED — the ±25% YoY clamp is far too tight.** Share of `MEDIAN SALE PRICE NSA
YOY (%)` with |value| > 25, per calendar year over the full panel:

  2012 36.6% · 2013 40.5% · 2014 36.6% · 2015 35.2% · 2016 34.5% · 2017 33.8% · 2018 32.9% ·
  2019 **31.4%** · 2020 33.4% · 2021 **40.8%** · 2022 37.2% · 2023 30.0% · 2024 31.0% ·
  2025 29.5% · 2026 29.0%

It saturates 29-41% of the map in *every* year, including calm ones — 2019 clamps 31.4% against
2021's 40.8%. The premise ("chosen to cover the 2021 peak with headroom") is false. Re-derive the
bound from a target saturation share (~5%) over the pooled panel, then freeze it. **Do not quote
±25% as a considered choice.**

**Geometry facts recorded.** CRS is NAD83 geographic (`GCS_North_American_1983`), not WGS84 —
sub-2 m difference, immaterial at this scale, but record it. `.cpg` is UTF-8. Attributes:
`ZCTA5CE20 GEOID20 AFFGEOID20 NAME20 LSAD20 ALAND20 AWATER20`. Dataset bbox spans
**-176.696676 .. +145.830418** longitude, i.e. it crosses the antimeridian (Adak AK to Guam/CNMI),
so any global-bbox or mean-centroid computation over all features is garbage.

**Max single-ZCTA extent: 8.3966° lon (99503, Anchorage), 3.3268° lat.** At the ×1e4 bbox-offset
scale that is **83,966**, which overflows `int16` (32,767). §4.3's bbox offsets must be **int32**.

### Kaggle — DEFERRED, not rejected

Do not build the publish automation now. Mechanically cheap (one Actions step,
`kaggle datasets version`), but: it is a fourth publishing surface with its own credentials
before §§1-4 are even built; it republishes a derivative of Redfin's data, and their
redistribution terms have **not** been checked — do that first, it is the actual blocker; and it
is outward-facing, so it needs an explicit decision, not a default. Revisit after Phase 7, when
the 173-period panel exists and there is something to publish that is not just a copy of
Redfin's file. GitHub Pro does not change this either way.

### Decisions settled 2026-09-04 — all in the spec

- **Realtor.com: CUT.** §6.1a retained as a deferred Phase 8 note with the reopen condition.
  §12 items 17 and 20 closed.
- **Change metrics: recompute ALL of them from published levels**, in native units. No Redfin
  `*_YOY` column is ever republished — which disposes of the broken `dom`/`mos` YoY columns
  without a correction factor, because they are never read. YoY is a percent change, not a log
  difference; the log form survives only inside forecasting.
- **Curing uplift is surfaced at PERIOD level, not per pixel** — the factor is constant across
  ZIPs (p50 == p95 to 4 dp), so painting it would be false precision. `manifest.curing` +
  a "Provisional" chip on the period label.
- **Acquisition: full 1.33 GB download, MD5-verified against the ETag. Range-GET REJECTED**
  for data — the lag-12 endpoint is ~97 MB in, and S3 returns the whole-object ETag on a 206 so a
  ranged body cannot be verified. One 1 MB shape probe survives in S0. Panel rebuilt monthly,
  never appended; `panel.parquet` is **~262 MB**, not the ~55 MB the spec had.
- **±25% clamp -> ±20%, derived.** My 29-41%/yr saturation measurement was on
  `median_sale_price_yoy`, which is **detail-panel only and never painted** — so it never had a
  clamp. On the painted series, pooled `|zhvi_yoy|` p95 = 18.85%; the old bound was too **loose**.
- **Reliability nibble is metric-invariant** (the sale-sample tier). Only `ACTIVE_LISTINGS` is
  carved out of the fade — 3,393 latest-period ZIPs have active listings and no sales.
  `MONTHS_OF_SUPPLY` is **not** carved out; it derives from `HOMES SOLD`.

### Next steps

1. [ ] `mapshaper -info` for median vertex spacing (§12 #5) — the only geometry item still open.
2. [ ] Adopt the audited `contracts.py` (§8.4) — re-run its RANGES against the full file first.
3. [ ] §12 #11 (LISA + reliability tiers on the gated set) and #12 (classing gap) still need the
       panel; they gate *quoting* any statistic, not writing code.
4. [ ] Rewrite §2's mermaid stage labels — S1/S2/S3 still say `.gz`, `PROPERTY_TYPE_ID == -1`
       and `171 x 24,619`. §1.5 wins where they disagree, but the diagram should not lie.

### BENCHMARK GATE — the reminder you asked for

**Run `node bench/run.mjs` on current prod BEFORE starting Phase 1, and again immediately AFTER
Phase 1 lands.** It is written into the spec as a hard gate at the top and bottom of Phase 1.
Reason: Phase 1 takes the latest period from 20,010 reporting ZIPs to **29,738 (+48.6%)**, so
`transfer` and `heap` move for reasons unrelated to any optimisation. The 2026-08-29 baseline
(`LCP 7016 ms · TBT 4178 ms · transfer 5,531,204 B · heap 73.8 MB · metric switch 2650 ms`)
stops being a valid comparand the moment Phase 1 merges. Label the two baselines separately or
every claim in §11.4 is confounded.

---

## Facts established — do not re-derive

> **The Redfin block below describes the OLD frozen feed.** Kept only because the currently
> published `zip-data.json` was built from it, so it is the baseline for continuity checks.
> For anything forward-looking use spec §1.5. Coverage in particular has moved: 20,010 ZIPs
> latest on the old feed vs **29,738** on the new one.

- OLD Redfin TSV: 9,725,026 rows, 2012-03-31..2026-05-31, `PERIOD_DURATION` uniformly 90,
  `IS_SEASONALLY_ADJUSTED` uniformly false, 5 `PROPERTY_TYPE`s
- OLD: "All Residential" exists for 3,298,202 / 3,298,202 (period, ZIP) pairs — filter lossless
- OLD: the TSV is **interleaved**, not grouped by ZIP (199,988 runs in the first 200k rows)
- OLD: `MONTHS_OF_SUPPLY` and `PRICE_DROPS` 100% null. **Both exist in the new feed.**
- OLD coverage: 20,053 ZIPs latest period; 27,112 any data; 6,659 drawable ZCTAs (19.7%) none
- OLD: 26.0% of latest-period ZIPs have `HOMES_SOLD < 5`; 49.8% under 20

Still current:

- ZHVI: 26,270 rows × 319 monthly columns, 2000-01..2026-07
- 2020 ZCTA count is **33,791** (not 33,120 — that is the 2010 delineation). The spec uses
  **33,771** from `zcta-meta.csv` as its one denominator; assertion A1 settles it on the first
  geometry run.
- Tileset: z12 alone is 34.13 MB = 39% of 92 MB. At z3, 40% of ZCTAs are sub-pixel; metro 44.1%
  invisible vs non-metro 25.0%. At z4 (default view): 22.4% vs 13.9%
- Measured load path (Node 24, real 8.6 MB file): JSON.parse 67.2 ms · object rebuild 173.0 ms ·
  structuredClone 237.8 ms ≈ **480 ms desktop, ~2.4 s mobile**
- Census publishes **only** `cb_2020_us_zcta520_500k` for ZCTAs — `_5m` and `_20m` both 404, so
  CB-500k vs TIGER is the entire choice
- Three architectural eras: Leaflet (2025-07-06→07-14, 8 days) · MapLibre+GeoJSON (07-14→12-07) ·
  MapLibre+PMTiles (12-07→now)

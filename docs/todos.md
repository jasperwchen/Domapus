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

- [ ] **Acceptance-test the `workflow_call` deploy for real.** A miswired one has a symptom
      identical to the bug it fixes. Confirm a Deploy job appears in the SAME run graph as a
      publish; parsing YAML proves nothing.
      **How:** push, then `gh workflow run update_data.yml`, then
      `gh run list --workflow=update_data.yml --limit 1` and
      `gh run view <id>` — the job list must show `update-data`, `deploy` AND the
      called workflow's `deploy` job. If `deploy` is skipped, check
      `needs.update-data.outputs.changed`; if it runs but publishes the wrong month, the
      `ref` input is not reaching `actions/checkout`.
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
- [!] §12 #3 (sub-pixel share) cannot be closed here — needs `zcta-geom.csv`, a Phase 6 artifact

### P3 · Environment

- [ ] Stats deps: `numpy==2.2.4` and `pyarrow==19.0.1` are pinned and in use. Still needed for
      Phase 5: **scipy · statsmodels**, plus **libpysal + esda** for LISA. All ship cp314
      manylinux wheels — the old "no cp314" concern is a false premise.
- [ ] Reconcile `pytest==8.4.2` (repo) vs `pytest==9.0.3` (spec §6.11)
- [ ] Local Python is 3.13.5, CI pins 3.14. Do not let a 3.13-only result become a committed
      constant without re-running it in CI.

### P4 · Phase 6 tooling gap

- [!] **`tippecanoe` is not installed and does not build natively on Windows.** `mapshaper` and
      `mapshaper-xl` are present, so geometry step 1 works locally; step 2 does not.
      `geometry.yml` is dispatch-only in CI so CI-only is viable, but then every tile-parameter
      experiment costs a full round trip. Get WSL or Docker if you intend to tune `-Z2` or the
      simplification flags.

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

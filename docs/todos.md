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

## Phase 6 — remaining

- [ ] **Decide where the tileset lives.** §5.9 wants `gh release create geometry-v1` with the
      exact invocations in the notes, `deploy.yml` doing `gh release download` keyed on
      `manifest.geometry_tag`, and `public/data/us_zip_codes.pmtiles` untracked. Today the new
      46.9 MB archive is committed in place of the old 92.6 MB one, which works but adds a
      permanent 47 MB blob to main's history. `.github/workflows/geometry.yml` already cuts the
      release when given a tag; the deploy-side download and the untrack are not wired.
      **Outward-facing and irreversible in git history — needs an explicit decision.**

## Phase 7 — remaining

- [ ] **Run the real pipeline end to end so S8 emits from `forecast.py`'s own horizons.**
      `build/history/` was produced by driving `history.write()` with `f_h12` standing in for
      h1/h3/h6, because a full run needs the source CSVs. The shipped `f` array is therefore
      four copies of the h12 value until `py -3.14 -m pipeline` runs. Everything else — axes,
      series, sigma, the q table, bucket sizes — is real.

## Blocked on user

- [!] Close the 5 open Renovate PRs (outward action on a public repo)
- [!] The gh-pages cleanup push is **obsolete — do not run it.** See "Publishing surfaces".

## Verification still owed

- [ ] Run `bench/verify-choropleth.mjs` against the **deployed** site, not only a local build.
      **How:** `BENCH_URL='https://jasperwchen.github.io/Domapus/?lat=39.5&lng=-98.35&zoom=4&metric=zhvi' node bench/verify-choropleth.mjs --cpu 4`
      Exits non-zero if a metric switch causes any tile request or if `map:sourceReload` is not 0.
      Locally both hold: measured `map:sourceReload = 0` through a metric switch.
- [ ] **The deploy has not run against the new wire format.** `public/data/` now carries a
      50-column column-major snapshot, a manifest with `assets.paint`, and `paint/*.u8`.
      `vite.config.ts` inlines the paint filenames from that manifest at build time and
      `deploy.yml` verifies it with `sha256sum -c`; that path is untested end to end on CI.
- [ ] **Phase 5's forecast tier-1 rung is dead code against real data.** The metro-growth-path
      fallback for 12-23 observations is reported in `f_tier` but never exercised — every ZHVI
      ZIP has >= 24 months. Either find a ZIP that needs it or delete the rung.

---

## Open decisions

- [ ] **±20% diverging bound: confirmed by derivation, but re-derive each release.**
      `classify.derive_diverging_bound()` recomputes it from the pooled ZHVI panel every run
      (p95 |yoy| = 18.85% over 6,137,683 lag-12 cells, share clamped 4.07%). It has rounded to
      20 on every start window tested. If a release ever produces a different bound, that is a
      regime change worth seeing, not a number to override.
- [ ] **Realtor.com stays cut** (§6.1a, Phase 8 note). Reopen only if
      `median_listing_price` over *all* active inventory, `pending_ratio` or `quality_flag`
      become load-bearing. The freshness argument died with the Redfin feed migration.

## Kaggle — DEFERRED, not rejected

Mechanically cheap (one Actions step, `kaggle datasets version`), but it is a fourth publishing
surface with its own credentials, it republishes a derivative of Redfin's data whose
**redistribution terms have not been checked — that is the actual blocker**, and it is
outward-facing so it needs an explicit decision. Revisit after Phase 7, when there is something
to publish that is not just a copy of Redfin's file.

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

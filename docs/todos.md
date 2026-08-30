# Domapus redesign — working state

Living file. Agents and sessions update it. Survives context resets. REmove all done task. 

## Status legend
`[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

---

## Done

- [x] Verified the PROPERTY_TYPE bug against live published data (37.3% wrong)
- [x] Verified gh-pages at 800.70 MiB / 1024 MiB Pages limit
- [x] gh-pages cleanup commit built: `a2e8476913cbeb9f479f4d622ffb133fd8b0a2ce`
      **NEEDS USER PUSH:** `git push origin a2e8476913cbeb9f479f4d622ffb133fd8b0a2ce:gh-pages`
- [x] Recurrence prevention (5 changes, uncommitted in working tree):
      previews read prod data · prune-dist · concurrency groups · size guards · renovate removed
- [x] `datap/` gitignored (1.6 GB raw source was untracked)

- [x] Benchmark harness built and validated (`bench/`, see `bench/README.md`)
- [x] Baseline captured, era 3 HEAD, local, 2026-08-29:
      **LCP 7016 ms · TBT 4178 ms · transfer 5.27 MB · heap 73.8 MB · metric switch 2650 ms**

## URGENT — before the next cron (26th of the month)

- [ ] **Pin `requirements.txt`.** It says `pandas>=1.5.0`; PyPI's current is
      **3.0.5**. CI does a fresh `pip install` every run, so the next cron
      installs a MAJOR version with mandatory copy-on-write into the exact
      `sort_values`/`drop_duplicates` path that caused the headline bug.
      Local is 2.2.3, so it works on your machine and changes in CI. VERIFIED.

## Now

- [~] Historical benchmark running in background -> `bench/results/era*.json`
      and `bench/results/history-run.log`. Compare with:
      `node bench/compare.mjs bench/results/era*.json`
- [x] Design workflow complete, 13/13 agents -> **docs/FINAL-SPEC.md** (2,631 lines, 12 sections)
- [ ] Read FINAL-SPEC.md section 9 (roadmap) and section 12 (10 unresolved items)

## Blocked on user

- [!] Push the gh-pages cleanup commit (classifier blocked the agent push)
- [!] Close the 5 open Renovate PRs (outward action on a public repo)

## Next, in order

1. `PROPERTY_TYPE == 'All Residential'` filter + primary-key uniqueness assertion
2. Temp download out of the git working tree + atomic publish + diff sanity gate
3. Choropleth: stop calling `setPaintProperty`; immutable step expression over a class index
4. Binary columnar wire format + struct-of-arrays worker
5. Time-series panel (stop discarding 14 years of history)
6. Forecasting + backtest + MASE regression gate in CI
7. Low-zoom aggregate layer (county z3–5.5, ZCTA above)
8. Geometry build script (none exists; tileset is an unreproducible one-off)

## Facts established (do not re-derive)

- Redfin TSV: 9,725,026 rows, 2012-03-31..2026-05-31, `PERIOD_DURATION` uniformly 90
  (trailing 3-month window), `IS_SEASONALLY_ADJUSTED` uniformly false, 5 `PROPERTY_TYPE`s
- "All Residential" exists for **3,298,202 / 3,298,202** (period, ZIP) pairs — filter is lossless
- The TSV is **interleaved**, not grouped by ZIP (199,988 distinct runs in first 200k rows)
- `MONTHS_OF_SUPPLY` and `PRICE_DROPS` are **100% null** — cannot be added
- Coverage: 20,053 ZIPs have Redfin data latest period; 27,112 have any data;
  **6,659 drawable ZCTAs (19.7%) have none** and render as legitimate low values
- 26.0% of latest-period ZIPs have `HOMES_SOLD < 5`; 49.8% under 20
- ZHVI: 26,270 rows × 319 monthly columns, 2000-01..2026-07
- 2020 ZCTA count is **33,791** (not 33,120 — that is the 2010 delineation)
- Tileset: z12 alone is 34.13 MB = 39% of 92 MB. At z3, 40% of ZCTAs are sub-pixel;
  metro 44.1% invisible vs non-metro 25.0%. At z4 (default view): 22.4% vs 13.9%
- Measured load path (Node 24, real 8.6 MB file): JSON.parse 67.2 ms · object rebuild
  173.0 ms · structuredClone 237.8 ms ≈ **480 ms desktop, ~2.4 s mobile**
- Three architectural eras: Leaflet (2025-07-06→07-14, 8 days) · MapLibre+GeoJSON
  (07-14→12-07) · MapLibre+PMTiles (12-07→now)

## Agent protocol

Any background agent working this project appends to this file:
what it verified, what it changed, what it could not finish, and what the next
session needs to know. Never delete another agent's entry — append and date it.

## Agent log

Append-only. Each background agent records what it started, concluded, and what
the next session needs. Never delete an entry.

- 2026-08-29 main session: harness built, baseline captured, 5 prevention changes
  applied, gh-pages cleanup commit prepared (needs user push).
- 2026-08-29 reviewer (feasibility/interview-defensibility lens): started adversarial
  review of the three competing architectures. Verifying size/perf claims against
  repo + datap/ before ranking.

- 2026-08-29 critique agent [OPS/RISK LENS]: started adversarial review of the 3
  competing architectures under the operational-risk lens (Actions limits, repo/git
  growth, GH Pages bandwidth, LFS, partial failure, reproducibility, py3.14 wheels,
  wall clock). Verifying claims against the repo before ranking.
  ### Verified during review (new facts, do not re-derive)
  - Redfin **county** tracker EXISTS at
    `.../redfin_market_tracker/county_market_tracker.tsv000.gz`, 241,131,599 B,
    Last-Modified 2026-06-02 (same publish as the ZIP file). BUT:
    **`PERIOD_DURATION` = 30, not 90** and **`REGION` is a NAME string**
    ("Pulaski County, MO"), no FIPS column. So a county<->ZCTA zoom swap would
    (a) silently change the time window under the user and (b) need a
    name->FIPS crosswalk (a third source). Both P2 and P3 assume otherwise.
  - `dropped_by_rate` in the pmtiles metadata is a COUNT: z3=99, tiny_polygons=5225.
    All three proposals agree the brief's "1% at z3" is wrong. But P1 and P2 then
    still use "~340 features at z3" in their frontend arithmetic (= 33771 x 1%),
    contradicting their own geometry sections. P3 measured 38,077 feature
    *instances* at z3 (ZCTAs duplicate across tiles) — the only self-consistent one.
  - Lag-1 high-pass K estimate is provably attenuated. With 90-day windows the
    noise autocorrelation is ~2/3 at lag1, ~1/3 at lag2. Var of the lag-1 filter
    = sigma^2 (1.5 - 2*rho1 + 0.5*rho2) = 0.333 sigma^2 vs 1.5 assumed
    => attenuation sqrt(0.333/1.5) = 0.471 => K_true ~= 0.2315/0.471 = 0.49.
    P3's measured 0.5395 is consistent. **K=0.240 (P1, P2) is ~2.2x too small.**
    Plausibility: K=0.54 -> within-ZIP p75/p25 price ratio 1.79x (realistic);
    K=0.24 -> 1.29x (implausibly homogeneous).
  - Local env is Python 3.13.5 / pyarrow 19.0.1 / pandas 2.2.3 / scipy 1.18.1.
    CI pins '3.14'. cp314-wheel arguments in the dossiers are real but only bite in CI.

- 2026-08-29 critique agent [STATS/DATA-CORRECTNESS LENS]: started adversarial review
  of the 3 proposals on time-series + spatial-statistics grounds. Checking: 90-day
  overlapping-window ACF, Redfin MOM/YOY semantics, median-of-medians aggregation,
  shrinkage specification, backtest leakage, interval calibration, LISA multiple
  comparisons, quantile classing, ZIP-vs-ZCTA, and whether the property-type fix is
  actually complete.
  ### Review conclusion (feasibility + interview-defensibility lens)
  - Ranking: **P1 > P3 > P2**. P1 is the only one with a working-at-every-step path.
  - Effort (15 finished LOC/hr, student, school in session):
    consensus core ~45 h · P1 ~250-345 h · P3 ~450-600 h · P2 ~500-680 h.
    At 8 h/week: 6 weeks vs 8-10 months vs 14-18 months vs 15-20 months.
  - **The 45 h consensus core carries ~90% of the interview value**:
    (1) All-Residential filter + PK grain assertion + 30309 regression test  ~10 h
    (2) constant `match` over a class index; never setPaintProperty again    ~15 h
    (3) diff-sanity gate calibrated from the panel's own 170 transitions     ~12 h
    (4) delete zip-data-lite (both files are fetched today), temp file out
        of the working tree, deploy.yml as workflow_call                     ~8 h
  - Best measured headline available: **metric switch 2650 ms -> ~100 ms**
    (baseline already captured by bench/, 4x CPU throttle, slow4g, pinned view).
  - Beware ratio inflation: measured total transfer is 5,531,204 B; the two
    JSONs are 2,886,170 B gz = 52% of it. So "311x smaller critical path"
    (P2) is at best a ~2.1x cut in bytes actually on the wire. Bundle+tiles
    floor is ~2.65 MB and no proposal moves it.
  - Do NOT do `git filter-repo` in v1. 540 SHAs, ~20 bot PRs, ~15 MiB payoff,
    orthogonal to every other change. The live risk is **gh-pages at
    800.70/1024 MiB**, which already has a prepared cleanup commit awaiting a push.
  - Graft into P1: P3's K=0.54 correction + measured-vs-nominal coverage table;
    P2's direct-indexed paint byte (~10 h, biggest first-paint win per hour);
    P3's full-set chunked feature-state writes (correct, and simpler than scoping).
  - Drop as decoration: Mann-Whitney on n=9, sticky PR-comment bench workflow,
    Getis-Ord alongside LISA, the 1024-bin quantile sketch, the confidence hatch
    + nibble-pack mobile fallback, the 5.7 MB time-scrubber slabs, the anomaly
    variance constant 1.795 (fitted nuisance param with no theory behind it,
    unlike K which has the order-statistic result).
  VERIFIED (ops lens, 2026-08-29), do not re-derive:
  * Fresh single-branch clone of main = **361.94 MiB** (3531 objs). Total blob bytes in
    history 768.25 MB; **715.66 MB (93%) is generated junk** (pmtiles 267.5 MB across 3
    blobs incl. the old `data/` path, zip-data.json 159.6 MB x17, geojson.gz 85.4 MB x4,
    leaked dist/* ~59 MB, show.png 10.6 MB). Non-generated content = 52.6 MB.
  * GH Pages Range semantics, measured in Chrome at the live origin:
      .pmtiles (application/octet-stream) -> 206, NO content-encoding,
        Content-Range denominator = 92,590,855 (TRUE size), bytes byte-exact vs local.
        6/6 mid-file probes correct. Range tier is SOUND for octet-stream.
      .json  (application/json)           -> 206, content-encoding: gzip,
        denominator = 2,201,079 (COMPRESSED size), **body decodes to 0 bytes**. BROKEN.
    => byte-offset addressing works only on content types Pages does not compress.
    BUT `curl -r` from CI negotiates the gzip variant and FAILS (exit 61,
    CURLE_BAD_CONTENT_ENCODING) even on .pmtiles. Any curl-based range smoke test
    is a false alarm. Test ranges with a real browser, not curl.
  * Whole-file GET of .pmtiles IS gzipped by Pages (92,590,855 -> 85,469,781). Do not
    pre-compress binaries.
  * cp314 wheels: **the whole concern is false.** Latest on PyPI all ship cp314
    manylinux x86_64: pyarrow 25.0.1, pandas 3.0.5, numpy 2.5.2, scipy 1.18.1,
    statsmodels 0.15.0 — and pyogrio 0.13.0 / pyproj 3.7.2 do too (geopandas,
    libpysal, esda are pure-python). Any design justified by "no cp314 wheels"
    is justified by a false premise.
  * REAL dep risk instead: CI pins python 3.14, this machine runs 3.13.5;
    requirements.txt is `pandas>=1.5.0` unpinned and **PyPI latest pandas is 3.0.5**
    vs 2.2.3 installed locally. Next cron installs a pandas MAJOR bump (CoW +
    PyArrow-backed str default) into the exact `sort_values/drop_duplicates` path
    that caused the headline bug. Pin exact versions before anything else.
  * pyarrow stream of the real 1.5 GB gz, measured here: 9,725,026 rows read,
    3,298,202 kept (33.91%) in **22.8 s**, table 541 MB. PK assert on
    (PERIOD_END, REGION, PROPERTY_TYPE_ID) = **1.45 s, 0 duplicate keys** —
    confirms that IS the true primary key. Core pipeline is feasible with ~13x
    memory headroom. Actions 6h cap / 7GB RAM / 14GB disk are all non-issues.
  * Per-zoom tile bytes measured independently from the PMTiles dir (matches the
    geometry dossier): z3 0.84 / z4 1.00 / z5 1.37 / z6 2.04 / z7 3.12 / z8 4.91 /
    z9 7.90 / z10 12.66 / z11 20.49 / z12 37.78 MB. **z11+z12 = 58.3 MB = 63%.**
    Cutting to z10 is the cheapest deploy-size win available.
  * Upstream HEADs today: redfin zip 1,548,403,907 B LM 2026-06-02 (88 days stale,
    ETag is a plain MD5 -> verifiable); **redfin county_market_tracker.tsv000.gz
    EXISTS, 241,131,599 B, same publish batch** (de-risks the county low-zoom layer
    for any design that wanted it); zillow ZHVI ETag is `...-12` = MULTIPART, so
    **MD5-vs-ETag integrity checks are impossible for Zillow** — scope that check
    to Redfin only.
  * Bandwidth is NOT a constraint: ~3.4 MB/cold visit today (2.20 MB gz zip-data +
    ~0.75 lite + ~0.45 tiles) = ~29k visits/mo against the 100 GB/mo soft cap.
  * LFS: `lfs: true` in deploy.yml AND preview.yml pulls all 14.45 MiB of
    public/data/archive on every checkout, but prune-dist.mjs deletes archive/ from
    dist — it is 100% waste. 1 GiB/mo free quota / 14.45 MiB = **70 checkouts/mo**,
    and shrinking ~2 MB per new archive. Deleting two `lfs: true` lines is a
    zero-risk fix available today, independent of any redesign.
  * A 100-day dead-feed hard-fail (all 3 designs propose it) trips **2026-09-10**
    and then pages every month forever with no possible remediation. Make it
    warn-once-per-fingerprint, not a monthly hard failure.
- 2026-08-29 critique agent [STATS LENS] CONCLUSIONS (all verified by re-running on
  datap/, scripts in scratchpad: k.py tiers.py lisa.py acf.py zhvi.py bt.py misc.py):
  * K DISPUTE SETTLED. High-pass lag sweep on the full All-Res panel reproduces
    Proposal 3 to 4dp: K(lag1..7)=0.2315 0.3915 0.5395 0.5619 0.5823 0.5923 0.5897.
    Lag-1 is biased by the 90-day window overlap; theory predicts the lag-1 estimator
    recovers only sqrt((1.5-1.75*rho1)/1.5)=0.43 of K at rho1=0.70 -> 0.5395*0.43=0.232,
    observed 0.2315. USE K=0.54 (or the refined rse=sqrt(0.51^2/n + 0.008^2)).
    K=0.240 (analytics dossier, Proposals 1 and 2) is WRONG by 2.33x.
    Consequence, latest period (20,010 reporting ZIPs): K=0.240 gives tiers
    38.4/14.8/17.8/29.0 %; K=0.5395 gives 3.8/15.7/23.2/57.3 %.
  * REDFIN MOM/YOY SEMANTICS CONFIRMED on ZIP 30309 / 2026-05-31:
    MOM = 407500/418000-1 (1-period change of a 3-month rolling window).
    YOY = 407500/420000-1 (12-period lag, non-overlapping). YoY lag is 12, NOT 4.
    Pooled MoM ACF = -0.123 -0.049 -0.278 -0.010 -0.012 -0.008 (theory for
    differencing an MA(3): 0,0,-0.5). Redfin median VR(h)=0.797/0.425/0.209/0.122
    at h=3/6/12/24 -> ~88% of one-period variance is transitory. Do not ship MoM.
  * sqrt(h) INTERVALS ARE A STRAW MAN. Own 82-origin walk-forward on ZHVI
    (11,583 complete-history ZIPs): nominal-80% coverage = 78.4/40.1/27.4/22.0 under
    sqrt(h)-Gaussian; 78.4/68.6/70.9/78.6 under the AR(1)'s OWN closed-form h-step
    variance sqrt(sum_k (sum_j rho^j)^2); 81.1/78.7/80.8/87.4 under empirical
    quantiles. ~90% of the "sqrt(h) fails" gap is using a random-walk variance for an
    AR(1); empirical calibration adds ~8-10pp (non-normality). Also MISSING from all
    three: drift-estimation variance h^2*Var(mu_hat), which is first-order at h=12.
    AR(1) MAE(log x100) h=1/3/6/12: 0.255/1.090/2.437/4.961 vs naive 0.675/1.947/
    3.625/6.594. P1's claimed 0.24/1.03/2.07/3.45 is optimistic at h=6,12.
    ZHVI monthly growth ACF(1)=0.9065 (not 0.869).
  * LISA IS A LOW-n DETECTOR. Reproduced exactly (k=8, 999 perms, BH q=0.05):
    I=0.6596, n=19,536, HH 2467 LL 2120 LH 38 HL 133, raw p<.05 = 7290, BH = 4758.
    BUT median homes_sold by class: HH 38, ns 22, LL 5, LH 6, HL 2. 79.7% of the
    133 "price islands" have <10 sales. The spatial-outlier classes are sampling
    noise. Gate LISA on n>=30 or use a measurement-error-corrected z.
    Global I is k-dependent: 0.687/0.660/0.623/0.582 at k=4/8/16/32.
    8th-NN distance p50 12.8km for n>=30 ZIPs vs 24.2km for n<5 ZIPs (scale varies).
  * LOG-EQUAL-INTERVAL CLASSING MUST BE ANCHORED. 7 classes over min..max
    (1,500 .. 22,437,500) puts 95% of ZIPs in 2 classes (counts 1/28/498/10283/8699/
    480/21). With p1..p99 anchors it is usable. No proposal specifies anchors.
  * RELIABILITY-FILTERED BREAKS SHIFT THE SCALE. n>=6 break set median price
    $370,000 vs excluded $272,900; n>=30 break set $389,900 vs excluded $305,000 and
    only 42.7% of reporting ZIPs set the scale. 11.3% of thin ZIPs land in the bottom
    class vs 4.2% of reliable ones.
  * COVERAGE ARITHMETIC: P3 is right. meta 33,771; Redfin ever 24,572, latest 20,010;
    ZHVI 26,269; both 18,691; redfin_only 845; zhvi_only 7,571; NO DATA 6,664 (19.7%);
    Redfin orphans (no ZCTA) 474 latest but 1,506 EVER - nobody quotes the 1,506.
  * OTHER GROUPING KEYS CHECKED (full-file awk): REGION parses to 5 digits for 100%
    of rows; (PROPERTY_TYPE_ID,PROPERTY_TYPE) is exactly the 5 expected pairs
    (-1:3,298,202 / 6:3,241,190 / 3:1,213,079 / 13:1,024,876 / 4:947,679);
    PARENT_METRO_REGION never changes for a ZIP across periods (0 ZIPs); 0 duplicate
    (zip,period) All-Residential rows. So after the filter the key IS unique.
  * UNFLAGGED BY ALL THREE: the Zillow file is
    Zip_zhvi_uc_sfrcondo_TIER_0.33_0.67_sm_sa - a 33rd-67th-percentile, SFR+condo,
    smoothed, SA STOCK index. Redfin's median is an untrimmed all-residential
    (incl. 2-4 unit) TRANSACTION FLOW statistic. Different universes and different
    estimands; the property-type fix was applied to Redfin only.
  * ALSO UNFLAGGED: metro-based growth/shrinkage. Median metro has 10 reporting ZIPs
    (p25=6), 23% of metros have <=5, and 596 reporting ZIPs have NO metro at all.
    "w=0 on own, all weight on metro" was fit with the ZIP's own value inside the
    metro aggregate - needs leave-one-out, and a fallback for the 596.
  * RANK (stats lens): P3 > P1 > P2. Every P3 number I checked reproduced; P1 and P2
    inherit the wrong K, and P1's YoY lag is written as 4 periods (must be 12).
  CONCLUSION (ops lens): rank **P1 > P3 > P2**. All three share the same correct
  pipeline core (verified feasible above). They differ almost entirely in surface
  area: P1 invents 0 wire formats / 1 data job; P3 invents 3 formats + hard-fails
  the cron on a statistical constant; P2 invents 4 formats + 6 workflows incl. a
  Playwright A/B harness, and its own cost numbers are off (dist 28 MB claimed vs
  ~119 MB real; 9 min claimed vs ~13.5 min real once 3 redundant pip installs and a
  180 MB artifact round-trip are counted). Actions limits (6h / RAM / disk) and
  Pages bandwidth are NON-issues for all three; the binding constraints are
  maintainability, dep pinning, and alarm hygiene.
  DO FIRST, independent of which design wins (each is minutes, zero risk):
   1. Pin exact versions in requirements.txt + add .python-version matching CI.
   2. Delete `lfs: true` from deploy.yml and preview.yml.
   3. Move the pipeline temp download out of public/ and gitignore *.tsv*.gz.
   4. Delete zip-data-lite.json fetch (both files are fetched every visit today).

- 2026-08-30 CHIEF ARCHITECT (synthesis): started. Task = produce THE FINAL UNIFIED
  SPECIFICATION from the 3 proposals + 3 critiques. Writing to
  `docs/FINAL-SPEC.md`. Decisions being locked: P1 skeleton, P2 paint byte,
  P3 statistics (K=0.5395, full-set chunked feature-state), county layer DROPPED
  (30-day window + no FIPS), no custom binary containers in v1, no filter-repo in v1.

- 2026-08-30 CHIEF ARCHITECT (synthesis) CONCLUDED. Wrote `docs/FINAL-SPEC.md`
  (2631 lines, 148 KB, 12 sections). That file is now THE plan; this file stays THE progress.
  ### Architecture locked
  P1 skeleton (one grain / one file / one expression) + P2's direct-indexed paint byte
  + P3's statistics. 7 phases, 157 h total, **phases 0-3 = 49 h and carry ~90% of the value**.
  ### Fatal flaws from the critiques, and how the spec ACTUALLY fixes each
  1. P1's YoY lag=4 -> lag 12, ASSERTED against Redfin's shipped *_YOY column (rtol 1e-6).
  2. P1/P2's K=0.240 -> K=0.5395 via lag-3 high-pass + committed lag-sweep plateau test.
     Reliability tiers become 3.8/15.7/23.2/57.3 % (were 38.4/14.8/17.8/29.0).
     Tier cuts: n>=182 / >=81 / >=30.
  3. "~340 features at z3" (P1+P2, = the debunked 1% premise) -> DELETED. Full 33,771-ZIP
     feature-state write, chunked 8,000/rAF. Simpler AND immune to the pan-back stale-state trap.
  4. County overview layer (P2+P3) -> **CUT**. Feed is PERIOD_DURATION=30 + REGION is a name
     string with no FIPS. Replaced by the tiny-ZIP inner-point dot layer + honest disclosure.
  5. P3's hard-fail on K -> TWO ASSERTION TIERS. CONTRACT (PK, constants, ranges, round-trip,
     paint==snapshot) blocks. DRIFT (K, Moran I, coverage, MASE) records+warns, never blocks.
     Only the diff gate blocks on a statistical check, and it is calibrated from the panel.
  6. 100-day dead-feed hard fail -> warn ONCE per unchanged fingerprint + visible site banner.
  7. Zillow MD5-vs-ETag -> scoped to Redfin only (Zillow ETag `-12` = multipart).
  8. LISA is a low-n detector (HL median n = 2) -> GATED on n>=30; publish median-n-by-class
     and Moran I at k=4/8/16/32.
  9. sqrt(h) straw man -> publish THREE coverage rows: RW sqrt(h) 78/40/27/22,
     AR(1) closed-form 78/69/71/79, empirical 81/79/81/87. Add the missing h^2*Var(mu_hat) drift term.
  10. Log-equal classing unanchored (95% of ZIPs in 2 classes) -> anchored p1..p99.
  11. Two class authorities -> ONE live at a time (PaintTable fixed-scale | ZipTable auto-scale),
      + build-time, commit-time and dev-runtime equality assertions.
  12. ZHVI/Redfin estimand mismatch -> tier token asserted in the source contract; distinct UI labels.
  13. Metro growth fit with target inside predictor -> metro YoY is a DISPLAYED REFERENCE only
      in v1; LOO refit required before any shrinkage ships. 596 metro-less ZIPs fall back to state.
  14. Ratio inflation -> honest numbers only: bytes-to-first-color 2,886,170 -> ~32,000 (~90x);
      TOTAL wire 5.53 MB -> ~2.9 MB (1.9x). Headline is metric switch 2650 ms -> <150 ms.
  ### Also CUT (see spec section 10)
  DMPS/DMRC/ZGEO binary containers · panel.bin + all HTTP-Range artifacts · time scrubber ·
  property-type selector · anomaly detector (var const 1.795) · Getis-Ord · 1024-bin quantile
  sketch · confidence hatch · bench.yml + Mann-Whitney · git filter-repo (DEFERRED, not
  cancelled) · 4-job data workflow · --require-hashes · integer MVT feature id (keeps
  promoteId; >5,000 ZIPs have leading zeros) · MinT · per-ZIP seasonality · HUD crosswalk.
  ### Next session: START AT PHASE 0 (spec section 9). ~5 h, all zero-risk:
   0.0 push gh-pages cleanup commit  [BLOCKED ON USER]
   0.1 exact-pin requirements.txt + .python-version  <- HIGHEST VALUE PER MINUTE IN THE PROJECT
   0.2 delete `lfs: true` x2 + untrack public/data/archive
   0.3 temp download -> $RUNNER_TEMP + gitignore *.tsv*.gz
   0.4 delete zip-data-lite fetch (index.html + HousingDashboard phase 1)
   0.5 formatPeriod() -> "90 days ending May 31, 2026"
  ### 10 open items the spec could not close are listed in FINAL-SPEC.md section 12.
      Most important: re-measure the sub-pixel ZCTA share from TRUE bboxes (40% vs 89.5%
      come from different methods and only one may be quoted publicly).

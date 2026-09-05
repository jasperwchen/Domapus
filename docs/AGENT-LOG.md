# Domapus — agent log and decision record

Append-only history. Moved out of `docs/todos.md` on 2026-09-03 so that file holds only
open work. Nothing here is a task; everything here is *why* something is the way it is.

Log things here mid work to avoid losing progresas or context when hit limit.
**Never delete an entry.** Append and date it. If a conclusion here was later overturned,
add the correction below it rather than editing it — the reversals are the valuable part.

## Protocol for agents

Any agent working this project appends to **this** file: what it verified, what it changed,
what it could not finish, and what the next session needs to know. Open work goes in
`docs/todos.md`; finished work and rationale go here.

---

## Completed milestones

- Verified the PROPERTY_TYPE bug against live published data (37.3% wrong)
- Verified gh-pages at 800.70 MiB / 1024 MiB Pages limit
- gh-pages cleanup commit built: `a2e8476913cbeb9f479f4d622ffb133fd8b0a2ce` (push still pending)
- Recurrence prevention, 5 changes: previews read prod data · prune-dist · concurrency
  groups · size guards · renovate removed
- `datap/` gitignored (1.6 GB raw source had been untracked)
- Benchmark harness built and validated (`bench/`, see `bench/README.md`)
- Baseline captured, era 3 HEAD, local, 2026-08-29:
  **LCP 7016 ms · TBT 4178 ms · transfer 5.27 MB · heap 73.8 MB · metric switch 2650 ms**
- Design workflow complete, 13/13 agents -> the final spec (2,631 lines, 12 sections)
- Spec read end to end and cross-checked against the repo (2026-09-01)
- All 8 blocking spec corrections + 9 numeric fixes applied (2026-09-01, +253/-64 lines)
- Phase 0.1 done: `requirements.txt` exact-pinned, `.python-version` added, both workflows
  moved to `python-version-file`
- Phase 0.4 done: lite JSON + `generate_lite_data.py` deleted, `index.html` preloads
  `zip-data.json`
- Phase 0.5 done, and better than the spec asked: repo added `formatRedfinWindow()` and
  **kept** `formatPeriod()` for ZHVI, which is genuinely a monthly index

---

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

- 2026-09-01 main session: FULL REVIEW of docs/FINAL-SPEC.md against the working tree.
  Verdict: architecture is sound, the 11 bugs are real, the measurements that could be
  re-checked here all held (zcta-meta.csv 2,067,563 B, pmtiles 92,590,855 B, both exact).
  Line-number citations into MapLibreMap.tsx (142 / 412-422 / 499-578 / 564 / 573),
  spatial-index.ts:25 and export/PrintStage.tsx:180-186 are all still accurate.
  ### Phase 0 actual state (uncommitted in the working tree)
  0.1 DONE  requirements.txt exact-pinned + .python-version 3.14 + both workflows on
            python-version-file. NOTE: spec S6.11 says pytest==9.0.3, repo pins 8.4.2 —
            reconcile. numpy/pyarrow/scipy/statsmodels not added yet (Phase 1).
  0.2 HALF  `lfs: true` gone from deploy.yml + preview.yml, BUT .gitattributes still has
            `public/data/archive/** filter=lfs` and the 6 archive files are still tracked.
  0.3 HALF  *.tsv*.gz gitignored; the RUNNER_TEMP move in update_market_data.py not verified.
  0.4 DONE  lite json + generate_lite_data.py deleted, index.html preloads zip-data.json.
  0.5 DONE  and better than the spec: repo added formatRedfinWindow() and KEPT formatPeriod()
            for ZHVI. Spec S7.9 says "formatPeriod() must change" — that instruction is now
            WRONG and would mislabel the Zillow monthly index. Fix the spec, not the code.
  ### 8 blocking defects IN THE SPEC — ALL FIXED IN THE DOC 2026-09-01
  B1 S8.1 vs S2.5 contradict: S2.5 says "S1..S12 is one job", S8.1 and S8.2 assume separate
     `run` (read) and `publish` (write) jobs. Pick one. Recommend separate publish + upload
     only build/publish/** (~45 MB, not the 180 MB S2.5 rejected) so the untrusted-parse job
     stays read-only.
  B2 S8.2 deploy.yml would FAIL EVERY MONTH: called via workflow_call it checks out
     github.sha (pre-pointer-commit), so `jq .geometry_tag` reads the OLD manifest and
     `sha256sum -c` verifies NEW release assets against OLD hashes. Add `ref: main` (or pass
     the pointer SHA as an input).
  B3 S8.2 the sha256sum jq is broken: `.assets | to_entries[] | .value.sha256` hits the
     `paint` entry, which is a map of plain strings with no .sha256/.file -> "null  ...null".
     Make manifest.assets.paint a map of objects, or iterate the two shapes separately.
  B4 S4.3 `scales` keys do not match column names (`rse` vs `msp_rse`/`dom_rse`, `yoy` vs
     `msp_yoy`/`zhvi_yoy`/`hs_yoy`/`msp_yoy_se`, no key for `sal`/`om2`/`f_sigma`).
     ZipTable.valueAt() looks scales up BY COLUMN NAME, so every one of those decodes
     unscaled — an rse of 0.0046 renders as 46. Silent wrong-number bug.
  B5 S4.3 says "the 30 columns" and `f` has 30 names, but the column list enumerates 34.
     The encoder asserts d.length === f.length, so this must be resolved before Phase 4.
  B6 S8.6 goldens reference `snapshot_50.bin` + `header.json` (magic/offsets) — leftovers
     from the binary container S4.1/S10.1 REJECTED. Nothing produces a .bin in v1. Also
     `paint_50.u8 ~50 B` cannot be read by PaintTable.from(), which asserts exactly
     100,000 bytes, and a real paint table breaks the 64 KB golden-file cap. Redefine the
     golden as JSON + a documented sparse paint fixture.
  B7 S6.5/S11.3 LISA numbers are all UNGATED (n=19,536, I=0.660, HH2467/LL2120/LH38/HL133,
     BH 4,758, bonferroni 0.05/19536=2.56e-6) but S6.5 then gates LISA to the 8,544 n>=30
     set. Gating changes the KNN graph itself (8th-NN median 12.8 km -> much larger), so
     Moran's I, every class count and the Bonferroni arithmetic must be recomputed on the
     gated set. Do not ship the ungated figures on the methodology page or in the interview
     answer.
  B8 S9 Phase 3 has no class authority. Phase 3 ships the constant `match` over
     feature-state `k`, but PaintTable (the thing that supplies `k`) ships in Phase 4, and
     S7.6 claims PaintTable is available "from first paint". Phase 3 needs a named interim
     ClassSource computing `k` client-side from zip-data.json. Currently unspecified.
  ### Numeric inconsistencies — ALL FIXED IN THE DOC 2026-09-01
  - S6.2 says the lag-1 filter variance factor is 0.333 -> recovery 0.471. S1.1 says 0.275
    -> 0.43, and only 0.43 reproduces the measured 0.2315 (0.5395*0.43=0.232). S6.2 is wrong.
  - S6.6 anchored class counts sum to 19,612; the unanchored ones sum to 20,010. Same
    population, so 398 ZIPs are unaccounted for. Recheck.
  - S1.1 Bug 2 uses 33,780 as the ZCTA total (elsewhere 33,771; A1 warns against 33,791) and
    says ~1,933 missing at z3 when 33,780-31,828 = 1,952. Pick ONE denominator.
  - manifest `noise.tiers_pct: [3.8,15.7,23.2,57.3]` is ordered high->low while tier CODES
    are 0=low..3=high. Make it an object keyed by tier name.
  - S6.8 `Var(mu_hat) = (sigma_g^2/W)(1+rho)/(1-rho)`: sigma_g is undefined. The code's
    `sig` is the INNOVATION sd; that formula needs the MARGINAL sd. At rho=0.9065 the gap is
    1/(1-rho^2) = 5.7x, on a term the spec itself calls first-order at h=12.
  - S8.3 bomb guard: "12 GiB (2.5x the observed 4.48 GiB; ratio 3.10:1)". 1.548 GB x 3.10 =
    4.80 GB and 12/4.48 = 2.68. Numbers do not close.
  - S5.5/A5 assert bbox offsets fit int16 and clamp Alaska. Vestigial: S4.3 puts them in JSON
    and S7.7 reads them into Int32Array, so int16 buys nothing and clamping reintroduces a
    small version of Bug 3. Drop the constraint.
  - S7.3 boot script serialises TWO round trips before first paint (manifest -> paint), and
    the paint filename is hash-derived so it cannot be preloaded. "~32,000 bytes to first
    color" is true; "< 3 ms" ignores ~2 RTT on slow 4G. Either inline the paint pointer at
    build time or use a stable filename + ?v= hash.
  - scripts/update_market_data.py has TWO drop_duplicates calls (:155 and :157, the
    `best_so_far` merge path). Spec S1.1 cites only one at :158-160. Both are the same bug.

- 2026-09-01 main session: applied the review to docs/FINAL-SPEC.md. Backup of the pre-fix
  version is in the session scratchpad as FINAL-SPEC.bak.md (not committed). All 35 edits
  asserted a unique anchor match before applying. Verified afterwards: `f`, `scales` and the
  prose column list are now all exactly 34 names with identical sets; code-fence count is even;
  the new deploy.yml jq walk was executed against a sample manifest and emits all three
  file/sha256 pairs where the old `to_entries[]` form emitted `null  public/data/null`.
  Every superseded figure is kept in the doc as an explicit "an earlier draft said X, and X does
  not reproduce" note rather than deleted, so the corrections stay auditable.

---
---

## 2026-09-03 session — decisions locked, and what they change in the spec

Answers to the open design questions raised this session. Each one is a spec edit
that has NOT been applied to `docs/FINAL-SPEC-08-2026.md` yet.

### D1 Tile zoom range -> `-Z2 -z10` (NOT 2-13)
Underzoom and overzoom are not symmetric. MapLibre **overzooms** past a source
maxzoom natively (z10 tiles serve z11/z12 fine, 0.25 px error) but **does not
underzoom** — below the source minzoom nothing renders at all. So:
- Add z2. Costs ~0.2-0.3 MB (z3 is 0.84 MB and each level down is ~4x fewer tiles).
  Fixes the Alaska export inset, which today renders blank below z3 and is worked
  around by a hand-tightened bbox that literally cuts off the Aleutians
  (`PrintStage.tsx:28-34`).
- Do NOT add z11/z12/z13. z11+z12 alone are 58.3 MB = 63% of the archive and buy
  nothing overzoom does not already give.
- FREE FIX AVAILABLE TODAY, no tileset rebuild: the offscreen inset map div is
  `w-56 h-36` = 224x144 px (`PrintStage.tsx:654,664`) but is drawn into a 400x260
  slot. Rendering at 400x260 fits ~70 deg lon / ~23 deg lat at z3, which already
  covers 51-71N. Do this first; `-Z2` is the durable version.

### D2 Census boundary file — CB 500k is correct AND is the only option
`cb_2020_us_zcta520_500k.zip` returns 200; `_5m` and `_20m` both **404** — Census
does not publish coarser ZCTA cartographic boundaries. So the only alternative is
TIGER, which is wrong here (water blocks -> ocean blobs on every coastal ZIP).
Spec 5.1 stands. The `-info` vertex-spacing check (S12 item 5) still applies.

### D3 Upstream feeds — Redfin is 93 days stale, Realtor.com is fresher than both
Measured 2026-09-03 by HEAD:
- Redfin `zip_code_market_tracker.tsv000.gz` 1,548,403,907 B, **LM 2026-06-02**.
  Still the correct file — there is only one ZIP-level tracker, and seasonal
  adjustment is a *column* (uniformly false), not a separate file.
  **93 days stale. The 100-day dead-feed alarm trips 2026-09-10.**
- Zillow: all four ZHVI variants exist and 200 (`..._tier_0.33_0.67_sm_sa_month`,
  `..._tier_0.33_0.67_month`, `..._sfrcondo_sm_sa_month`, `..._sfr_tier_..._sm_sa_month`).
  Keep `sm_sa` — it is the forecasting target and smoothed+SA is what you extrapolate.
  Note the consequence: Zillow already removed seasonality, so any per-ZIP
  seasonality work on ZHVI is measuring the smoother (consistent with the S10 cut).
- Realtor.com `RDC_Inventory_Core_Metrics_Zip.csv` 7,393,242 B, **LM 2026-09-03**
  (history file 829,650,423 B, LM 2026-09-02). 45 columns, listing-side.

### D4 Add Realtor.com. Do NOT add Zillow's Market Heat Index.
- Realtor.com is a third **estimand**, not a third copy of the same number:
  sold-side (Redfin) / stock (Zillow) / **listing-side supply** (Realtor).
  It carries `price_reduced_share`, `pending_ratio`, `active_listing_count` and a
  `quality_flag` — none of which the other two have. And it is currently the only
  feed that is not stale. 7.4 MB/month for the current-month file.
- Zillow Market Heat Index is a black-box 0-100 composite with no published recipe.
  It cannot be given an error bar, which is the one thing this project promises
  about every number it displays. Reject.

### D5 MoM — the spec's argument only proves half of what it claims
`update_market_data.py:119-129` passes Redfin's own `*_MOM` straight through;
`:99` **computes** `zhvi_mom` here from two adjacent ZHVI columns. So they are
two different things and Bug 9 only indicts the first:
- **Redfin MoM is theirs and is genuinely broken** — one-period change of a 90-day
  rolling window, so it compares a window against itself across two shared months.
- **ZHVI MoM is ours and is not broken** — no window overlap. It is just very low
  value: ~0.12% noise sd on a series Zillow already smoothed, so it mostly reports
  the smoother.
Drop both, but S6.4's "Not shipped. Ever." needs a second sentence giving the
second, weaker reason. As written the interview answer overclaims.

### D6 Legend anchors — keep p1/p99, RECOMPUTE each release, ship the breaks
**REVERSED after user pushback on 2026-09-03. The first version of this entry said FREEZE.
That was wrong; the reasoning is kept here because the correction is the interesting part.**

The freeze argument assumed cross-release comparison happens **by color**. It does not — it
happens by value, and every artifact already carries its own legend. What freezing actually
produces is a *stale* legend: as prices drift, fixed anchors swallow more ZIPs into the end
classes and the legend stops describing the map it is painting. That is the exact failure the
user said they did not want.

Policy now in S6.6:
- Recompute p1/p99 each release on that release's own `n >= 30` population.
- Ship the 8 boundary values in `snapshot.json` + `manifest.classing.<metric>.breaks`.
- Keep every release's breaks in manifest history -> cross-release comparison by value.
- Diff gate reports break movement (a quiet month moves anchors ~1%; a 20% jump must be seen).
- CONTRACT: `sum(class_counts) == non-null count for that metric`. Also closes the 398-ZIP gap.

**Exception: `*_yoy` diverging scales are FIXED at +/-25% symmetric with explicit clamping.**
Different failure mode. Prices drift slowly in one direction so a recomputed scale always fits;
YoY *swings* (p99 ~ +40% in a boom, +3% flat), so recomputing renders every regime equally
dramatic and erases the thing YoY exists to show. A clamp is not stale when the legend states it
("`>= +25%`" is true in every regime). S12 item 18 makes picking +/-25% an empirical exercise
rather than a guess.

### D7 No-data rendering — grey. No stripes. Three states, three channels.
1. No data (ZCTA exists, neither source reports), 6,664 ZCTAs -> solid `#E8E8E8`
   + its own legend entry. Never transparent.
2. No polygon (ocean, park, unpopulated) -> nothing painted, basemap shows through.
3. Below reliability floor -> real color at 0.38 opacity.
Hatching is rejected for the same reason S7.9 already rejected it for reliability:
illegible below ~8 px, which is most of the map at z3-z5. It also needs `addImage`
+ a raster pattern, which breaks the single constant paint expression that the
whole Phase 3 fix depends on.

### D8 Uncertainty fade stays ON. Not a toggle.
It is the honesty layer; making it optional invites turning it off, and it is
another piece of state that would have to survive the URL, the export and the
archived snapshot. If a control is wanted, put a before/after demo on the
methodology page, not a switch on the map.

### D9 Benchmarking in `deploy.yml` — NO browser bench, YES a size/RSS trend line
Two different things were conflated:
- Throttled-Chrome LCP/TBT in CI: rejected, and S10.4 already gives the reasons.
  Shared-runner CPU variance swamps the signal, it adds ~5 min to every deploy, and
  a graph of noisy numbers is worse than no graph.
- **Deterministic build facts are worth recording every deploy** because they are
  exact, not sampled: dist bytes, gz bytes per chunk, tile bytes, pipeline peak RSS,
  rows read/kept, source ETag. Append one JSON line per deploy to
  `bench/history.jsonl` and render it on the methodology page. Zero flake.

---
---

## 2026-09-03 — spec updated

All of D1–D9 applied to `docs/FINAL-SPEC-08-2026.md`: **22 anchored edits**, each asserting a
unique match before applying (backup at `scratchpad/FINAL-SPEC.bak2.md`). Verified after:
code-fence count even (102), no `-Z3` left anywhere including the mermaid diagram, all edited
tables well-formed. 2,821 -> 2,964 lines.

Sections touched: 2.3 · 3.3 · 5.1 · 5.3 · 5.6 · 5.7(A7) · 6.1a(new) · 6.4 · 6.6 · 7.9 · 8.7 ·
9(Phase 5, Phase 6) · 10.4 · 10.9 · 12(items 12, 16–19 added).

**D6 reversed** vs the entry above it — see that entry. Everything else landed as written.

---
---

## 2026-09-03 (later) — spec fork resolved, feed migration merged

### What happened
Another agent worked in `docs/FINAL-SPEC.md` (the OLD filename) instead of
`docs/FINAL-SPEC-08-2026.md`, so the tree briefly held two divergent specs. Resolved by
merging, not by picking a side.

- `FINAL-SPEC-08-2026.md` was **never damaged** — byte-identical to the 22-edit version.
- `FINAL-SPEC.md` was the **pre-2026-09-01-review base** plus one large new section. It had
  silently reverted ~12 earlier fixes. Not used as the merge base for that reason.

### Reverted-in-the-agent-file fixes that were NOT carried over (deliberately)
Each of these was fixed on 2026-09-01 and had regressed. The good file keeps the fix:
B1 three-jobs split · B3 manifest asset leaves carry `file`+`sha256` · **B4 `scales` keyed by
column name** (without it an `rse` of 0.0046 renders as **46** — silent wrong number) · B5
34-not-30 columns · B7 gated Bonferroni 5.85e-6 · §5.5 + A5 no-clamp bbox rule (clamping
re-creates a small Bug 3) · the two-`drop_duplicates` finding · the 33,771 denominator ·
`tiers_pct` as an object · the §6.2 K-attenuation derivation.

### What WAS carried over
- **§1.5 Upstream feed migration (246 lines), verbatim.** Independently verified before porting:
  new URL 200 at 1,331,318,985 B; `.csv.gz` 403; `index.json` 10,174 B; `property_types`
  2.86 GB; CSV header is exactly the 8 identifiers + 14 metrics x 3 it describes. All claims hold.
- The §0 supersession pointer, and the `Implementer:` line.
- §2.3 gets a supersession note explaining **why** the warn-once reasoning flipped to a 45-day
  CONTRACT hard-fail: warn-once was justified by "no available remediation", and a live
  replacement feed is exactly that remediation appearing.

### THE HEADLINE: Redfin replaced the feed. The old one did not 404 — it froze at 200 OK.
`redfin_data_center/housing_market/monthly/all_zips.csv`, 1.33 GB plain CSV (NOT gzipped),
refreshed 2026-09-02, period-descending so a `Range: bytes=0-20000000` gets the whole newest
period. 29,738 ZIPs latest vs 20,010 on the old feed. 14 metrics, up from 11.
**The All-Residential filter and the 5-pair PROPERTY_TYPE contract are now dead code** — the
new file *is* the aggregate. Delete them; do not port them.

### Two of my earlier answers were corrected by this
- **MoM.** I said ZHVI MoM was ours-but-worthless and should be dropped. §1.5.6 is right and
  I was wrong: `zhvi_mom` **stays**, because `sm_sa` is smoothed + SA on true calendar months,
  which is the one place MoM means what a reader thinks. And Redfin MoM is no longer a judgement
  call at all — it is **0 of 29,738 non-null**, i.e. the series does not exist at ZIP level.
  That is a strictly stronger interview answer than the Bug 9 argument.
- **Realtor.com (D4).** Materially weakened, flagged `[RECONSIDER]` in §6.1a and as §12 item 20.
  The freshness argument is dead, and `ACTIVE LISTINGS`, `MONTHS OF SUPPLY` and price cuts all
  now come from Redfin. Only `median_listing_price` over *all* active inventory (vs Redfin's
  new-listings-only), `pending_ratio` and `quality_flag` remain unique. **Open decision.**

### New §12 items: 20-24 (21 and 24 are the dangerous ones)
21 — §2, §4 and §6 still describe the dead TSV. §1.5 must stay first-read until they are rewritten.
24 — delete the `* 100` in `_coerce_value()`; the new feed already ships percent. Silent 100x.
22 — every coverage number keyed to 20,010 is now suspect, incl. the 19.7% no-data share.

### Housekeeping
- `docs/FINAL-SPEC.md` deleted and re-untracked (the agent had re-added it to the index).
  Its full text is preserved at `scratchpad/FINAL-SPEC.agent-version.md`. `.gitignore:129`
  (`docs/FINAL-SPEC*.md`) covers both names, so this cannot recur through git.
- **ONE spec file only: `docs/FINAL-SPEC-08-2026.md`.** 3,265 lines, 106 fences (even).
- Untracked junk left in the tree by the exploration: `dl.html`, `head.csv`, `hm_head.csv`,
  `idx.json`, `zh.txt`, `temp-redfin/`. `temp-redfin/` is exactly what Phase 0.3 says must never
  sit in the working tree. Left in place, not deleted — `temp-redfin/` holds the saved Redfin
  methodology page that §1.5.4's legacy-name table cites as its source. Move it, do not lose it.

---

## 2026-09-05 — PHASE 1 LANDED: feed migration, correctness fix, and the panel

`scripts/update_market_data.py` and `scripts/tests/` are deleted. `pipeline/` replaces them:
`contracts.py units.py sources.py redfin.py zhvi.py dim.py panel.py serialize.py __main__.py`.
Tests moved to `tests/`, fixtures cut from the real feed, 21 passing. Frontend moved in the
same change, because `KEY_ORDER` changed and the site would otherwise render undefined.

### Verified against the real 1.33 GB file, not a sample

Full run, `python -m pipeline --redfin-csv <local> --zhvi-csv <local> --skip-probe`:

- **4,930,000 rows · 173 periods (2012-03-31..2026-07-31) · 33,952 ZIPs** — every figure
  matches the spec's independent measurement.
- **0 duplicate `(PERIOD END, REGION NAME)`** across all 4.93M rows.
- `panel.parquet` is **274.1 MB**, 173 x 33,952, **83.9% filled** (the panel is ragged; not
  every ZIP reports in every period). Spec estimated ~262 MB.
- Latest period 2026-07-31 has **29,738 ZIPs**, against 20,010 on the dead feed.
- Coverage against `zcta-meta.csv`: both 25,604 · redfin_only 3,315 · zhvi_only 658 ·
  no_data 4,194 · **819 orphans** (Redfin ZIPs with no ZCTA polygon; written to
  `build/orphans.json` rather than silently dropped).
- Ingest is ~35 s for the whole file. pyarrow, streamed to parquet; the uniqueness check
  reads back only the two key columns, so peak memory is bounded.

### Two bugs found DURING implementation, both caught by contracts, not by review

**1. The RANGES in spec section 8.4 reject real rows, and not only the two the spec knew about.**
The contract fired on the first smoke run. Measured over all 4,930,000 rows:

| column | spec bound | measured | verdict |
|---|---|---|---|
| `median_dom` | (0, 3650) | 0..**18,504** | bound was a 10-year cap; real data is 50 years |
| `median_sale_price` | (1e3, 1e8) | **1.00**..65,900,010 | a real $1 sale exists in history |
| `median_ppsf` | (1.0, 1e5) | 0..**2,175,007** | |
| `median_list_price` | — | 100..**999,999,999** | an upstream sentinel; **0 in the latest period** |
| `avg_sale_to_list_ratio` | (0.5, 2.0) | **exactly 50.00..200.00** | Redfin clamps it; the spec's percent-scale (50,200) is exactly right |
| `sold_above_list` | (0.0, 1.0) | 0..100.04 | percent scale confirmed |

Bounds in `pipeline/contracts.py` are now measured and commented with the measurement. They
are the **snapshot** contract (latest period); full-file extremes are noted where they differ.

**2. `units.coerce` ran twice, so the `/100` was applied twice.** `redfin.latest_records`
coerced, then `serialize.assemble` coerced the same values again. `median_dom_yoy` for 30309
shipped as **0.17 days instead of 16.55**. Caught by comparing against real lag-12 levels, not
by reading the code. `latest_records` now passes raw values through; `assemble` is the ONE
coercion point, and the docstring says so.

### The `/100` on `median_dom_yoy` / `months_of_supply_yoy` is now PROVEN, not asserted

`tests/fixtures/redfin_sample.csv` is 13 periods x 11 ZIPs cut from the real feed — 13 is the
minimum that makes a lag-12 comparison possible. Against real lag-12 levels at 2026-07-31,
`published / 100` matches the level difference on **every** row:

| ZIP | median_dom now | a year ago | published YoY | /100 | actual difference | percent change |
|---|---|---|---|---|---|---|
| 10001 | 110 | 66 | 4407.87 | **44.08** | **44.00** | 66.67 |
| 65262 | 13 | 55 | -4199.07 | **-41.99** | **-42.00** | -76.36 |
| 90210 | 50 | 84 | -3396.46 | **-33.96** | **-34.00** | -40.48 |

Independent confirmation from the full-file scan: after the division the column's range
(-18,413..18,466) is the same scale as the LEVEL column (0..18,504). A percent change would
not be. The test judges the percent hypothesis **in aggregate**, because on a few rows the two
coincide numerically — 78701 is -16 days against -16.33 percent — and a per-row
"is not a percent" assertion fails on exactly those.

### Decisions taken, with reasons

- **Phase 1 ships Redfin's PUBLISHED YoY**, with the `/100` correction for `median_dom` and
  `months_of_supply`. It does NOT recompute YoY from levels (spec section 4.3's rule). Reason:
  Phase 1's own Verify criteria test the divided-published path, and section 9 assigns "YoY at
  lag 12" to Phase 5. The panel Phase 1 builds is what makes the Phase 5 swap a small change.
- **Staleness warns; it never hard-fails.** The spec's own section 1.5.1 shows why a 45-day hard
  fail cannot work: it refuses to publish, so the manifest carrying the outage banner is never
  written and the banner can never render. `STALE_WARN_DAYS = 45` warns;
  `MAX_PERIOD_AGE_DAYS = 120` (two missed publications) is the only fatal case.
- **The dropdown offers 8 of 15 metrics** (`PAINTED_METRICS`), per the measured redundancy
  argument. All 15 ship on the wire and appear in the ZIP detail panel.
- **`formatChange` takes a unit.** `percent | ppt | days | months`. Rendering a day difference
  with a `%` would put Redfin's mislabelling back after the pipeline removed it.

### Benchmark gate — both baselines recorded, and they are NOT comparable

`bench/results/phase0-baseline.json` (pre-migration) and `bench/results/phase1-after.json`.
Same pinned conditions: slow4g / 4x CPU / 1440x900 / 5 runs / pinned view.

| | phase0-baseline | phase1-after | change |
|---|---|---|---|
| LCP | 7352 ms | 7228 ms | -1.7% |
| TBT | 5120 ms | 4053 ms | -20.8% |
| transfer | 4,793,964 B | 5,247,137 B | **+9.5%** |
| heap | 62.4 MB | 64.1 MB | +2.7% |
| metric switch | 3375 ms | 3190 ms | -5.5% |

**Transfer is up on purpose and this is the whole reason the gate exists.** The latest period
went from 20,010 reporting ZIPs to 29,738 (+48.6%), so there are far more non-null cells even
though the column count fell 43 -> 38. Every performance claim from here on must name which
baseline it is against. The 2026-08-29 figure (`LCP 7016 · TBT 4178 · transfer 5,531,204 ·
heap 73.8 MB · metric switch 2650`) measured the old feed's payload and is no longer a valid
comparand for anything.

Both runs still warn "no performance.measure marks" — `src/lib/perf.ts` is Phase 3 and lands
next, alone.

### Note for whoever runs the first CI pipeline job

`npx playwright install chromium --only-shell` was needed locally mid-session; the browser
had disappeared from the Playwright cache between two benchmark runs.

---

## 2026-09-05 — PHASE 2: diff gate, the deploy fix, fingerprinting

### The diff gate is calibrated from real data, and the spec's estimate of it was wrong

`scripts/calibrate_diff_gate.py` -> `tests/baselines/diff_gate.json`. Rule:
`max(P99 of the observed moved>25% distribution x 1.5, floor 0.01)` over the panel's own
**172** month-over-month transitions (the spec said 170; that came from the void `171 x 24,619`
shape). ZHVI is calibrated separately from its own wide monthly file, 318 transitions.

| metric | limit | observed p99 | observed max | **observed median** |
|---|---|---|---|---|
| `median_sale_price` | 0.281 | 0.187 | 0.191 | **0.141** |
| `median_list_price` | 0.296 | 0.197 | 0.204 | **0.140** |
| `median_ppsf` | 0.216 | 0.144 | 0.146 | **0.104** |
| `zhvi` | 0.010 (floor) | **0.000** | 0.000 | 0.000 |

**Correction to spec section 8.5.** It asserts "a threshold near 0.05" and predicts the
property-type bug would trip it "~6x". Both are wrong. A ZIP median over ~14 sales is genuinely
noisy: in a **normal** month **14.1%** of ZIPs move their median sale price by more than 25%.
The threshold cannot sit near 0.05 without firing every single month, so it lands at 0.281.

**The gate still catches the bug, but the margin is 1.2x, not 6x.** Measured for real by running
the gate on the previously published snapshot (`HEAD~1:public/data/zip-data.json`, the buggy
pipeline's output) against this build:

| metric | moved>25% | limit | verdict |
|---|---|---|---|
| `median_sale_price` | **33.9%** of 19,901 | 28.1% | TRIPS |
| `median_list_price` | **30.3%** of 18,885 | 29.6% | TRIPS |
| `median_ppsf` | **22.9%** of 19,753 | 21.6% | TRIPS |
| `zhvi` | 0.0% of 26,262 | 1.0% | passes |

ZHVI passing is the right answer and a useful property: the bug was Redfin-side, so the gate
localises the fault to a source rather than merely saying "something moved".

Caveat, stated because the number will be quoted: this transition confounds three things — the
property-type bug, a two-month period gap (2026-05-31 -> 2026-07-31), and the two series Redfin
redefined. It is not a clean measurement of the bug alone. It IS exactly the transition the gate
sees in production, and it trips.

**ZHVI needed a threshold floor.** `moved>25%` is exactly 0.000 in all 318 monthly transitions
— ZHVI is `sm_sa`, smoothed and seasonally adjusted — so P99 x 1.5 sets the threshold to 0.0 and
the gate would fire on a single outlier ZIP. `FLOOR = 0.01` in the calibration script, with the
measurement in the comment.

**One check the per-ZIP test cannot do alone**, kept and tested: a uniform 15% national lift
moves NO individual ZIP past the 25% per-ZIP test, so the per-ZIP check is blind to it.
`test_national_median_shift_is_caught_even_below_the_per_zip_threshold` asserts exactly that,
and asserts the per-ZIP fraction is 0.0 first so the test cannot pass for the wrong reason.

### Bug 6 — the deploy fix

`deploy.yml` gains `workflow_call` with a `ref` input; `update_data.yml` gains a `deploy` job
that calls it with the data commit's SHA. A push made with `GITHUB_TOKEN` does not trigger
workflows, so `deploy.yml`'s `on: push` never fired for the data commit.

`ref: inputs.ref || github.sha` is load-bearing. Under `workflow_call` the job inherits the
CALLER's event, so `actions/checkout` would default to the SHA as of when the cron fired —
before the data commit — and deploy LAST month's data. That symptom is indistinguishable from
Bug 6 itself, which is why the deploy job prints the SHA and `period_end` it is publishing.

**Acceptance test, still owed:** confirm a Deploy job appears in the same run graph as a
publish. YAML that parses proves nothing here.

### Fingerprinting and staleness

`sources.fingerprint()` hashes `{etag, content_length, sha256 of the first 1 MB, first data
row}`. `Last-Modified` is recorded but excluded, and `LAST UPDATED` is excluded from everything:
both are stamps the publisher controls, not properties of the bytes, and including either makes
"warn once per fingerprint" degenerate into "warn every run".

Unchanged fingerprint -> exit 0, no download, no publish. Nothing new exists; that is not a
failure. `--force` overrides.

Staleness **warns**, never fails, in both the pipeline and the workflow. Spec section 1.5.1
already contains the reason and an earlier draft contradicted itself on it: a hard fail refuses
to publish, so the manifest carrying the outage banner is never written and the banner can never
render.

### `notify` no longer opens one issue per failed run

It finds the standing `pipeline-failure` issue, reopens it if closed, and comments. The old
version created a new issue on every failure, so a persistent upstream problem buried its own
signal in duplicates. Stage reports upload as a `pipeline-reports` artifact on every run.

### BLOCKED, and not worked around

Spec Phase 2 wants an immutable `data-YYYY-MM` release plus a ~6 KB pointer commit.
**`gh release list` is empty** — there are no releases at all — and creating the first ones is an
outward action on a public repo, so it needs the user, not an agent. Until then
`update_data.yml` copies `build/` into `public/data/` after both stage reports read `ok`. The
copy is at least separated from the build, so a failed build leaves `public/data/` untouched,
which the old in-place write did not.

This also still blocks, in the order todos.md already records: the archive untrack, the
`.gitattributes` LFS rule removal, and the ZHVI vintage archive.

---

## 2026-09-05 — PHASE 3: the choropleth fix

### The bug is gone, and it is now measured rather than argued

`bench/verify-choropleth.mjs` is the committed acceptance check. Against the production
build at 4x CPU throttle:

```
tileRequestsCausedBySwitch: 0
sourceReloadCounter: { before: 0, after: 0 }
```

Both conditions the spec names. Before Phase 3, every metric change called
`setPaintProperty("zips-fill", "fill-color", <step expression>)`; maplibre-gl's
`style_layer.ts` returns `isDataDriven || wasDataDriven` as `requiresRelayout`, so `style.ts`
marked the source `'reload'` and every loaded tile was re-sent to the worker, re-parsed from
cached PBF, its fill bucket rebuilt and its GPU buffers re-uploaded. In auto-scale mode this
fired on every `moveend`.

Now both `fill-color` and `fill-opacity` are CONSTANT expressions set once at `addLayer`, and
only feature-state changes. `setFeatureState` does not trigger a relayout.

### Benchmarks — slow4g / 4x CPU / 1440x900 / 5 runs / pinned view

| | phase0-baseline | phase1-after | phase3-after |
|---|---|---|---|
| LCP | 7352 ms | 7228 ms | **7012 ms** |
| TBT | 5120 ms | 4053 ms | **2934 ms** |
| long task count | 40 | 38 | **22** |
| transfer | 4,793,964 B | 5,247,137 B | 5,247,137 B |
| JS heap | 62.4 MB | 64.1 MB | **55.9 MB** |
| **metric switch** | **3375 ms** | 3190 ms | **1491 ms** |

phase0 and phase1 carry the harness warning "no performance.measure marks"; phase3 does not,
because `src/lib/perf.ts` landed. Transfer is unchanged from phase1 — Phase 3 touches no payload.

### What the remaining 1491 ms actually is, measured rather than assumed

The harness's "metric switch" times a Playwright dropdown interaction, not choropleth work.
Decomposed at the same 4x throttle (`bench/verify-choropleth.mjs` marks, plus a control run
that re-selects the ALREADY-selected option so no metric change happens):

| | ms @ 4x |
|---|---|
| dropdown open + click, **no metric change at all** | **580** |
| `class:breaks` — quantile breaks over 33,771 values | 69 |
| `class:assign` — build the 33,771-entry class map | 32 |
| `map:applyChoropleth` — write 17,053 feature states | **38** |
| `map:metricSwitch` — React effect to two frames later | 416 |

So ~580 ms is the Radix Select UI and ~416 ms is React re-rendering a tree that carries 33,771
ZIPs in props. **The choropleth work itself is 139 ms.** The spec's "< 150 ms" target is met by
the choropleth; it was never scoped to the dropdown or to React.

`class:breaks` + `class:assign` are `LegacyClassSource`, the interim authority. Phase 4's
`PaintTable` is an O(1) array read and deletes both, which is the remaining 101 ms.

### Two measurements that contradicted the spec, and one of them mattered a lot

**1. `setFeatureState` costs 0.14 us, not ~30 us.** Micro-benchmarked in-page: 10,000 calls in
1.4 ms. The full 33,771-ZIP set is therefore ~5 ms of work, a third of one frame.

**This made `CHUNK = 8_000` actively harmful.** Chunking at 8,000 spread the set over five
animation frames — and that did not cost five frames of writing, it cost five frames of
WAITING, because each chunk dirties the source and MapLibre does a full map render between
them. Raising `CHUNK` to 50,000 so the set lands in one frame took `map:applyChoropleth` on a
metric switch from **579 ms to 9 ms** unthrottled (38 ms at 4x). Nothing else changed.

The chunking mechanism is kept as a safety valve above ~100k ZIPs, with the measurement in the
comment so nobody re-tunes it downward on the old assumption.

**2. Skipping no-op writes halves the work on a switch.** The painter caches the last class
written per ZIP; a metric change leaves 16,718 of 33,771 ZIPs in the same class, so only 17,053
writes are needed. This does NOT weaken the full-set guarantee — every ZIP is still visited
every epoch, and MapLibre's own feature-state store already holds the value that would have
been re-written, so a skipped write and a redundant write leave the map identical. The
invariant it depends on (nothing else clears feature state) is documented at the field.

### The palette is derived, not asserted

`scripts/palette/derive_ramp.mjs` resamples the 12-hex source at equal CIELAB arc length and
runs the Machado-2009 CVD simulation in LINEAR RGB (applying those matrices to gamma-encoded
values, a common shortcut, overstates the remaining contrast). It refuses to write a ramp whose
L* is not monotone or whose minimum adjacent dE76 under simulated CVD falls below 10.

Measured, 12 colours -> 7:

| | source | derived |
|---|---|---|
| adjacent dE76 coefficient of variation | 0.2364 | **0.0524** |
| min adjacent dE76, protanopia | 9.01 | **19.34** |
| min adjacent dE76, deuteranopia | 8.43 | **12.68** |
| min adjacent dE76, tritanopia | 7.93 | **12.04** |
| L* | 96.9 -> 12.9, monotone | 96.9 -> 12.9, monotone |

This independently reproduces the spec's ramp exactly except `#EB5D5E` where the spec wrote
`#EB5E5E` — one unit in one channel, i.e. rounding. The spec's CVD figures (7.4 -> 11.9) differ
from mine; mine are computed in linear RGB at severity 1.0 and the script is the record.

### One class authority at a time

`LegacyClassSource` exists because Phase 3 ships a paint expression reading
`["feature-state","k"]` while the artifact that supplies `k` does not ship until Phase 4.
Without it the whole map renders `NO_DATA_COLOR`. `ChoroplethPainter` never learns where
classes come from, so Phase 4 swaps the authority in one line.

The Legend now renders the SAME break values the map is painting, straight from the live
`ClassSource`, plus a no-data swatch. It previously computed its own quantiles from its own
sample, so it could describe a scale the map was not using. Its value formatter also stopped
sniffing substrings of the metric key — that read `months_of_supply` as neither price nor ratio
and would have read any future `*_price_ratio` as a price.

### Already done, so not redone

Phase 3 lists "code-split the jsPDF/html2canvas export path". It is already split:
`ExportSidebar` is `React.lazy`, and `pdf-export` (403 KB) and `html2canvas` (199 KB) are
separate chunks. `grep -c "jsPDF\\|html2canvas" dist/assets/index-*.js` returns 0.

### Tests

`src/lib/__tests__/choropleth-painter.test.ts`, 12 cases, including the two the spec calls
mandatory: switch -> pan away -> pan back shows the correct class, and an aborted metric change
never applies stale feature state. The rAF stub queues callbacks and drains on demand rather
than running them synchronously — a stub that registers a frame it never runs wedges the
painter in a way a real browser never does, and the first version of the test failed for
exactly that reason rather than for a real defect.

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

---

## 2026-09-05 — the before/after the spec asked for, and it is worse than the example

Phase 1's Verify says "publish the before/after for 30309, 10001, 90210, 60614, 78701 in the PR
description". There is no PR, so it goes here. Both columns are real: the LEFT is what the site
actually published (`ed533dd:public/data/zip-data.json`, the last commit of the broken
pipeline), the RIGHT is the all-residential aggregate from the new feed at the same
`PERIOD END = 2026-05-31`.

| ZIP | published (buggy) | truth (all residential) | error on the price |
|---|---|---|---|
| 30309 | $360,000 / **105** sales | $402,500 / **146** sales | −10.6% |
| 10001 | $2,637,500 / 30 sales | $2,637,500 / 30 sales | 0.0% |
| 90210 | $1,840,000 / **7** sales | $6,400,000 / **75** sales | **−71.3%** |
| 60614 | $1,240,000 / **5** sales | $849,500 / **368** sales | **+46.0%** |
| 78701 | $541,000 / 72 sales | $537,000 / 75 sales | +0.7% |

The sales counts are the tell. 90210 published a median computed over **7** transactions when
75 existed; 60614 over **5** when 368 existed. 10001 matching exactly is not the bug being
absent — it is the coin landing on the aggregate row that month.

**The spec's own example numbers no longer reproduce, and that is a confirmation rather than a
discrepancy.** It quotes 30309 as $575,000 across 9 sales (a Townhouse row). The published value
today is $360,000 across 105. Both are wrong and they are wrong *differently*, because
`drop_duplicates` on an unproven key delegates the choice to quicksort's pivot, and the pivot
depends on the values inside each 100,000-row chunk. The defect re-randomizes on every run. Any
test written against one of those observed values would have been testing the coin, not the code.

`tests/test_pipeline.py::test_30309_reports_the_all_residential_truth` therefore asserts the
aggregate ($402,500 / 146) and asserts the published figure is not reachable from that row.
`test_every_fixture_zip_has_exactly_one_row_per_period` is the general form: the old feed had
five rows per (ZIP, period) and the code deduplicated on ZIP alone, so a second row appearing
here would make every downstream number a coin flip again.

---

## 2026-09-05 — copyright year automation

`scripts/update_license_year.mjs` rolls the END year of `Copyright 2025-2026 Jasper Chen`. The
start year never moves: 2025 is a statement of fact about when the work was first published,
while the end year is the last year it was modified, and only the second one has to advance.

Three behaviours worth knowing:

- A single-year notice is **widened**, not replaced: `Copyright 2025 X` in 2027 becomes
  `Copyright 2025-2027 X`. Replacing it would shorten the term claimed rather than extend it.
- The file list is explicit, not a glob. A glob would sweep `node_modules/` and `dist/` and
  rewrite third-party notices, which is both wrong and a licence violation.
- It refuses to write a start year that is after the target year, and refuses an implausible
  target, rather than "fixing" a file into a backwards range.

Two triggers, deliberately:

- `.github/workflows/license_year.yml`, cron `7 0 1 1 *`. Seven minutes past midnight rather
  than exactly midnight — every cron on the platform lands on `:00` and this job does not care.
- A CI step (`--check`) so a failed or disabled cron shows up instead of leaving a stale year on
  a public repo for a year. There is a ~7-minute window on 1 January where CI could go red
  before the cron fires; that is the cost of the backstop being real.

It does NOT call `deploy.yml`. Unlike `update_data.yml` that is not an oversight:
`deploy.yml` carries `paths-ignore: ['**.md', 'docs/**']`, so a LICENSE-only commit would not
deploy from a human push either, and nothing in `dist/` reads the year.

---

## 2026-09-05 — the spec is now tracked, on purpose

`docs/FINAL-SPEC-08-2026.md` was untracked by convention (`.gitignore` carries
`docs/FINAL-SPEC*.md`) but `docs/FINAL-SPEC.md` had been tracked all along, and a previous
session staged a `git mv` to the new name. Phase 1's `git add -A` carried that rename into
`1249f88`, so the spec has been in git since then.

Untracked again on request: `git rm --cached`, and the `.gitignore` rule that already covered
it now does its job. The last tracked copy is at `1249f88..d5b662f` if it is ever needed, which
is more recovery than the convention promised — it said explicitly "no git history and no
recovery".

---

## 2026-09-05 — react-router 6 -> 7, and why the advisories were not the reason

`npm audit` reported two moderate advisories against `react-router@6.30.6`.

**Neither is reachable in this codebase**, checked rather than assumed:

| advisory | why it does not apply here |
|---|---|
| GHSA-337j-9hxr-rhxg — arbitrary constructor injection via `deserializeErrors()` in **SSR hydration** | This is a static SPA on GitHub Pages. No `createBrowserRouter`, no `RouterProvider`, no `HydratedRouter`, no `hydrateRoot`. The hydration path does not exist. |
| GHSA-wrjc-x8rr-h8h6 — open redirect via backslash in `<Link>` / `useNavigate` | `useNavigate` appears **nowhere**. There is exactly one `<Link>`, `to="/"`, a hardcoded literal. No user input reaches a navigation target. |

So the upgrade was not a fix for an exploitable hole. It was taken anyway, for a
different reason: **an audit that always reports something is an audit nobody reads.**
Same argument as a contract that fires every month.

**It cost nothing, and that was verified rather than hoped.** Zero source changes —
`BrowserRouter`, `Routes`, `Route`, `Link`, `useLocation` and `useSearchParams` are the
entire surface and all keep their v6 API in v7. `tsc`, lint, 75 vitest, 34 pytest and
the production build all pass untouched.

**Runtime-checked on both versions, same script, same three surfaces** — because
`useSearchParams` carries the app's whole URL state (zip, metric, lat, lng, zoom) and a
silent regression there would look like a map bug, not a router bug:

| check | v6.30.6 | v7.18.3 |
|---|---|---|
| deep link `?metric=median_dom` read back into the UI | "Median Days on Market" | identical |
| metric change written back to the URL | `...&metric=median_sale_price` | identical |
| catch-all route renders NotFound with a working link | `404`, href `/Domapus` | identical |

**One thing the comparison caught and cleared.** The URL after a metric change is
`/Domapus?...` with no trailing slash, which looked like a v7 basename regression.
Running the identical script against a v6 build produced the same string, so it is
pre-existing behaviour and not something the upgrade introduced. Worth knowing anyway:
GitHub Pages 301s `/Domapus` to `/Domapus/`, so a copied URL costs one redirect hop.

**Cost:** the main bundle grows 402,753 -> 419,240 bytes, +16 KB uncompressed, ~+4%.
Accepted; it is a fraction of the 5.0 MB the page already transfers, and it does not
touch the critical path the phase-3 work was measured on. The choropleth acceptance
check still reports 0 tile requests and `map:sourceReload` = 0 on the v7 build.

Also dropped `d3-array` and `@types/d3-array` from `package.json`. Nothing in `src/`,
`scripts/` or `bench/` imports it; it stays installed as a transitive dependency of
`d3-scale`, so this removes a declaration, not a package.

---

## 2026-09-05 — `docs/ENGINEERING-LOG.md` untracked

Same reasoning as the spec: a local working document that churns far too fast to be
worth reviewing in diffs. `git rm --cached`, rule added to `.gitignore`, file stays on
disk. History up to `50cc65b` remains in git if an earlier version is ever wanted.

`docs/AGENT-LOG.md` and `docs/todos.md` stay tracked — they are the handoff surface
between sessions, and a handoff nobody else can read is not a handoff.

---

## 2026-09-05 — CI failed on a pin I chose badly, and the fix is a guard not a bump

**What broke.** `pip install -r requirements.txt` spent four minutes compiling and died on:

    Could not find a package configuration file provided by "Arrow"
    error: command 'cmake' failed with exit code 1
    ERROR: Failed building wheel for pyarrow

**Cause, and it was mine.** I pinned `pyarrow==19.0.1` because that is what `python -c "import
pyarrow"` reported locally. `.python-version` is **3.14**, and pyarrow 19 has no cp314 wheel, so
pip fell back to a source build. The log gives it away: `build/lib.linux-x86_64-cpython-314`.
`numpy==2.2.4` was doing the same thing directly underneath.

The trap is a two-interpreter local machine: bare `python` is **3.13.5**, bare `pip` targets
**3.14.5**. So `pip install` produced cp314 wheels while `python -c "import pyarrow"` reported
the 3.13 environment's version. Pinning what `python` reported pinned the wrong environment's
answer. `py -3.14` reaches the interpreter CI actually uses; todos.md now says so.

**Measured wheel availability** (PyPI, cp314 manylinux x86_64):

| package | first release with a cp314 wheel |
|---|---|
| `pyarrow` | **22.0.0** (19.0.1 is three majors short) |
| `numpy` | **2.3.2** (2.2.4 is short) |
| `pandas` | 2.3.3 — the existing comment was right |

**Fixes, in order of how much they matter.**

1. **`pip install --only-binary=:all:` in both workflows.** This is the real fix. It converts
   "no wheel for this Python" from a four-minute CMake error that names Arrow rather than the
   cause into an immediate one-liner that *lists the versions that would work*:

       ERROR: Could not find a version that satisfies the requirement pyarrow==19.0.1
       (from versions: 22.0.0, 23.0.0, 23.0.1, 24.0.0, 25.0.0, 25.0.1)

   Verified both ways: it rejects the old pin instantly and accepts the new file.

2. **`pyarrow==25.0.1`.** Latest, not the 22.0.0 minimum, because the version had to be
   re-verified against the real file either way and there is no reason to verify an older one.
   **The whole 1.33 GB pipeline was re-run under Python 3.14 with pyarrow 25 and
   `zip-data.json` is byte-identical** — sha256 `bd796dfe351a9b15fc4400279b0c49e12a3e267d4ed3c2f86fa6f328370198d8`
   before and after, with panel shape, coverage and orphan count all unchanged. The bump moves
   no published number. 34 pytest pass on 3.14.

3. **`numpy` removed, not bumped.** Nothing in `pipeline/`, `tests/` or `scripts/` imports it —
   `gate.py` computes its own median precisely so the gate carries no numeric dependency — and
   it arrives transitively via pandas anyway (2.5.2 on the 3.14 env). Declaring a package
   nothing imports is how you end up maintaining a pin for a dependency you do not have. Phase 5
   adds it explicitly with scipy and statsmodels.

**The general shape, again.** A constant was carried into source from whatever the local
environment happened to report, without checking it against the environment that would actually
consume it. That is the same failure as the choropleth chunk size and the inherited column
bounds: a plausible number nobody checked against the thing itself.

### Deploy acceptance test — partial result from run 33974615713

The failed run is still informative, because two of the three jobs behaved correctly:

| job | result | reading |
|---|---|---|
| `update-data` | failure | the pip build, above |
| `deploy` | **skipped** | correct — `needs.update-data.outputs.changed` is empty when update-data fails |
| `notify` | **success** | opened **#90 "Market data pipeline failure"** with the `pipeline-failure` label |

So the notify rewiring is **verified working**: one labelled issue, not one issue per run.
`deploy` skipping on a failed build is also the right behaviour, but it means the actual Bug 6
acceptance test — a Deploy job in the same run graph as a *successful* publish — is still owed
and needs a green `update-data`.

---

## 2026-09-05 — the deploy acceptance test, and the gap it exposed

Run 33985964118, after the pyarrow fix: **`update-data` succeeded**, and `deploy` was
**skipped**.

That skip is correct. `if: needs.update-data.outputs.changed == 'true'`, and the data had
not changed — same Redfin vintage, same period, already published locally — so
`data_points_changed` was 0, nothing was committed, and there was nothing to deploy.

**But it means the fix for Bug 6 could not be verified.** The bug is "the data commit never
deploys"; the acceptance test is "a Deploy job appears in the same run graph as a publish";
and until upstream data happens to change there is no publish to attach it to. A fix that
cannot be tested until the failure condition recurs naturally is a fix nobody can trust.

**Added `force_deploy`, a dispatch-only input.** `if: ... || inputs.force_deploy` runs the
Deploy job regardless of whether data changed. `ref` is then empty, and `deploy.yml` already
falls back to `github.sha` for exactly that case. It doubles as the way to redeploy current
data after a frontend-only change.

Run history so far:

| run | update-data | deploy | notify | what it proved |
|---|---|---|---|---|
| 33974615713 | failure (pyarrow build) | skipped | **success** | notify opens ONE labelled issue (#90), not one per run; deploy correctly refuses to run on a failed build |
| 33985964118 | **success** | skipped | skipped | the pipeline runs end to end on the runner; the no-change path publishes nothing, as designed |
| next, with `force_deploy` | — | — | — | the Bug 6 wiring itself |

---

## 2026-09-05 — the rest of the dependency alerts

The push warned about 5 alerts where local `npm audit` reported 0. Split by ecosystem:

**pyarrow, GHSA-rgxp-2hwp-jwgg, HIGH** — use-after-free reading an IPC file with
pre-buffering, `>= 15.0.0, < 23.0.1`. Already showed `state: fixed` by the time it was
looked at, because the CI fix had moved the pin to 25.0.1.

**This one retroactively justifies a choice that was made for a different reason.** The pin
had to clear cp314, whose minimum is 22.0.0; latest was chosen instead only because the
version needed re-verifying against the real file either way. **22.0.0 would have satisfied
the wheel requirement and kept a high-severity advisory open.** Picking the minimum that
satisfies the stated constraint is not the same as picking the right version, and here the
difference was a HIGH.

We do not read Arrow IPC files — the pipeline reads CSV and reads/writes Parquet — so the
advisory was very likely not reachable either. Fixed regardless; the cost was zero.

**requests, GHSA-gc5v-m9x4-r6x2, medium** — insecure temp file reuse in
`extract_zipped_paths()`, `< 2.33.0`. Bumped to 2.33.0. Pure-Python wheel, so no cp314
question. 34 tests pass on 3.14.

**react-router x2, medium** — fixed by `d6a1380`; the alerts predate that push and clear on
the next scan. Local `npm audit` already reports 0.

---

## 2026-09-05 — a workflow GitHub silently refused to run

**Symptom.** Three consecutive CI runs failed with no failing step, no
annotation, and no log — `gh run view` said only "This run likely failed because
of a workflow file issue". The giveaway was in `gh run list`: the workflow's name
showed as **`.github/workflows/ci.yml`** rather than **`CI`**. GitHub falls back
to the file path when it cannot parse the file well enough to read its `name:`.

**Cause.** One line:

    run: pip install --only-binary=:all: -r requirements.txt

A plain YAML scalar **may not contain ": "** — colon followed by space. Here
`--only-binary=:all:` is followed by ` -r`, so the parser sees a nested mapping
where a string was intended. Nothing about the line looks like YAML, which is
what makes it easy to write and hard to see. In a block scalar the same command
is fine:

    run: |
      pip install --only-binary=:all: -r requirements.txt

**How it got in.** I edited `ci.yml` and then validated `update_data.yml`. The
other file got the same flag but inside an existing `run: |` block, so it was
genuinely fine — and its run succeeded, which made the green "Update ZIP code
market Data" run look like evidence the change was good. Validating a file
adjacent to the one you changed is not validating your change.

**Fix, and the guard.** `scripts/check_workflows.py` strict-parses every
workflow and reports file, line and column. Verified both directions: it passes
on the corrected tree and, with the plain scalar reintroduced, reports
`ci.yml: mapping values are not allowed here (line 67, column 44)`.

Wired in **two** places, deliberately:

* `.githooks/pre-commit` — the only place that catches `ci.yml` breaking itself,
  since a workflow that will not parse never reaches the job that would check it.
  Skips silently if PyYAML is absent so it cannot block a commit on a bare
  machine.
* the `pipeline` CI job — catches every *sibling* workflow, and runs even for
  contributors who have not enabled the hook.

Neither placement covers the whole space alone. The pair does, and the docstring
says which is which so nobody later deletes one as redundant.

**Worth noting what this failure mode costs.** A broken workflow file is
invisible in every place you would normally look: no red step, no annotation, no
log line. Only the run's *name* changes. That is a worse signal than the
property-type bug's, which at least produced a wrong number somebody could check.

---

## 2026-09-05 — Bug 6 is verified fixed

Run **33986134801**, dispatched with `force_deploy=true`:

    update-data      ->  success
    deploy / deploy  ->  success      <- a Deploy job in the SAME run graph
    notify           ->  skipped

That is the acceptance criterion the spec names, and it is the one that could not be met by
reading YAML: a miswired `workflow_call` fails exactly like the bug it fixes.

The deploy job's own report closes the second half — that it deploys the RIGHT commit:

    ref input : ''
    deploying : 7880a47fdf3456752efe3bcbefde520441961d49
    period_end: 2026-07-31

`ref input` is empty because nothing was committed on a forced redeploy, `deploy.yml` fell back
to `github.sha` as designed, and the published period is current. Both branches of
`ref: inputs.ref || github.sha` are now exercised — the commit SHA path will run on the next
month with real data.

Three runs, three different things learned:

| run | what it proved |
|---|---|
| 33974615713 | `notify` opens ONE labelled issue (#90), and `deploy` refuses to run on a failed build |
| 33985964118 | the pipeline runs end to end on the runner; the no-change path publishes nothing |
| **33986134801** | **the `workflow_call` wiring, the `ref` fallback, and the published period** |

CI itself is green again on `d7fa515`, and its run is named `CI` rather than its own file path,
which is the other half of the workflow-parse fix.


---

## Phases 4 and 5 — LANDED 2026-09-05, commit `477acd1`, pushed to `main`

Paint byte, typed-array store, real bboxes, and the whole statistics layer, in one
commit. They cannot be separated: the paint byte is
`(reliability_tier << 4) | (class_index + 1)` and both fields come from Phase 5
modules, so splitting them ships a file whose every byte is undefined. The wire
format change is one commit for the same reason — pipeline, worker, `types.ts` and
the frontend all read the same positional contract.

### Measured, `bench/results/phase5-after.json`, 3 runs, slow4g / 4x CPU / 1440x900

| | phase3 baseline | phase5-after | |
|---|---|---|---|
| **bytes before first colour** | **2,570,348 B** | **27,780 B** | **92.5x** |
| metric switch | 1,848 ms | 647 ms | 2.9x |
| LCP | 7,240 ms | 6,212 ms | -14.2% |
| TBT | 3,914 ms | 2,695 ms | -31.1% |
| long task count | 26 | 18 | -30.8% |
| transfer | 5.01 MB | 5.17 MB | +3.1% WORSE |
| requests | 41 | 45 | +9.8% WORSE |
| JS heap | 56.0 MB | 63.7 MB | +13.8% WORSE |

The three regressions are structural and expected: the snapshot went 38 -> 50
columns, and the manifest and paint table are two more requests. None is on the
path to first colour. `class:assign` (48 ms) and `class:breaks` (94 ms) disappear
entirely — the pipeline does that work now — and `store:construct` is 5 ms.

`GATES_FIRST_COLOR` in `bench/run.mjs` changed with the architecture, which is the
metric working rather than cheating: the snapshot no longer gates paint, so
counting it would report 2.5 MB and claim the phase changed nothing.
`gatingBytesLegacy` still reports the old definition alongside.

### The five numbers that moved, and why each mattered

**K = 0.5598, not 0.5395.** Refitted on the migrated `173 x 33,952` panel. The
method reproduced on a completely different file — same plateau shape, same lag-1
attenuation (`0.5598 * 0.43 = 0.241` predicted vs `0.2369` measured) — which is
better evidence for the estimator than the original fit was.

**The rankable gate is `rse < 10%` = n >= 32, not `n >= 30`.** This is the one to
remember. `n >= 30` was never a chosen threshold; it was `0.5395/sqrt(30) = 9.85%`
rounded to a nice integer. At the new K, n = 30 gives 10.22% and is *not* rankable.
Hardcoding 30 would have quietly made the "one threshold, explained once" property
false — the map would gate on one number while the methodology page explained a
different one. `noise.py` derives it from the fitted K and publishes
`rankable_n_implied`. Rankable population: **9,456 of 25,603 reporting ZIPs**,
superseding both the dead feed's 8,544/20,010 and the 9,781 the paint-table
experiment used.

**The selection effect is four times worse than the spec estimated.** Rankable
ZIPs have a median price of $394,884 against $275,953 for excluded ones, and
**24.8%** of thin ZIPs land in the bottom colour class against **5.5%** of reliable
ones — the spec said 11.3% vs 4.2%. Same direction, much larger. `classify.py`
publishes all four numbers so the legend copy cannot drift from them.

**Redfin publishes a +30,993,016% year-over-year change.** ZIP 12207 (Albany, NY)
recorded a $1 median sale price in 2025-07 — one $1 transaction. The published YoY
is arithmetically correct, useless, and too large for the int32 the wire format
uses. `changes.py` nulls a ratio change whose base falls below that metric's own
declared range floor: there is no honest value to clamp to, because we do not know
what that ZIP's prices did, only that its year-ago sample was one $1 sale.

**The YoY reconciliation contract needs a propagated tolerance, not a flat one.**
We recompute from *published* levels, which are rounded; Redfin computed from
unrounded ones. The base's quantisation propagates as
`(|yoy| + 100) * quant / base`, so half a cent on a $1.01/sqft base is 41
percentage points on an 8,400% change. With that: `median_sale_price` 0 of 23,738
exceed, `median_list_price` 1 of 25,625, `median_list_ppsf` 42 of 25,570,
`median_ppsf` 62 of 23,673. The survivors are ZIPs whose base Redfin has since
**restated** (31905's published YoY implies a 2025-06 level of 491,058.7 against
the 492,250.0 now in the file), which no tolerance on our side can reconcile. So
the contract is a SHARE, gated at 1% against a worst measured 0.262% — sharp
against the failure it exists to catch, since a lag or units error moves every ZIP.

### The LISA gate did what it was designed to do

This is the result worth keeping. `lisa_median_n_by_class` ungated:
`HH 38 / ns 22 / LL 5 / LH 6 / HL 2`. The spatial-outlier classes were a low-sample
detector wearing a spatial-statistics costume — sampling noise pushes a thin ZIP
away from its neighbourhood mean, which is the definition of an HL/LH outlier.

Gated to the 9,456 rankable ZIPs: **`ns 87 / HH 74 / LL 68 / LH 77 / HL 86`**. The
classes are no longer separable by sample size. The 27 HL and 20 LH survivors are
real. Moran's I on the gated set is `0.7699 / 0.7343 / 0.6862 / 0.6363` at
k = 4/8/16/32 — uniformly *higher* than ungated, because the ungated graph is
diluted by ZIPs whose value is mostly noise.

### The forecast's interval story held up

83 origins, quarterly, expanding window, 41 calibrate / 42 evaluate. Nominal 80%:

| method | h=1 | h=3 | h=6 | h=12 |
|---|---|---|---|---|
| random walk `sigma*sqrt(h)` | 81.3 | 44.0 | 30.2 | 24.7 |
| AR(1) own closed form | 89.4 | 78.2 | 75.8 | 78.6 |
| **empirical quantiles (shipped)** | **82.8** | **80.7** | **82.0** | **87.9** |

MASE 0.395 / 0.592 / 0.697 / 0.680. Most of the gap is using a random-walk variance
for a model that is not a random walk; empirical calibration closes the rest, and
that remainder is non-normality. 83 origins are worth about **20 independent** ones
at a quarterly stride with h=12, and that is the number published.

### Four bugs found by running the app, not by tests

All 85 vitest and 37 pytest passed throughout. These came from opening a browser.

1. **The painter's write-skip cache keyed on the class index alone.** Reliability
   used to be metric-invariant on the client too, so `k` was the only thing that
   could change between epochs. It is not any more: `ACTIVE_LISTINGS` is exempt
   from the reliability fade and expresses that by reporting every ZIP as tier 3.
   A ZIP whose class happened to match under both metrics was skipped, kept the
   previous metric's tier, and stayed faded on a map that must not fade anything.
   Now keyed on both, with a regression test.
2. **The map never initialised when its container measured 0x0 at mount.**
   `tryInit` gives up at zero size and the ResizeObserver only ever resized a map
   that already existed, so it never retried. Symptom: permanently blank map, no
   canvas, no style request, no failed fetch, no error anywhere — and intermittent,
   because it came down to layout timing. Pre-existing; the new load order changed
   when the container settles and made it reproducible.
3. **`loadedZips()` threw when called before the `zips` source existed.** It runs
   from the map's own `load` handler, which fires when the STYLE is ready; the
   source is added later.
4. **`<link rel="preload" as="fetch">` needs `crossorigin` even same-origin.**
   Without it the preload and the fetch land in different cache entries and the
   file downloads twice — measured 27,780 -> 55,560 B before first colour. The
   obvious repair makes it worse: `crossorigin` means credentials mode
   *same-origin*, not *omit*, so adding `credentials: 'omit'` to the fetch breaks
   the match in the other direction. The paint preload link was then dropped
   entirely, because its filename is metric-dependent and static HTML cannot read
   `?metric=`.

### Judgement calls the spec did not make

- **Section 6.6 assigns no classing scheme to three painted metrics.**
  `active_listings`, `median_dom` and `months_of_supply` appear in none of its four
  families. All three are right-skewed positives with no anchor value the way 100%
  is for a share, and rank is what a reader compares, so they joined the quantile
  family.
- **"Equal interval anchored at 100%" is a 100-pinned grid whose width comes from
  p1..p99**, not equal intervals over a literal [0, 100] domain. The literal
  reading collapses `sold_above_list` into two colours — the exact failure section
  6.6 rejects when it argues against unanchored log classing.
- **The fade carve-out lives in feature-state, not in a second paint expression.**
  Swapping expressions on a metric change calls `setPaintProperty` on a value
  MapLibre has seen as data-driven, which marks the source `reload` and re-parses
  every tile: the 3375 ms regression Phase 3 removed.

### Closed in the same pass

Section 12 items **5** (median vertex spacing **292.9 m** over 5,624,668 segments —
do NOT take the TIGER branch; the ~150 m rule was a proxy for "too coarse to draw"
and at z10 one CSS pixel is ~117 m, so the median segment is ~2.5 px), **7**
(per-metric K: `median_dom` 1.4576, `avg_sale_to_list_ratio` 0.0749), **11** (gated
LISA) and **12** (the 398-ZIP classing gap — it was two populations, not a lost ZIP).

`pytest` 8.4.2 -> **9.1.1**, which closes Dependabot alert 46: pytest through 9.0.2
puts temp directories at the predictable `/tmp/pytest-of-{user}` (CVE-2025-71176)
and the pinned 8.4.2 was inside the vulnerable range. The spec's `9.0.3` was the
patch, not an arbitrary newer number. 9.x is a major bump, so it was verified
rather than assumed: all 37 tests pass.

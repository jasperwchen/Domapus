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

---

## 2026-09-06 — Phases 6 and 7

Docker Desktop was started by the user, which unblocked the only hard blocker.

### Phase 6 — geometry

`Dockerfile.tippecanoe` (felt/tippecanoe 2.78.0, built from source, committed so the
*compiler* is pinned too), `scripts/geometry/build_geometry.sh`,
`scripts/geometry/verify_coverage.mjs`, `geometry.lock.json`, `.github/workflows/geometry.yml`.
`scripts/geometry/build_sidecar.sh` is deleted — `build_geometry.sh` is a strict superset and
two copies of the same mapshaper invocation is a divergence waiting to happen.

**The coverage loss is now measured by this repo, not inherited.** `verify_coverage.mjs`
decodes the finished archive and counts distinct `ZCTA5CE20` per zoom. Against the *old*
tileset: **1,952 missing at z3 (5.8%), 841 at z4** — the default view — and only z12 complete.
The old archive's own metadata says why: it was built `--drop-densest-as-needed` with
`--no-tiny-polygon-reduction-at-maximum-zoom` (note: *at maximum zoom*, not the full flag), so
`dropped_by_rate` is 99 at z3 / 94 at z4 and `tiny_polygons` 5,225 / 2,354. Bug 2, recorded by
the tool that caused it. The rebuilt archive has **no `strategies` block at all**.

After: **z3-z10 carry all 33,780**, as polygon or dot. A1 and A4 pass exactly — 33,791 source,
33,780 kept, 11 territory features dropped, matching the lock file.

Three places the spec was wrong, all resolved by measuring:

- **A7 cannot be "100% polygons at every zoom".** At z2 one pixel is ~39 km at 40°N, so a
  smaller ZIP cannot survive quantisation however it is tiled. §5.6's dot layer is the spec's
  own answer, so A7 now asserts *represented* — polygon **or** dot — and gates from z3, the
  main map's `minZoom`. z2 exists only for the AK/HI export insets and is 75 short; all 75 are
  lower-48 (IL, MI, OH, NY) and appear in no z2 inset. Reported, not gated.
- **A6's 500 KB raw cap was written when the tileset still dropped features to stay small.**
  Carrying every ZCTA at low zoom is the point of the rebuild. Measured worst tile is
  **806,400 B raw at z2** (743,661 B stored across all three z2 tiles). Cap moved to 1,000,000 B
  — still a tripwire, ~24% headroom. The old tileset also breached 500 KB (564,080 B at z3), so
  the cap was never met by anything.
- **The archive is 46,948,252 B, not the estimated ~20 MB.** 2.0x, not 4.6x. The estimate
  assumed tippecanoe would keep dropping features.

**The honest performance result, which is not the one the spec predicted.** §3.7 claims page
weight falls to ~2.9 MB after Phase 6. Measured at the pinned view, tile transfer went
**1,052,980 -> 1,426,268 B (+35%)** and total transfer 5.42 -> 5.79 MB. Correctness cost bytes:
z4 now ships all 33,712 ZCTAs instead of dropping 841 and merging tiny ones into squares, and
the size cut came from dropping z11/z12 — zooms this view never requests. TBT 2695 -> 2997 ms
for the same reason. **Do not repeat the 1.9x page-weight claim.** The defensible claims are
the deploy footprint (92.6 -> 46.9 MB) and the coverage fix.

§12 #16 closed: the z2 tiles cost **743,661 B stored**, against the estimated 0.2-0.3 MB.
Phase 3's invariant still holds on the new tileset — `map:sourceReload` 0, no tile refetch
through a metric switch.

**A JavaScript bug worth remembering, because it looked like corrupt data.** The MVT parser
skipped length-delimited fields with `r.pos += r.varint()`. JS reads the left-hand `r.pos`
*before* evaluating the right-hand call, so the length prefix's own bytes were counted twice
and the reader landed short, then read a tag byte out of the middle of a field and threw
"unsupported wire type 7". It presented as a malformed archive.

### Phase 7 — history and sparkline

`pipeline/history.py` (stage S8), `src/lib/history.ts`, `src/components/dashboard/Sparkline.tsx`,
wired lazily into `Sidebar.tsx`. `forecast.py` now keeps `f_h1`/`f_h3`/`f_h6` — `model["f"]` was
always a 4 x Z array and `run()` discarded three rows.

**The break marker has no valid target, and that is a measured result, not a shortcut.** The
user asked for the mid-2026 discontinuity in `sold_above_list` and `median_list_price` to be
marked. Measured on the panel: the cross-sectional median of `sold_above_list` runs
**15.01 -> 16.67** across the 2026-05/06 boundary against **16.45 -> 17.33** for the same months
a year earlier, and `median_list_price` is **flat at 339,900** straight through. Redfin restated
the whole history under the new definitions rather than switching over going forward, so the
series we hold are internally continuous. Drawing an axis break inside them would invent a
discontinuity. What is true is that they no longer match what this site published before the
migration (+6.70 pp, -$8,200), so they ship as per-series *restatement notes*. The chart draws a
break line exactly when `notes[series].at` is non-null; it is null for both today. §12 #23
closes as "no splice, no break — restated upstream".

**§4.4's sizing was low by ~8x and the shape had to change.** The panel is dense: only 11.9% of
Redfin cells are null and the median series has no leading or trailing padding to trim.

- ZIP3 buckets are 37 ZIPs x 665 cells = **~124 KB raw / ~43 KB gz**, against the estimated
  45 KB / 11 KB. That misses Phase 7's own "< 200 ms on slow-4G" by an order of magnitude.
  **Bucket depth is 4**: 6,085 buckets, median **19,087 B raw / 6,382 B gz**. ZIP4 neighbours
  are a tight local cluster where ZIP3 is a whole region, so the prefetch is worth more.
- The axes, q table and notes are identical in every bucket. Inlined they were ~8.5 KB per file
  = ~52 MB of pure repetition, a third of the payload. They ship once in
  **`history/index.json` (50,303 B raw / 16,198 B gz)**. First click 22.6 KB gz, every click
  after 6.4 KB.
- **Series are §4.4's three** (`msp`, `hs`, `zhvi`). `abv` and `mlp` were added and then removed
  once the measurement above showed there was no break to draw — the only reason they were there.

`dist` is **198 MB** (history 121, tileset 45, snapshot 11). Under the 300 MiB guard.
`prune-dist.mjs` gained `data/temp-geo`: the geometry build unpacks a 162 MB Census shapefile
under `public/`, which Vite publishes wholesale — the first build after a geometry run was
**360 MB** and would have failed the deploy guard.

Verified in a real browser at the pinned view: series switching, the confidence slider moving
the band across all six levels, the band and slider appearing only for ZHVI (the only forecast
series), and — with `fetch` patched to reject every `/history/` request — the sidebar still
rendering all 15 metric cards with no error boundary. 122 tests pass (85 vitest, 37 pytest).

### Corrections to `todos.md` that were already stale

- **The gh-pages cleanup commit is obsolete and must not be pushed.** `deploy.yml` uses
  `peaceiris/actions-gh-pages@v4` with `force_orphan: true`, which replaces the branch with one
  commit per deploy. gh-pages is **1 commit, 119.88 MiB, no `pr-preview/`**. The prepared
  commit `a2e8476` is 7 commits and a **133.45 MiB** tree from 2026-08-29 — bigger and older.
  Pushing it would revert the live site and regrow the branch.
- The `data-2026-07` release exists with all seven snapshots plus the ZHVI vintage;
  `.gitattributes` is empty and `public/data/archive/**` is untracked. Phase 0.2 is finished
  and both P0 items are closed.
- The export-inset half of Phase 6 landed in Phase 4 already — `ALASKA_DEFAULT_BOUNDS` is
  `[[-168.0, 54.5], [-130.0, 70.0]]` and the "we don't want to rebuild the tileset" comment is
  gone. The spec's Phase 6 section is stale on this.

AGENT_LOG.md renamed to CHANGES.md
all temp source file (redfin, zillow, zip cb) moved to temp-data/
### 2026-09-06, later — the full pipeline run that closes Phase 7's placeholder

Both source CSVs were on disk the whole time; the earlier search only looked in `temp-data/`
and the Redfin file there is the **dead pre-migration feed**
(`zip_code_market_tracker.tsv000.gz`). The live one was in `temp-redfin/`, since moved to
`temp-data/redfin/`.

```
py -3.14 -m pipeline \
  --redfin-csv temp-data/redfin/redfin_data_center-housing_market-monthly-all_zips.csv \
  --zhvi-csv   temp-data/Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv \
  --skip-probe
```

Exit 0, all stages S0-S8. S8: **6,085 buckets, 33,458 ZIPs, 173 periods x 319 ZHVI months,
107.0 MB, median bucket 19,087 B.** The forecast paths are now real — **0 of 26,261 ZIPs have
all four horizons identical**, against 100% before (30303 declines 205,213 -> 196,930 across
h1..h12; 30305 and 30306 rise). §12 #4's history-bucket **[E]** is now **[M]**.

**The run is a clean determinism check.** Against the snapshot published 2026-09-05 from the
same inputs: **0 of 50 columns differ**, same ZIP list, same `d` arrays. Only `built_utc`,
`generated_utc` and the new `manifest.history` block moved.

**Pre-existing bug found by that comparison, NOT introduced here and NOT fixed here.**
`serialize.count_changes()` reported **28,919 changed data points against bit-identical
output**. It compares full-precision in-memory `records[z][k]` against `live[z][k]` decoded
from the snapshot, which was quantised on the way out — 0.13995 encodes to 1400 at scale 1e4
and decodes to 0.14, so the `!=` fires on quantisation, not on change. Consequences:
`update_data.yml`'s "Check for changes to commit" gate (`data_points_changed > 0`) can never
say no, and `built_utc` churns every run even when nothing moved. The fix is to compare
*encoded* integers, the way `_assert_value_round_trip` already deliberately does — it has a
comment explaining exactly why decoded comparison is the weaker test. Left alone because it is
outside Phases 6-7 and touches the publish gate.

`dist` re-measured after the real run: **198 MB**.

**DECIDED 2026-09-06 (user): the tileset stays committed in git**, rather than moving to a
`geometry-vN` release per §5.9. `deploy.yml` therefore needs no geometry download step and
cannot deploy a blank map through a silent fetch failure. Accepted cost: every geometry
rebuild adds a permanent ~47 MB blob to history. `geometry.yml` still publishes a release when
given a tag, so the §5.9 path stays available without rewriting anything.

---

## 2026-09-06, later still — the change report, the publish gate, and the paint hole

Closes the "Pre-existing bug found by that comparison" note above, and finds three more
things behind it. Verified by a full offline run against the same two local source files:
**33,771 ZIPs, 0 moved, 0 cells changed** where the old code reported 28,919.

### The 28,919 was a constant, and the earlier diagnosis named the wrong cause

The note above blamed quantisation — full-precision `records[z][k]` against a `live[z][k]`
that was decoded from a rounded int. That hazard is real but it was **not** what was firing.
`assemble()` already runs `units.coerce`, which rounds every metric to the decimals the wire
scale carries, so those cells compared equal.

The actual cause: `count_changes` iterated `SOURCE_KEYS`, which contains **`period_end`** — a
key with no wire column. `live[z].get("period_end")` was therefore `None` for every ZIP on
every run, so every Redfin-reporting ZIP read as changed by exactly one point, forever.

    28,919  =  coverage.both 25,604  +  coverage.redfin_only 3,315

and the tell was in the published file the whole time: `zip_codes_changed` and
`data_points_changed` were **equal**, which can only happen if exactly one field differs per
ZIP. A real month cannot produce that.

### What replaced it

`serialize.count_changes` and `load_live` are gone. In their place:

| | what it answers |
|---|---|
| `read_live` | the live snapshot, parsed, nothing decoded — read once per run |
| `decode_live` | native-scale values for the **diff gate**, which asks "did this move 25%" |
| `diff` | wire-int comparison for the **change report**, which asks "did this move at all" |
| `encode_columns` | the one encoder, shared by `write_snapshot` and `diff` |
| `payload_digest` / `release_digest` | the publish decision |

Both sides of `diff` now go through `encode_columns`, so quantisation cannot masquerade as
movement and a key with no column cannot be compared at all. It reports `added` / `removed` /
`changed` separately, plus a **`by_column` map sorted descending** — which is the diagnostic
that was missing. One column moving for every ZIP while nothing else moves is a lost scale or
a renamed column, and it now says so instead of printing one large number.

Three statuses replace one integer: `compared`, `no_baseline`, `format_change`. The old
version returned `(0, 0)` for a missing baseline, and `update_data.yml` gated **both** the
commit and the deploy on that number being positive — so an unreadable live snapshot would
have silently skipped publication. That direction is now impossible.

### The publish gate is a digest, not a count

`manifest.content_digest` is a sha256 over the snapshot's content columns (`f`, `z`, `d`,
`dicts`, `scales`, `breaks`, `classing`, the period fields) **plus every paint table's own
hash**, with timestamps excluded. Rebuilding over unchanged input reproduces it exactly, so
the answer no longer depends on what a developer last left lying in `public/data/`.

That separates two questions the old count conflated, and the verification run demonstrates
both at once: **0 cells moved** (the data is identical) and **content CHANGED** (the
`zhvi_yoy` paint table and its breaks are not). A single count could not express that.

A missing or unreadable live digest means CHANGED. A redundant deploy is cheap; a skipped one
looks exactly like the deploy bug this repo already spent a phase fixing.

### An ordering trap, found by running the thing

The first draft called `diff` at S3, next to the gate. Seven wire columns — `rel`, `msp_rse`,
`dom_rse`, `f_h12`, `f_sigma`, `f_tier`, `lisa` — are written by S5/S5b/S5c, which is *after*
the gate, so the diff compared this build's empty statistics against the live snapshot's real
ones and called every ZIP changed. The same shape of false positive as the bug it replaces, in
a new place. `diff` now refuses a build whose records all carry a null `rel`, with a test.

### `build/paint/` was never published — the worst of the four

`update_data.yml` copied `zip-data.json`, `last_updated.json`, `manifest.json` and
`orphans.json` into `public/data/`, and staged those four. It never touched `build/paint/`,
and `public/data/paint` was not in the `git add` list.

Paint filenames carry a content hash, so a data change renames all nine. The workflow was
therefore committing a manifest naming files that were not in the repo. `vite.config.ts`
inlines `manifest.assets.paint` into `index.html` at build time precisely so the 24 KB paint
fetch starts in the same tick as the manifest fetch — so this is not a 404 on a background
asset, it is a 404 on the critical path, and the map renders grey.

It has not fired yet only because the count above could never say "unchanged" while the paint
hashes happened to still match a hand-copied local build.

Fixed three ways: the publish step replaces `public/data/paint` wholesale (so last month's
hashed files disappear rather than accumulating), a new step runs `sha256sum -c` over every
`manifest.assets.paint` entry **before** the commit, and the commit stages
`git add -A public/data/paint` so deletions are staged too. Accepted cost: ~900 KB of new
blobs per release, ~11 MB/year, against a 131 MiB repo. The alternative — paint on the data
release, fetched at deploy time — reintroduces the silent-fetch-failure mode already rejected
for the tileset.

The `sha256sum -c` that `vite.config.ts`'s comment claims verifies the deploy now exists. It
did not when that comment was written.

### An unchanged upstream made the workflow go red

S0 exits 0 without downloading when the fingerprint matches the live manifest, and its module
docstring says in as many words that this "is not a failure and must not be reported as one".
But it writes no `build/manifest.json`, and the very next step ran
`jq -r '.validation.period_age_days.redfin' build/manifest.json`. Every step after the
pipeline failed on a missing file.

A `Did upstream change?` step now reads `build/s0_probe_report.json` and every build-dependent
step is guarded on it. A `force_rebuild` dispatch input was added too, wired to the `--force`
flag that already existed and that nothing called: after a PIPELINE change, S0 short-circuits
and the fix would otherwise not reach the site until Redfin happens to publish.

### The diverging colour scale was asymmetric

`_diverging_breaks` computed `step = bound / (EDGES / 2 + 0.5)` = `bound / 3.5`. For six edges
symmetric about zero with the outer two landing on ±bound, the five gaps between them make it
`2 * bound / (EDGES - 1)` = `bound / 2.5`.

Shipped edges were `-20 -14.29 -8.57 -2.86 +2.86 +8.57`. Six edges, strictly increasing, and
they passed every assertion in `compute()` — which is why this survived. But the top class
meant "≥ +8.57%" on a scale whose stated design is a p95-derived ±20, and the saturation was
lopsided by 74x:

| | old (`/3.5`) | fixed (`/2.5`) |
|---|---|---|
| edges | -20 · -14.29 · -8.57 · -2.86 · +2.86 · +8.57 | -20 · -12 · -4 · +4 · +12 · +20 |
| class counts | 58 · 102 · 324 · 1971 · 11245 · 10262 · 2298 | 58 · 183 · 1402 · 14951 · 8982 · 653 · 31 |
| clamped low / high | 58 / **2,298** | 58 / **31** |

The verification run confirms the blast radius is exactly one artifact: **eight of the nine
paint hashes are byte-identical** across the fix, and only `zhvi_yoy` moved
(`5fcd2c11` to `f6970376`).

**This changes what the map shows and is not published yet.** `public/data/` still carries the
old scale. It reaches the site on the next data run, or immediately via a `force_rebuild`
dispatch.

### Also in this pass

- `decode_live`'s row-major compatibility branch is deleted — a v3 snapshot has been published,
  which is the condition its own comment named. It refuses a non-v3 payload instead, so the
  gate sees no baseline rather than a scrambled one.
- `forecast.backtest` refitted the whole `[T x Z]` panel inside the horizon loop for a value
  that does not depend on the horizon: four identical full-panel fits per run, now one.
- `forecast.run`'s `index` parameter was never passed and is gone.
- `_build_dicts` took a `zips` argument it never read.

## 2026-09-06, evening — the six "reviewed but not actioned" items, cleared

None of these was a shipped defect. They were the judgement calls left over from the
2026-09-06 read of every Python file, and each is now decided rather than deferred.
Every one was verified against the real 4.93M-row panel in `build/`, not a fixture.

### One dense reshape, not four

`noise._pivot`, `forecast.run`, `zhvi.pooled_yoy` and `history._dense` each turned the long
parquet panel into a dense matrix, and three of them did it by building a Python dict over
every key and walking it with `np.fromiter`. They now all call `panel.dense`, which does the
lookup with `pc.index_in` inside Arrow.

**MEASURED**, `median_sale_price` over 4,930,000 rows: **1.68 s → 0.30 s**, matrices identical
under `array_equal(equal_nan=True)`. Verified identical for `median_sale_price`, `homes_sold`,
the ZHVI pivot (319 × 26,269), `history._dense` in its transposed [Z × T] orientation, and
`pooled_yoy`, which returns the same 6,137,683 cells the diverging bound was derived from.

`panel.dense` raises if the axes do not cover the table. That is the bug the reshape invites:
`pc.index_in` returns null for a key outside the value set, and `astype(int64)` turns null into
an arbitrary index rather than an error, so a filtered axis list would silently scatter values
across the matrix. `history._dense` had carried that hazard unguarded.

Re-indexing per value column rather than hoisting it costs ~0.1 s a column, measured. That buys
one reshape in the codebase instead of two shapes of the same thing.

### `changes._period_map` read the whole panel three times

Each call wanted ~29k of 4,930,000 rows and read every row group to get them. The filter now
goes through the dataset API, so it reaches the row-group statistics — and it prunes well,
because `redfin.ingest` *enforces* that PERIOD END descends, which makes each period sit in one
or two of the 159 row groups.

**MEASURED: 0.40 s → 0.09 s per call**, output byte-identical. Three calls a run.

### ZHVI was parsed twice and then walked with `iterrows`

`write_panel` (S2) and `process` (S3) each called `read_csv` on the same 123 MB. There is now a
`zhvi.read` that parses once and returns the frame plus its date columns; `__main__` calls it in
S2, drops the raw bytes, and hands the frame to S3. `process` is vectorised — the `iterrows`
loop over ~26k rows is gone.

Equivalence was checked against the old row-at-a-time implementation on 4,000 synthetic ZIPs
covering every branch it had: null current value (ZIP dropped), null prev, null year-ago, zero
base on either, and a rounding tie on the level. **0 mismatches.** Two tests were added for the
zero/missing base and the long-format panel, since `write_panel` had none and its signature
changed.

### `calibrate_diff_gate.from_panel` built 4.9M dicts

It materialised one three-key dict per (period, ZIP) cell plus three `to_pylist()` copies —
roughly 3 GB and several minutes. It now uses `panel.dense`, one 47 MB array per metric.
`from_zhvi` had the same defect in the same file (`list(csv.DictReader(f))` over the 123 MB
wide file) and now parses through `zhvi.read`, so the script and the pipeline agree on what a
date column is and how a ZIP is spelled.

**The proof is that the baseline did not move**: re-running the script writes
`tests/baselines/diff_gate.json` byte-for-byte identical to the committed one, in **3.5 s**.

### `forecast.fit` warned on every run

`RuntimeWarning: Mean of empty slice` and `Degrees of freedom <= 0`, from an all-NaN column —
a ZIP with no ZHVI history in the window. `np.errstate` never suppressed them, because it
governs floating-point error states and these are Python warnings numpy raises itself
(confirmed directly: both messages escape an `errstate(invalid="ignore")` block). Now filtered
by message inside `warnings.catch_warnings`, so an unrelated `RuntimeWarning` still reaches the
log. Verified: zero warnings, the all-NaN column still forecasts NaN, real columns unchanged.

### `DIVERGING_BOUND_PCT` is deleted

Exported from `choropleth.generated.ts`, re-exported from `choropleth.ts`, read by nothing. It
duplicated `classify.DIVERGING_BOUND` on the frontend side — a second authority sitting there
waiting to be used, which is what `class-source.ts` exists to prevent. Removed from the
generator and the ramp re-derived; the diff is those three lines and nothing else.

### Measured while here: the forecast tier ladder has two empty rungs

On the shipped ZHVI panel (26,269 ZIPs, 319 months):

| tier | rule | ZIPs |
|---|---|---|
| 0 | < 12 obs, no forecast | **0** |
| 1 | 12-23, metro growth path | **0** |
| 2 | 24-59, short | 1,250 |
| 3 | >= 60, full fit | 25,019 |

The shortest ZHVI history is **31 months**, seven clear of tier 2's floor. So todos.md was
right that tier 1 is dead code, and tier 0 is dead with it. Left in place — deleting a rung is
a decision about what happens when Zillow adds a new ZIP, not a cleanup.

---

## 2026-09-06 — UI/UX pass. Contrast, the sidebar, the map, and one live bug found by arithmetic

Plan and pre-work measurements: `docs/UIUX-PLAN.md`. Developer reference for everything
below: `docs/METHODOLOGY.md`.

### The fade was a lightness channel on a lightness ramp

Reliability drove `fill-opacity` — tier 0 at 0.38, the rest at 0.8. On this release tier 0 is
**24,315 of 33,771 ZIPs (72%) and 78.5% of the drawn land area**, so the ramp was being read
through it almost everywhere.

The ramp runs light to dark, so lightness IS the value channel; compositing over a near-white
basemap also moves lightness. The two are one perceptual channel used twice. Measured by
compositing each ramp colour over Positron's `#FAFAF8` and converting to CIELAB, with the ramp
averaging 14.0 L* per class step — error on the darkest class, in class-step units:

| alpha | 0.38 | 0.62 | 0.75 | 0.85 | 0.92 | 0.95 |
|---|---:|---:|---:|---:|---:|---:|
| class steps | **3.90** | 2.43 | 1.59 | 0.94 | 0.49 | 0.30 |

At the shipped 0.38 an expensive rural ZIP rendered as a colour the eye reads as nearly four
classes cheaper. Holding it under half a step needs every alpha >= 0.92, which leaves
0.92-1.00 of range: too little to read as a signal, exactly enough to be misread as a value.
**No alpha band is both visible as uncertainty and not confusable with value.**

The bias was systematic, not random. Reliability tracks sales volume tracks urban density, and
`classing.median_sale_price.selection_effect` already measured faded ZIPs as genuinely cheaper
(median $275,953 against $394,885). Both errors pointed the same way.

**`FULL_OPACITY = 1`, flat.** Reliability moved to the popup, the detail panel and the legend.
A texture overlay gated to zoom >= 6 is the intended fill-side channel — texture is orthogonal
to lightness — and is **deferred by the user, not cancelled**.

**CORRECTION TO AN EARLIER RECOMMENDATION IN THIS SESSION.** A graded step (0.62 / 0.78 / 0.90
/ 0.97) was proposed first, before the artefact was measured. 0.62 is 2.43 class steps of
error. The proposal was wrong and the measurement is why.

### Break populations: the gate is for sampling error, so it applies only where there is any

Class boundaries were cut over the rankable set (`rel >= 1`) for every metric. Rankability is a
cut on `K / sqrt(n_sales)`, so for a **count** that means choosing the boundaries for "how many
sold here" by looking only at where a lot sold. Counts have no sampling error to gate on.

`classify.COUNT_METRICS` now exempts `homes_sold`, `active_listings`, `pending_sales`,
`new_listings`, `inventory`. Simulated against the shipped snapshot, share in the lowest of
seven classes:

| metric | gated (old) | ungated (new) |
|---|---:|---:|
| homes_sold | 68% | 12% |
| active_listings | 70% | 13% |
| pending_sales | 69% | 11% |
| new_listings | 69% | 10% |
| inventory | 66% | 10% |

`months_of_supply` and `sold_above_list` stay gated: one is inventory over the sales rate, the
other is a share OF the sales. **Code landed, NOT published — needs a data run.**

### Live bug found while computing ZCTA areas: every bounding box was 10,000x too large

`geom.offsets` pre-multiplied by 1e4 and `serialize.COLUMNS` applied its declared 1e4 on top,
so the wire carried degrees x 1e8 under a header saying x 1e4. `ZipTable.boundsOf` honoured the
header and divided once. Every ZIP claimed a box roughly 1,500 degrees wide.

Confirmed by decoding at 1e8 and recovering exactly **8.3966 degrees** as the widest longitude
span — the figure `geom.py`'s own docstring cites for Anchorage 99503 as the reason the column
is int32.

Consequence: a box that size intersects every viewport, so `visibleZipRows` accepted every
loaded ZIP and **auto-scale silently scaled to loaded tiles rather than to the view**. Nothing
caught it because that is what auto-scale looks like when it works. The sidecar exists to fix
the opposite bug — a 0.01-degree box around each centroid — and the correction overshot by
four orders of magnitude.

Fixed in the pipeline (`offsets` returns degrees; the scale belongs to `COLUMNS` alone), with
a check on **both** sides against `MAX_SPAN_DEG = 10`: `geom.assert_bbox_scale` refuses to
build, `ZipTable.checkBounds` logs and makes `boundsOf` answer null so auto-scale degrades to
the national scale rather than to a wrong viewport. The checked-in golden fixture carried the
double-scaled values and was rescaled; the checks caught it there too, independently of the
published data.

**Reaches the site only on a republish.** Until then the client-side check fires — verified in
the browser, naming ZIP 99503 at 83,966 degrees.

### Cluster overlay reframed around the 47 outliers

Measured area share: ns 80.11%, LL 13.10%, HH 5.93%, LH 0.60%, HL 0.26%. Global Moran's I at
k=8 is 0.7343, so HH and LL — 2,552 of the 2,599 significant ZIPs — restate the choropleth
underneath. HH polygons are median 40 km2 against LL's 153 km2, so an overlay painting both laid
down 2.2x as much blue as red; the reported symptom was "only blue clusters, nothing else",
which is what the geometry predicts.

The overlay is now LH and HL only — 47 ZIPs — as circle markers on a client-built GeoJSON
source, choropleth intact underneath, with a plain-English key in the legend that appears when
the overlay is on. Verified in a production build: 47 features, 20 LH + 27 HL, matching the
manifest. `map:sourceReload` still 0.

### Duplicate ZIP labels: label points, not polygons

`zips-labels` read `symbol-placement: "point"` off the POLYGON source. A polygon crossing a
vector-tile boundary is clipped into one piece per tile and gets a symbol on each; multi-part
ZCTAs get one per part. `text-allow-overlap: false` could not help — the copies sit at
genuinely different screen positions, so collision detection had nothing to suppress.

Now a client-built GeoJSON point source, one feature per ZIP, rebuilt on `moveend` above z9.5
from ZIPs whose **anchor** is in view. The anchor is the snapshot's `lat`/`lng`, which
`geom.py` sets from the mapshaper `-points inner` point, guaranteed inside the polygon.
Filtering on the anchor rather than the bbox keeps this independent of the bbox columns.

Verified at z10 over Los Angeles: **117 labels for 117 distinct ZIPs, zero duplicates**,
against 423 polygon instances — 78 of those ZIPs are split across tiles, 90022 into 4 pieces.

No tileset rebuild needed, which matters because the tileset is committed by decision.

### Interaction cost

- `loadedZips()` ran on every `moveend` — a `querySourceFeatures` over every loaded tile,
  38,077 feature instances at z3 — and its result was discarded whenever auto-scale was off,
  which is the default. `onMapMove` now takes a **thunk**, so the cost sits at the call site
  that wants it.
- The hover popup was torn down and rebuilt via `createMetricPopupContent` + `setDOMContent`
  on every animation frame the mouse moved, even inside one ZIP. Now rebuilt only when the ZIP
  under the cursor changes; movement within one is a `setLngLat`.
- Added a hover outline on `zips-border` via a `hovered` feature-state. Not performance — the
  only hover feedback was the popup, so the surface never acknowledged the pointer.

### Benchmarks: one fixed, versioned metric set

Metrics were added to `bench/run.mjs` as they became interesting, which is why phase 0 and
phase 3 share only a handful of comparable fields. Now every key in `METRIC_KEYS` and every id
in `SCENARIO_IDS` is emitted on every run, as `null` where unavailable — a null and a zero are
different claims — `SCHEMA_VERSION` (in `scenarios.mjs`, which has no side effects on import)
bumps on any change, and `compare.mjs` **refuses** to compare across a bump. Verified: it
refuses a schema-1 against a schema-2 file and still compares two schema-1 files.

Added: TTFB, FCP, Long Animation Frames (Chrome 123+, supersedes Long Tasks by covering the
whole frame rather than the script task), Event Timing as the lab stand-in for INP, heap after
interaction as the only leak signal, and `map:sourceReload` as an asserted invariant. Plus 11
scripted interaction scenarios — pan at z4/z7/z10, zoom in and out, a 200-step hover sweep,
click to panel, a full metric cycle, search fly-to, and both legend toggles — each reporting
dropped frames, worst frame, p95 frame and LoAF blocking time.

**Not yet run.** No schema-2 baseline exists, so there is nothing to compare against yet.

### Methodology

The reader-facing page was restructured into eight numbered sections in reader order, each
opening with plain language and carrying its derivations under a "Statistical detail"
disclosure. Nothing was deleted. Tables are numbered and captioned with units. New sections:
**7 Limitations** (not a valuation, ZCTA is not a ZIP, a ZIP is not a neighbourhood, the window
is three months, coverage is not universal, prices are not quality-adjusted) and **8 Notation
and glossary**. Table of contents added.

The register was the problem, not the level: the previous text built every section to a
rhetorical turn, bolded its own verdicts mid-paragraph, used headings that argued rather than
named, and ordered material the way the pipeline runs. Target register is the BLS Handbook of
Methods / Eurostat quality reports / a journal Methods section.

`docs/METHODOLOGY.md` is new and is the **developer** reference: stage-to-manifest-key map,
every constant marked fitted / derived / chosen, the wire-format contract, break-population
rules, the opacity derivation, the invariant table, and which manifest keys the reader-facing
page depends on (removing one removes a section).

### Also

- `html, body { overflow: hidden }` in `index.css` was unconditional, so the methodology page
  rendered its full length inside a body that could not scroll. Now scoped to a body class
  `Index` adds on mount and removes on unmount.
- `TopBar` split into `TopBarShell` + the map's controls, so the methodology page gets a header
  without a metric selector and a ZIP search that drive a map on another route. A Methodology
  button was added to both. The header degrades by breakpoint rather than by the binary
  `isMobile` hook — adding the button pushed the minimum width past a 900 px viewport and the
  wordmark overlapped the search field.
- Legend: three break labels instead of six (six 5-7 character values across 256 px was ~36 px
  each at 10 px type, which is why the old markup carried a negative margin to hide the
  overlap). Per-swatch ranges on hover.
- Sidebar: fifteen `<Card>`s, one number each, became grouped rows — roughly 1,400 px of scroll
  down to about a third. A hero block leads with the metric the map is painting. The history
  chart gained a pointer readout (`Jul 2027 (forecast) - $437,000 - 80% range $391k-$489k`), a
  y-axis, year ticks and an explicit forecast divider; the confidence slider was demoted to a
  select.
- Comparison: green/red good-bad colouring dropped. `isGoodHigher = key !== 'median_dom'` is
  wrong for `months_of_supply` and meaningless for `homes_sold` — which direction is better
  depends on whether the reader is buying or selling, which the panel does not know.

---

## 2026-09-09 — /methodology was unreachable in production

`https://jasperwchen.github.io/Domapus/methodology` showed the map. The address bar read
correctly, the page did not change, and every local mode looked fine. Verified live before
touching anything: the URL served `404.html`, the bounce ran, and the router stayed on `/`.

**Cause.** The restore lived in an `App.tsx` effect and called `window.history.replaceState`.
That call fires no `popstate`, and React Router reads `window.location` once while mounting.
So the address bar was fixed and the router never learned about it. The fix is not a
different effect — it is doing the restore in static HTML, before the bundle is even fetched.
The restore is now the first thing in `<head>` of `index.html`, ahead of GTM (so the pageview
reports the real path) and ahead of the paint-boot script (which reads `location.search`).

**Why no local mode caught it.** `npm run dev` and `vite preview` both serve `index.html` for
any path, so no bounce happens and the scripts never run. `bench/serve.mjs` falls back to
`index.html` too, despite its "matching GitHub Pages" comment — that fallback is about
byte measurement, but it means the harness cannot see a routing break. The chain only ever
executed in production.

**Also changed while in there.**

- `404.html` derives the base from the requested path instead of hardcoding `/Domapus/`, with
  an optional `pr-preview/pr-N` segment, so a preview deep link bounces into that preview
  rather than into production, which serves a different build.
- The path is stored **relative to the base** (`methodology`, not `/Domapus/methodology`) and
  `index.html` re-attaches it to whatever base it was itself served under. An entry left in
  `sessionStorage` by one deployment then resolves against the shell that actually loaded
  instead of naming a route that build cannot match. The restore also refuses any stored
  value starting with `/`.
- The storage key moved from `redirectPath` to `spaPath`, so during a deploy an old shell and
  a new `404.html` (or the reverse) simply miss each other and land on the map, rather than
  half-applying two formats.
- Both scripts guard `sessionStorage`, which throws under some privacy settings. The bounce
  happens either way: the map is a worse answer than the requested page and a better one than
  the 404 body.

**Regression test.** `src/lib/__tests__/base-path.test.ts` extracts the two inline scripts from
the shipped HTML and runs them, so a rewrite of one without the other fails. Verified it goes
red on the original bug (restore removed from `index.html`) and on the absolute-path format,
not just green on the fix. It also asserts the restore stays ahead of GTM and of
`__domapusBoot` in source order.

Everything checked against a server that returns `404.html` with a 404 for unknown paths, the
way Pages does — not against `vite preview`.

**Not changed, worth knowing.** The methodology links in `TopBar` and `Legend` are plain
`<a href>`, so reaching the page costs a full reload plus the 404 round trip; React Router
`<Link>` would make it a client-side transition. Separately, the boot script fetches
`zip-data.json` and a paint table on the methodology page, which needs neither.

### Same session: header navigation and the dash pass

`TopBarShell` takes a `nav` prop. The map shows Methodology; the methodology page
shows Map. The wordmark always linked back, but a `title` on a logo is not an exit a
reader looks for, and the page shipped without one.

Internal links no longer open a new tab. `IconLink` opts into `target="_blank"` with
an `external` flag that only GitHub and Sponsor set. Two routes of one site should not
each cost a window.

That change had a consequence worth naming: the new tab used to preserve the map's
state for free, because the map tab stayed alive. Same-tab navigation would have
returned the reader to the national default view. Both nav links therefore carry
`location.search` across, which is where the map already keeps metric, selected ZIP,
centre and zoom. Verified lossless: leave the map at `?metric=median_sale_price&zip=
90210&lat=34.09&lng=-118.4&zoom=9`, open the methodology page, click Map, and the
metric, the open detail panel and the viewport all come back. The methodology page
ignores the params and sets its own canonical, so the only cost is URL length.

Unchanged on the map header, because they were asked to stay: the "Housing Market
Analysis" subtitle, the "Data through" period block, and the Export button.

**Dashes.** The methodology page had 20 em dashes and 2 en dashes; it now has none.
Sentences were rejoined with a colon, a comma or a full stop depending on what the
clause was doing, and a few were tightened in passing. The register is unchanged: it
is still the BLS Handbook / Eurostat / journal Methods voice the earlier rewrite set,
and nothing was cut for length alone.

Em dashes standing in for a missing value in a table are now `n/a`. That reads
correctly aloud, which an em dash does not.

Four rendered strings elsewhere carried dashes and were fixed: the detail panel's
missing-value placeholder, the forecast band readout (`$391k to $489k` rather than an
en-dash range), the header's period tooltip, and `ZipComparison`'s city and
relative-change placeholders.

**Not done.** Roughly 110 source comments still contain em dashes. They are invisible
to users and rewriting them would be a large diff touching files this work has no
other reason to open. `bench/compare.mjs` and `src/lib/zip-table.ts` each hold one in
a developer-facing string.

### Same session: route-aware boot, and where client-side routing does and does not pay

**The boot script no longer fetches map data on a page with no map.** `index.html`
tests `/\/methodology\/?$/` against `location.pathname` and skips the paint table and
the snapshot when it matches. The route is readable there because the 404-restore
script above it has already run. Testing the tail rather than the whole path keeps it
independent of the base, which differs between production and a PR preview.

Measured against production, gzipped: the methodology page used to pull `zip-data.json`
at 2,694 KB, a paint table at 23 KB and the manifest at 4 KB. It now pulls the manifest
and nothing else. Roughly 2.7 MB that a reader arriving from search or the sitemap paid
for and never used.

Safe because both consumers already treat a missing boot as "fetch it yourself":
`HousingDashboard` does `booted?.manifest ?? await fetchManifest()` and picks
`fetchPaint` when the booted metric does not match, and the worker fetches the snapshot
from its own URL when handed no prefetched buffer. Verified by landing cold on the
methodology page and navigating to the map: manifest and paint were fetched on demand
and the map painted.

**Client-side routing is now asymmetric, on purpose.** Going to the methodology page is
a `<Link>`. Going to the map is a full page load.

Routing *into* the map looked like a win and is not. `index.html` starts the manifest
and paint fetches during head parse, which is the whole reason first paint is fast. A
client-side mount cannot do that, so it falls back to `fetchManifest` then `fetchPaint`,
two round trips in series where the boot script runs both in parallel with the bundle.
Routing into the map trades the 404 bounce for a slower first paint.

React Router cannot express the map's URL either. `useHref` returns the bare basename
for a "/" path, so `<Link to="/">` renders `/Domapus` and drops the trailing slash the
canonical URL and the sitemap both carry. Observed, not assumed: the address bar read
`http://localhost:4321/Domapus` after a routed navigation.

Going the other way has neither problem. The methodology page needs no snapshot, and
`/methodology` is a real path that `useHref` renders correctly, so the `<Link>` skips
the 404 bounce and the whole app reboot for free.

`IconLink` now takes `to` for a routed link, `href` for a full load, and `href` plus
`external` for another site, so a call site cannot set the tab behaviour independently
of the destination. External links carry `aria-label="… (opens in a new tab)"`, since a
window opening unannounced is a WCAG 3.2.5 problem.

The Legend's inline Methodology link is a `<Link>` too. It used to open a new tab to
protect the reader's map state; the query string carries that now.

### 2026-09-09 (same day) — Back out of the methodology page hung the map

Reported: on the map, click Methodology, press Back, and the map sits on its
loading state.

**Cause, and it was mine.** `index.html` prefetches the snapshot into
`window.__zipDataPromise`, and `HousingDashboard` hands that buffer to the worker
in a TRANSFER list, which detaches it. Reading it a second time yields an
ArrayBuffer with `byteLength` 0, and `postMessage` refuses it outright:

    DataCloneError: ArrayBuffer at index 0 is already detached.

There was never a second reader until the methodology page became a client-side
route in this same session. Every route change used to be a fresh document with a
fresh prefetch. Browser Back out of a `<Link>` navigation remounts the dashboard
against the same `window`, so it read the corpse of the buffer it had already given
away. Reproduced before changing anything, and confirmed the buffer's `byteLength`
was 0 while the promise still resolved.

`manifest.ts` now exports `takeSnapshotPrefetch()`, which clears the handle before
awaiting (so two mounts in one tick cannot both take it) and resolves a detached
buffer to null. Either way the caller fetches the URL instead: one round trip
slower, and correct. `boot()` is deliberately NOT one-shot, because
`PaintTable.from` takes a view over the paint buffer rather than consuming it,
which the metric-change path has always relied on. That asymmetry is now asserted
in `src/lib/__tests__/snapshot-prefetch.test.ts` rather than left implicit.

**A second, older bug was wearing the same clothes.** `useDataWorker` cleared
`isLoading` in each terminal branch but never reset `progress`, and MapLibreMap
renders its overlay on `loadingProgress.phase` alone, ungated by `isLoading`. So
the last phase string stayed on screen for the life of the page. This was NOT new:
"Building columns..." was visible after an ordinary cold load too, and it is very
likely part of what "stuck on loading" described. Every terminal state now goes
through one `settle()` that clears both.

`postMessage` throwing synchronously made that worse and is now handled: the throw
happens after `setIsLoading(true)`, so the promise rejected while the overlay
stayed up forever. A hang reads as broken where an error message reads as failed,
and the paint path is independent, so the map itself still works. The timeout path
got the same treatment for the same reason.

Verified on a build served the way Pages serves it: cold load clean, Back clean,
and three consecutive Methodology/Back round trips each keeping the map, the
canvas, the restored 90210 panel and the URL, with no console errors.

---

## 2026-09-11 — maplibre-gl 5 → 6, and the rest of `npm outdated` deliberately left alone

`npm audit` reported a **critical** XSS advisory against `maplibre-gl <= 6.4.0`
(GHSA-jrc7-96c5-q579, a `DOM.sanitize()` bypass) and the only fix is the v6 major. That is the
whole reason for this pass. The hole is not actually reachable here — popups go through
`setDOMContent`, never `setHTML` — so this clears the advisory rather than patching a live
bug, but leaving a critical open to avoid a major is the wrong trade.

**What v6 forced.**

- ESM-only, so the default import is gone: `import * as maplibregl from "maplibre-gl"` in the
  four source files and one test that use the namespace, and `import type * as maplibregl` in
  `choropleth-painter.ts`, `class-source.ts` and `HousingDashboard.tsx`.
- `setWorkerUrl()` is now required under a bundler, because v6 resolves its worker from
  `import.meta.url` and a bundler's module graph does not point at the real file. New
  `src/lib/maplibre-worker.ts` calls it once at module scope; `MapLibreMap.tsx` and
  `PrintStage.tsx` import it for the side effect, next to their existing `addPMTilesProtocol()`
  call. The URL must come in as `?worker&url` and not plain `?url` — `?url` emits the worker
  verbatim without its `maplibre-gl-shared.mjs` sibling, which dies on first import and loads
  no tiles at all. That failure only appears in `npm run build`; dev mode is forgiving of
  either, which is exactly the shape of bug that ships.

**The one behavioural change worth checking.** `zoomLevelsToOverscale` defaults to 4 in v6
instead of 0, so maplibre slices vector tiles where it used to overscale them, and that changes
what both `queryRenderedFeatures` and `querySourceFeatures` return. Those are what hover, click
and `loadedZips()` in `class-source.ts` are built on — `loadedZips()` decides the live class
source in auto-scale mode. Dedup is by a `Set` of feature ids so slicing should be harmless in
theory, and it is in practice: verified on the production build served at the real base path.
Click selection resolves a ZIP and fills the sidebar including the history sparkline, and
toggling *Adjust Contrast to View* then zooming into the Northeast moves the legend breaks from
$157k / $360k / $1.2M to $152k / $240k / $485k with the map recolouring to match, which is
`ViewportClassSource` recomputing quantiles off `querySourceFeatures`. The export preview
renders CONUS and both insets with tiles, which is `PrintStage`'s own Map instance proving it
also got the worker URL. No console errors on any of it.

Ruled out by grep, all zero hits: `styleimagemissing`, `map.transform`, `setRTLTextPlugin`,
`MapDataEvent`, the UMD/CSP bundle, `#pragma mapbox`, `JSON.parse` on feature properties, and
the `GeoJSONSource.setData` second argument. WebGL2 is now required, which is not a constraint
for this site.

**Everything else in `npm outdated` was left alone, on purpose.** After this bump the only
in-range updates left were `autoprefixer` 10.5.5 → 10.5.6, `lucide-react` 1.43.0 → 1.45.0 and
`vite` 8.2.2 → 8.3.0, all taken. What remains is nine packages where `Current == Wanted`, so
every one needs a deliberate migration and none is a security fix: React 19 (with its two
`@types` packages), TypeScript 7, Tailwind 4, ESLint 10 with `@eslint/js` 10 and
`eslint-plugin-react-hooks` 7, vitest 5, and the two testing-library majors. React 19 and
Tailwind 4 in particular are their own projects. They are a product decision, not a
housekeeping one.

Verified after the bumps: `tsc -b` clean, 117/117 vitest, lint at 0 errors and the same 8
pre-existing warnings, `npm run build` clean with the worker emitted as a self-contained
506 KB chunk referenced by hash from the maplibre bundle, and `npm audit` at 0 vulnerabilities.

---

## 2026-09-11 — the colour scale carried 2.5 bits and the legend hid it

**Seven classes was a legend rule applied to a map.** `derive_ramp.mjs` justified it as
"sequential ramps support 5-9 steps before adjacent colours stop being distinguishable",
which is true of a key you read swatch by swatch and irrelevant to a choropleth you read as
a gradient. The cost was measurable: one price class spanned a factor of 1.49, so at the
$400k mark two ZIPs $190k apart painted identically.

**The real ceiling is the ramp's arc length under colour-vision deficiency, and it is
fixed.** About 84 dE76, bounded by how far L* can travel between the palest and darkest
usable fill, because tritanopia collapses the yellow-blue axis this ramp's chroma lives on.
No choice of hues buys more. So the check is no longer "are adjacent swatches separable" —
it measures the SEPARABLE SPAN, how many classes apart two ZIPs must be before every reader
can tell them apart, and rejects any count whose span/classes ratio is worse than the 14.3%
of range seven classes gave:

    classes   span   guaranteed-visible   verdict
       7        1        14.3%            (what shipped)
      13        2        15.4%            rejected
      14        2        14.3%            TAKEN
      15        3        20.0%            rejected

14 is therefore the largest count that costs a colour-blind reader nothing: they still
resolve ~7 bands, while normal vision resolves 14 at 13.79 dE76 adjacent, far above the
~2.3 perceptual floor. 15 was asked for first and measured down. The byte imposes a second,
independent ceiling of 15 — the class field is the low nibble holding `class + 1`, so class
15 encodes as 0x10 and reads back as reliability tier 1 with no class — and `paint.py` now
raises on it rather than trusting the palette script to have caught it.

**`sold_above_list` was one colour over 97% of the drawn area.** `equal_anchored_100` pins
the grid to 100% and lays edges downward at a width taken from the p1..p99 span. That is
right for the sale-to-list ratio, which genuinely pivots at 100%, and wrong for a share of
sales, which approaches 100% from below and never straddles it. The lowest edge landed at
33.6% against a national median of 16.7%, so the grid never reached the data: 65.6% of ZIPs
in the bottom class. Now `equal_interval_0_100`, which reads no sample at all and so cannot
be tuned to the distribution in either direction. Bottom class 33.8%, of which 29.3 points
are ZIPs reporting EXACTLY zero sales above list — that floor is the data, not the classing,
and quantile classing would have spread it artificially to 31.5%.

**An even class count puts a boundary on zero.** 14 classes means 13 diverging edges, an odd
number, so the middle one is exactly 0.0. The 7-class scale had a neutral -4%..+4% band
holding 57% of ZIPs — the map's largest single block was the one that said nothing. Now every
cool colour is a decline and every warm one is a rise. `DIVERGING_COLORS` is resampled per
half so the arms stay symmetric (the RdBu halves are not the same CIELAB arc length) and no
swatch sits on neutral.

**The legend is a seamless 14-band strip, not an interpolated gradient.** At 14 bands it
reads as a ramp, and every pixel in it is a colour some ZIP is actually painted. A smooth
gradient was the easier way to get that look and would have put colours in the key the map
can never produce — invisible at 14 classes in a way it was not at 7. Same fix applied to the
PNG/PDF export, which was building a smooth canvas gradient. Five tick labels on desktop and
three on mobile, both spread across the boundary list and positioned at the boundary each one
names; the mobile strip previously spread three PERCENTILES of the value list evenly down the
bar, describing a scale the map was not painting.

**The goldens have a producer.** `scripts/make_golden.py` recomputes `tests/golden/*.json`
from a real build using the shipped `classify` and `paint`, changing only the class-dependent
parts and leaving the hand-chosen ZIP selection alone. They had been checked in by hand, which
made a class-count change a 48-ZIP-by-9-metric edit. `golden.test.ts` now derives the maximum
legal byte from the ramp length instead of the literal 0x37, and asserts the fixture still
reaches it — a fixture that quietly stops exercising the bound is a test that reads stronger
than it is.

**Measured, 2026-07 release.** Biggest single class, before -> after:

    sold_above_list 65.6% -> 33.8%   zhvi_yoy 57% -> 31.6%   months_of_supply -> 23.2%
    median_dom -> 19.7%   median_ppsf -> 16.0%   zhvi -> 14.1%   median_sale_price -> 13.5%

Neighbour class disagreement (mean |dk| over 8 nearest neighbours / shuffled baseline, where
1.00 is pure noise) is a property of the data and does not move with the class count —
identical at 7 and 15. It splits the metrics in two, and the split matters for what to do
about the speckle on the count and time maps:

    all ZIPs / restricted to ZIPs with enough sales
    median_dom 0.69 -> 0.48    months_of_supply 0.72 -> 0.58    (estimates: sampling noise)
    homes_sold 0.68 -> 0.86    active_listings 0.66 -> 0.79     (exact counts: real)

For the two estimates the roughness is thin-sample noise and the signal underneath is about
as spatially structured as price. For the two counts it goes UP among busy ZIPs, which rules
sampling noise out — there is none, a count is not estimated — so that roughness is real
heterogeneity in ZIP size and density. Neither argues for dropping a metric; what is missing
is a reliability channel on the fill, deferred since the opacity fade was removed.

---

## 2026-09-11 — "Adjust Contrast to View" was dead on click, then dishonest once it worked

Two separate defects behind one user report. Both fixed, both now covered by tests.

**1. The toggle did nothing until the next pan.** `visibleRows` — the viewport sample the
auto-scale authority cuts its breaks from — was only ever computed inside the map's `moveend`
handler, and that handler early-returned whenever auto-scale was off. So flipping the checkbox
set a boolean and nothing else; the class source stayed `PaintTableSource` and the map kept its
colours. On a map nobody had moved yet the feature looked broken, which is exactly how it was
reported. `HousingDashboard` now keeps the last move's `loadedZips` accessor next to the bounds
it already kept, and recomputes the sample the moment the toggle flips on. The old comment in
that effect ("turning it on waits for the next map move to supply one") *described* the bug.

**2. Once it fired, it swapped the classing scheme, not just the sample.**
`ViewportClassSource` cut plain quantiles for every metric. The pipeline classes prices
log-equal between their p1 and p99 anchors, counts by quantile, shares on a 100%-anchored
grid, and YoY on a fixed diverging scale. So on the FULL NATIONAL EXTENT — where the viewport
sample is the same data the pipeline classed — the toggle still repainted the country much
darker. Measured on the 2026-07 release, `zhvi`, share of ZIPs in the two darkest of seven
classes: **6.0% fixed vs 28.6% auto, a 4.8x jump**, top break $1.24M vs $567k. Quantiles put
14.3% in every class by construction; that is what "every map looks equally hot" means and
`classify.py` already rejects it in prose.

A second, quieter mismatch rode along: break population. Boundaries for an estimated statistic
are cut on the rankable set only, so a four-sale ZIP cannot move the scale for everyone else.
Auto-scale sampled every visible ZIP — for `zhvi`, 26,262 voters against the pipeline's 9,452.

`src/lib/classing.ts` now ports the pipeline's four schemes, and `ViewportClassSource` reads
the scheme name and the break gate out of `manifest.classing[metric]` rather than choosing.
The pipeline stays the authority on WHICH scheme a metric gets; the frontend only re-runs it on
a smaller sample. Where no honest cut exists — `diverging` (fixed on purpose), a sample too thin
to cut, or a scheme name this build does not know — the source now defers wholesale to the paint
table, i.e. falls back to the fixed national scale. It used to answer -1 for every ZIP in that
case, which is a blank map.

`break_gate` was already in the manifest and is now in the `Manifest` type.

**The honesty invariant, and where it is asserted.** `src/lib/__tests__/classing.test.ts` cuts
each metric's own break population out of the published snapshot and checks that `fitBreaks`
reproduces the published breaks *exactly*, all six edges, for all 8 recomputable painted
metrics including the wire-scaled ones (`ppsf`, `abv`, `mos`). It reads the real
`public/data/`, so a pipeline scheme change that the frontend does not follow fails here.

Verified live at the real national extent: breaks move $157k / $360k / $1.2M → $157k / $359k /
$1.2M and the map is visually identical. That residual 0.3% on the middle break is real and
correct — the viewport sample excludes ZIPs whose polygons lie outside the visible window
(Alaska, Hawaii, the map edges), so it is a genuinely slightly smaller sample. Zoomed to
SoCal the same toggle gives $205k / $496k / $1.9M, which is the feature doing its actual job:
the scale follows an expensive region instead of flooding the dark end of the ramp.

`tsc -b` clean, 132/132 vitest, lint 0 errors on the touched files.

**One measurement trap, recorded so the next session does not re-chase it.** Auto-scale appeared
not to update on wheel zoom. It does. Back-to-back scripted `scroll` actions keep maplibre's
scroll-zoom gesture open, so `moveend` never fires between them and the breaks look stale.
Arm a `moveend` listener first, then scroll once: the event fires and the breaks recompute.

## 2026-09-12 - the export was a different map, and now it is the same one

Full review of `src/components/dashboard/export/`, then a rebuild. Everything below was
measured against the shipped snapshot or reproduced in the browser, not inferred.

**The export cut its own class boundaries.** `PrintStage` called `computeQuantileBuckets` -
14 plain quantiles over whatever ZIPs the region contained - for every metric. The pipeline
classes prices `log_equal_p1_p99` on the rankable set and publishes the boundaries in
`manifest.classing`. On the national extent, the same ZIPs and the same release, the two
disagree for **73.0% of ZIPs on `zhvi`, 82.6% `median_sale_price`, 89.7% `median_ppsf`, 82.9%
`sold_above_list`, 75.5% `months_of_supply`, 64.4% `median_dom`**; more than half of those by
two classes or more. `homes_sold` and `active_listings` agreed at 0%, because plain quantiles
is what the pipeline uses for them. Fixed by passing `manifest.classing[metric].breaks` down
from the dashboard and calling the shared `classify()`. This was the last second class
authority in the app; the legend and the painter were fixed for the same flaw earlier.

**The same code silently shipped maps with no colour at all.** Ties make d3's quantile
thresholds repeat, MapLibre rejects a `step` whose stop values are not strictly ascending, and
`Style.addLayer` answers a rejected paint value by firing an error EVENT and returning without
adding the layer. No throw, so the `try/catch` never saw it; no `error` listener, so nothing
was logged; `trackError` was never called and the toast still said "Export Complete". The file
came out as ZIP outlines on a blank basemap. **Measured: 1,521 of 6,952 metro x metric
combinations are invalid (670 of 869 metros), and 56 of 424 state x metric (26 of 53 states).**
National is clean for all 8 metrics, which is why it went unnoticed. Reproduced live on
Pittsburgh, PA + Homes Sold; the console said `layers.zips-fill.paint.fill-color[7]:
Input/output pairs for "step" expressions must be arranged with input values in strictly
ascending order.` The fill now uses the live map's own constant `match` on a class in
feature-state, which imposes no ordering on anything, and every export map carries an `error`
listener.

**Preview and file were two layouts.** Both drew the AK/HI insets at 400 px, which is 35% of
the width of the 1200-px preview and 11% of the width of the 3600-px canvas. Every layout
number now lives in one `L` object in STAGE UNITS and the canvas multiplies by `EXPORT_SCALE`;
text is placed as a box that both renderers centre glyphs in. The maps render at a backing size
of exactly `stage units x EXPORT_SCALE` (`pixelRatio: 3` on the main map, a 3x container at
pixelRatio 1 for the insets), so `drawImage` is 1:1 - the main map used to be upscaled 1.51x
from 2272 px into a 3440 px slot.

**The attribution was painted over whenever "Include Title" was off.** It was drawn at a fixed
y=128 baseline and then the map rectangle was drawn from `mapTop`, which is 80 without a title.
The PDF still placed a clickable rectangle over the invisible text. It is now a footer strip
below the map frame that nothing can reach, and `exportToCanvas` returns the link boxes it
actually drew, so the PDF stops re-measuring the text with a throwaway canvas and guessing.
Domapus / Redfin / Zillow are blue and individually clickable in the PDF.

**Framing sampled ZIPs that can never show a colour.** Puerto Rico's 131 ZCTAs and the Virgin
Islands' 6 report nothing for any metric and dragged the mainland frame from 24.59 deg N down
to **17.73** - a fifth of a map of the lower 48 spent on ocean. Bounds are now cut from the
ZIPs that have a value for the metric being drawn, which gives CONUS exactly, and tightens
Alaska from the 46.6 degrees of longitude its ZCTAs span to the 35.1 that have data.

**Alaska could not fit its own inset.** `fitBounds` picks a zoom from the container's CSS size
and clamps it to `minZoom`, which must clear the tileset's floor of 3 or the choropleth has no
tiles. Alaska spans 0.109 of the world's Mercator height; inside the 168 stage units the inset
is displayed at, the fit asks for zoom 1.4 and gets 3, so the state was cropped to whatever the
viewport landed on. The inset now renders into a container 3x its display box, which asks for
3.14. Inset `maxZoom` went 6 -> 7 so Hawaii, which fits at 6.3, fills its box.

**Smaller, all verified:** the legend now labels the boundaries it is drawing (it printed p5 /
p50 / p95 of the values spread evenly across a strip of class bands - the same
second-authority bug `Legend.tsx` was fixed for) and formats them through the shared
`formatLegendValue` (the old substring test printed `median_ppsf` as `285.73` and
`sold_above_list` as `62.5`); `formatLegendValue` and `tickAt` moved to
`src/lib/legend-format.ts` so the key on screen and the key in the file are one
implementation; no-data is `NO_DATA_COLOR` not a fourth hardcoded `#efefef`; fill-opacity
0.9 -> 1, matching the map's decision that reliability is not an opacity channel; the PNG
downloads through `toBlob` instead of an 8.7 MB base64 data URL; Escape closes the dialog; the
metro list is buttons.

**User decisions, 2026-09-12.** The subtitle says "Data through <date>" and not
`formatRedfinWindow`'s "3 months ending Jul 31, 2026" - the rolling-window caveat is honest and
unreadable as a chart subtitle, and it belongs on the methodology page. There is a comment at
`dataDate` saying not to change it back, and a test asserting the string never appears. "Show
Cities" is disabled at national scope, where Positron's place labels stack into noise; toggling
it is now a visibility change rather than a rebuild of three maps. A successful export offers a
GitHub star, once per browser until clicked.

**Tests.** `Export.test.tsx` mocked `addLayer(){}` and `getStyle()` with no layers, so none of
the above was reachable - an export that coloured 73% of the country differently, and 670 of
869 metros not at all, passed the suite. The mock now records layers, feature-state writes and
layout calls, and there are tests for: the classes the manifest's breaks imply, the `match`
expression, a region whose values are all identical still getting a fill layer, missing breaks
holding the export back instead of inventing a scale, `pixelRatio` 3, the footer link boxes,
"Data through", and the city toggle not rebuilding maps. 142 vitest pass, `tsc -b` clean.

**Left alone deliberately:** `computeQuantileBuckets` in `src/lib/quantiles.ts` now has no
production caller (only tests and a re-export in `map/utils.ts`). Not deleted - it is
pre-existing code these changes orphaned rather than their own mess, and the call is the
user's.


---

## 2026-09-12: mobile layout and UX pass

Separate from the B1-B9 UI/UX pass, and touching none of the same code. Audited live
against the dev server at 375x812, 820x900 and 1440x900, measuring element geometry in
the page rather than eyeballing screenshots. Desktop and tablet came back clean: the
header degrades to icon-only below 1280, nothing overflows at any width tested, and the
legend never collides with the 360 px sidebar. Everything below was a mobile or
cross-cutting defect. `tsc -b`, 142 vitest and eslint green; each fix verified in the
browser.

**The continental US did not fit a phone viewport, and that was the main one.** The map
hard-coded `minZoom: 3`, so the opening `fitBounds` was clamped: fitting 57.83 deg of
longitude into 375 px needs z2.19, and the map opened at z3 with both coasts off-screen.
A housing map of the country that cannot show the country on load. `minZoom` is now
`zoomFloorFor(container.clientWidth)`, which is the zoom at which the lower 48 fills 92%
of the container width, clamped to [2, 3].

The z3 floor exists because the z2 cut of the tileset is 75 ZCTAs short of 33,780
(`geometry.lock.json`, `strict_from: 3`), so relaxing it is a real decision and it is
deliberately bounded: **every viewport at or above 715 px keeps the full-coverage floor
untouched**, measured across 320 to 1920 px. Only phones and narrow portrait tablets
reach below it, they reach at most z2, and at z2 one pixel is about 39 km, so the 75 it
loses are sub-pixel however they are tiled. If that trade is ever unwanted, raise
`FIT_WIDTH_FRACTION` or pin `TILESET_MIN_ZOOM` to 3 and the old behaviour returns.

`DEFAULT_BOUNDS` was hoisted to a module constant in the same change. It had been written
out twice already, at init and in the reset button, and the zoom floor needs its width.

**Fit padding took a quarter of a phone screen.** `min(minDim * 0.12, 100)` is 45 px a
side at 375 px wide, because on a phone the short side IS the width. Capped at 6% of
width below 700 px. Verified numerically that desktop and tablet padding is unchanged:
at 768 it was 92.2 px before and after, and 100 px at 1024 and above, so the default
framing the benchmarks pin did not move.

**The basemap attribution was completely covered on mobile.** The metric and ZIP-search
bar is `fixed` at `z-[1001]` over the bottom of the map, and `elementFromPoint` inside
the attribution box returned the bar, not the attribution. "© CARTO, © OpenStreetMap
contributors" is a condition of using those tiles. The bottom-left controls now clear the
bar below 767 px. 767 and not 768: it has to track `useIsMobile`, which renders that bar
at `innerWidth < 768`, so at 768 itself there is no bar to clear. The pre-existing
`max-width: 768px` block next to it has the off-by-one; that was left alone.

**Searching a ZIP showed no numbers.** `handleSearch` set the fly-to target and the URL,
and the panel only ever auto-opened from the once-guarded initial-URL effect, so a search
flew the map there, highlighted the polygon, and stopped. The reader then had to find the
ZIP they had just typed and click it. Search now routes through `handleZipSelect`, so
however a ZIP is picked it does the same thing, compare-mode rule included. A miss used
to be silent, which reads as a broken search box rather than as an answer; it now raises
a toast, and distinguishes "no such reporting ZIP" from "details still loading". The
`<Toaster />` in `App.tsx` had been mounted since the beginning with nothing in the app
ever calling it.

**The metric selector truncated to "Zillow Hom..." inside a 343 px bar**, because
`SelectTrigger` was a fixed `w-36` at every width. Full width below `md`, unchanged in
the desktop header where the row also has to hold the search field and five buttons.

**The cold-load spinner was unlabelled.** The caption only rendered once
`loadingProgress.phase` existed, so the wait on the map style, the first and longest one
on a cold load, was a bare spinner on white. Now always captioned, defaulting to
"Loading map...". Note `||` and not `??`: the worker reports an **empty phase string**
before it has a stage to name, and `??` passed that through as a blank caption. That was
caught only because the rendered span was inspected rather than assumed.

**Prices rendered with a ragged number of decimals.** The `price` format was
`value.toLocaleString()`, which keeps up to three fraction digits, so the per-square-foot
metrics printed `$1,744.3` directly above `$1,786.29` in the same column. Whole dollars
now. Sparkline axis labels are formatted separately and still carry their `$3.63M`
precision, which is correct for an axis.

### Noted, not changed

- `npm run dev` serves at `http://localhost:3677/` and not `/Domapus/`. `vite.config.ts`
  sets `base: "/Domapus/"` for production only, so in dev `BASE_URL` is `/` and the
  router's basename follows it. The Commands section of `CLAUDE.md` says `/Domapus/`,
  which sends you to the 404 route. Left for whoever owns that file to correct.
- `SponsorBanner` is mounted in `HousingDashboard` but `showSponsorBanner` is never set
  true, so it is unreachable. Pre-existing dead code.
- `handleResetBounds` has an eslint `exhaustive-deps` warning for `getDynamicPadding`.
  Pre-existing: HEAD already called it from a callback with an empty dep array.
- The fit padding has a discontinuity at exactly 700 px width (42 px to 84 px) where the
  narrow cap switches off. It only shows on a reset-view click at that width; smoothing
  it costs more code than the case is worth.

---

## 2026-09-12: a labelled way back from methodology, and borders that fade out

### Back to map

The methodology page's only exit was `TopBarShell nav="map"`, which renders a map
glyph whose "Map" label appears at `xl` and above. Below that it is an unlabelled
icon sitting between GitHub and Sponsor, and a reader who has scrolled into a
4,677 px document is not going to find it.

Two explicit `Back to map` links now, arrow and text, one above the `<h1>` and one
after the release-generated footnote. The top one is rendered by the page component
rather than inside `Body`, deliberately: when the manifest fetch fails this page is
one line of error text, and that is precisely when the reader most needs the exit.

Both are plain `<a href>` and not `<Link>`, for the reason `TopBar` already sets
out: `index.html` starts the manifest and paint fetches during head parse and a
client-side mount cannot, so routing into the map would trade this page's exit for
a slower first paint on arrival. Both carry `location.search`, so metric, ZIP,
centre and zoom come back with the reader. Verified: the round trip from
`/methodology?metric=zhvi&zip=90210` lands on the map with the 90210 panel open.

### ZIP borders hold their ink below the default view

The border layer draws every ZCTA's own ring, so both sides of each shared edge
get painted. `geometry.lock.json` measures 5,624,668 segments at 292.9 m median
spacing: about 1.6 million km of line over the lower 48's 8.08 million km2, or
**0.198 km of ink per km2 of country**. At 39 N a CSS pixel spans 60.8 / 2^zoom km,
so the share of the country's screen area covered by border ink is

    ink = 0.198 x line-width(zoom) px x km-per-pixel(zoom)

The default view opens near z4. Below it the ink roughly doubles per zoom step,
because the same border network is packed into a quarter of the pixels, and the
choropleth greys over. Darkening is `1 - 0.85^ink` for the 0.15-alpha stroke:

| zoom | km/px | width px | ink/px | darkening before | after | metro (5x) before | after |
|---|---|---|---|---|---|---|---|
| 2 | 15.21 | 0.30 | 0.903 | 13.7% | 4.5% | 52.0% | 20.7% |
| 3 | 7.60 | 0.30 | 0.452 | 7.1% | 4.6% | 30.7% | 21.2% |
| 4 | 3.80 | 0.40 | 0.301 | 4.8% | 4.8% | 21.7% | 21.7% |
| 5 | 1.90 | 0.50 | 0.188 | 3.0% | 3.0% | 14.2% | 14.2% |
| 6 | 0.95 | 0.60 | 0.113 | 1.8% | 1.8% | 8.8% | 8.8% |
| 10 | 0.06 | 1.50 | 0.018 | 0.3% | 0.3% | 1.4% | 1.4% |

**z4 is the reference and nothing at or above it changes.** The fade only holds
the product at the z4 level:

    opacity(z) = ink(z4) / ink(z), capped at 1

which is 1 at z4 and up, 0.67 at z3, 0.33 at z2, linearly interpolated and
clamped past both ends. Darkening then sits flat near 4.6% nationally and 21% in
a dense metro from z2 all the way to z4, instead of climbing to 13.7% and 52%.
A hovered or searched ZIP keeps a full-strength outline at every zoom, so the
interactive branch of each stop is a flat 1.

The z2 row is **new exposure**: the mobile zoom floor landed earlier the same day,
so phones now open near z2.07 where the unfaded ink was worst.

**A first attempt was rejected, and the reason is the useful part.** It ramped
0 -> 1 across z3 to z7 on the argument that a border means nothing until a ZIP is
several pixels across, which drove national darkening under 1.3% everywhere. That
is a different and more aggressive claim than the problem called for: it changed
the default view and every zoom up to z7, gutting borders at zooms nobody had
complained about. Holding the ink at the level of a view that already looks right
is the smaller and better-founded rule, and it needs two stops instead of five.

The stops are written out literally on the layer rather than generated from a
constant: MapLibre's expression types only narrow on a literal, and `["zoom"]` is
rejected anywhere but the input of a top-level `interpolate` or `step`, so the
zoom interpolation has to be the outer expression with a `case` at every stop.
That is the same shape `line-width` beside it already has.

Verified in the browser: the live layer's `line-opacity` reads back as
(2, 0.33), (3, 0.67), (4, 1) with the interactive branch at 1; the national
default view is indistinguishable from before; z8 over the New York metro still
outlines every ZCTA.

**If that layer's `line-width` ever changes, recompute the table.** Ink is linear
in it.

### 2026-09-12, later - the furniture stops standing on the data

Follow-up to the entry above, all measured with `fit` modelled exactly (bbox into the
padded rect, centred) and every ZIP centroid projected into stage units.

**The key was drawn on top of 148 to 164 Florida ZCTAs.** It floated inside the map, bottom
right, on a 324 x 94 white panel. On the national view that corner is the Atlantic east of
Florida, but the panel reached inland; at state and metro scope there is no ocean at all and
it simply covered whatever was under it. It now lives in a band below the map frame, laid out
across one row: metric name, colour bar with its boundary labels underneath, no-data swatch,
and the attribution right-aligned on the same row. Costs 42 units of map height. Covers
nothing, at any scope, by construction.

**The Hawaii inset was drawn on top of 3 to 8 Texas ZCTAs** around Big Bend, depending on the
metric. The insets were placed at a fixed margin from the frame with no idea where the data
was. The lower 48 are wider than the frame they are drawn in, so the fit is width-bound and
the leftover height is empty: `mainPadding` now spends that leftover as BOTTOM padding, which
pushes the states up off the insets and costs nothing, because the width still binds and the
map is drawn at exactly the same size. Measured after: **0 ZCTAs covered, all eight painted
metrics.** Where there is no slack, or no inset, the padding stays symmetric at 24.

**The insets now say what scale they are at** - "ALASKA · 0.23× scale", "HAWAII · 2.2× scale",
read from `map.getZoom()` against the main map's, corrected for the 3x render container. The
two boxes are the same size on the page but hold states an order of magnitude apart, and
nothing on the old export said so.

**Title and legend stay optional, and toggling either now re-fits the map.** They change the
SHAPE of the map frame; MapLibre resizes its own canvas but keeps the zoom it was fitted at,
so the view stayed framed for the old rectangle - and after this change the bottom padding
would have been computed for a height that no longer applied.

**The metro search takes the keyboard.** Enter picks the highlighted suggestion, which starts
at the top match, and the arrow keys move it with wraparound; `aria-activedescendant` and
`role="combobox"` so a screen reader follows. The state picker is a Radix `Select`, which
already had arrow keys, Enter and type-to-jump.

**Preview and file still agree by construction.** The metric name's width decides where the
colour bar starts, so it is measured ONCE in stage units and handed to both renderers rather
than measured independently in each.

---

## 2026-09-12 evening — todos reconciled against the artifacts, not against the file

Five open items in `docs/todos.md` were already finished. Each was checked against the thing
it described rather than taken on the file's word, and then deleted.

**The history buckets are on the release.** `history-2026-07-31.tar.gz`, 37,164,615 B, uploaded
to `data-2026-07` on 2026-09-06. Today's Deploy log ends that step with `Unpacked 6086 history
files from data-2026-07/history-2026-07-31.tar.gz`, so the gitignored-buckets path is proven end
to end and a standalone deploy no longer ships a dead sidebar chart.

**The deploy has run against the new wire format, repeatedly.** The 50-column column-major
snapshot, `assets.paint`, and all nine `paint/*.u8` ship on every Deploy.

**The diverging fix and B7 are both published and live.** `public/data/manifest.json` carries
14 classes and the symmetric scale `[-20 … +20]` at even 3.3333 steps, and `break_gate` reads
`all_reporting` for `homes_sold` (population 25,603) and `active_listings` (28,493).
`gh-pages` and the CDN both serve it; the Pages build sat queued for about fourteen minutes
after the Deploy job succeeded, which is what made the site look stale at 7 classes for a while.

**A schema-2 bench baseline already existed.** `bench/results/uiux.json` is `schemaVersion: 2`
and valid. The todo asking for one sat two bullets below the entry that recorded it.

**`verify-choropleth.mjs` passed against the deployed site**, which was the last item under
"verification still owed":

    BENCH_URL='https://jasperwchen.github.io/Domapus/?lat=39.5&lng=-98.35&zoom=4&metric=zhvi' \
      node bench/verify-choropleth.mjs --cpu 4

`tileRequestsCausedBySwitch: 0`, `sourceReloadCounter` 0 before and 0 after, `switchMs` 594 at
4x CPU throttle, exit 0. The `map:applyChoropleth` marks read 2063 ms on first paint then 28
and 33 ms for the switch, so the painter is demonstrably doing work rather than being skipped.

### Two things the file said that were not true

**The `sha256sum -c` paint verification is in `update_data.yml`, not `deploy.yml`.** Deploy has
no such step and trusts whatever the data run committed. The practical consequence is that a
hand-committed `public/data/paint` bypasses the check entirely.

**The bbox decode fix is published and can be verified from the wire.** Max `be - bw` in the
shipped `public/data/zip-data.json` is 83,966 raw, which at the declared 1e4 scale is 8.3966
degrees — exactly the figure `geom.py` cites for Anchorage 99503. `ZipTable.checkBounds` has
nothing left to log and auto-scale runs on real bounds.

### `featureStateWrites` now reports its skip count

`bench/run.mjs` reads `detail.skipped` off the same `map:applyChoropleth` measure it already
read `detail.writes` from, and prints `N written / M skipped`. Zero writes beside a large skip
count means the painter ran and found every ZIP already at its packed `(k, rel)`; zero beside
zero means it never ran. Those two printed identically before.

The old note also had the source wrong. The read happens after the whole scenario suite, and
`toggle.outliers` runs after `metric.cycle`, so the last measure comes from the legend toggle
rather than from the metric switch. One bench run will now say which case the observed 0 was.

### The B7 publish raised one thing nobody predicted

`homes_sold` and `active_listings` both draw **zero ZIPs in class 0**. `_quantile_breaks` takes
the (i+1)/14 percentile for thirteen edges; over 25,603 reporting ZIPs more than 7.14% sold
exactly one home, so the first edge lands on 1.0. A ZIP is class 0 only when its value is
strictly below the first edge, and no reporting ZIP has `homes_sold < 1`. Every one-sale ZIP
paints class 1 and the first swatch goes unused.

The break is right — `_quantile_breaks` is already commented *"Ties collapse classes; that is
real."* The legend is what is wrong, and it can be fixed without a data run because
`class_counts` is already in the manifest and already typed in `src/lib/manifest.ts`.

Bottom-class shares as shipped, superseding the pre-B7 figures: sold_above_list 33.8%,
active_listings 0.0%, homes_sold 0.0%, median_sale_price 10.6%, median_ppsf 12.7%, median_dom
9.1%, months_of_supply 7.1%, zhvi 7.3%, zhvi_yoy 0.2%.

### Forecast tier 1 is worse than dead code

The earlier note called it unreachable. It is also unimplemented. `pipeline/forecast.py`
documents tier 1 as *"the METRO's growth path on the ZIP's last level"*, but `_tier()` only
assigns the integer and the fill loop special-cases tier 0 alone. There is no metro-growth
branch in the file. A ZIP with 12-23 observations would receive the ordinary shrunk AR(1)
output stamped `f_tier: 1` — a weaker label on an identical forecast. Nothing in the frontend
reads `f_tier` either; it is declared in `map/types.ts` and used in no component.

That changes the decision from "delete dead code" to "the ladder documents four rungs and
implements two, and the day Zillow adds a short-history ZIP it starts lying."

### `computeQuantileBuckets` has no successor role either

The todo kept it on the theory that an auto-scale path would reach for it. Auto-scale already
exists and does not: `ViewportClassSource` calls `fitBreaks` in `src/lib/classing.ts`, which
reads the scheme and the break gate out of the manifest. Cutting plain quantiles for every
metric is the exact bug `class-source.ts` documents in its own header — it moved 28.6% of ZIPs
into the two darkest classes against the fixed scale's 6.0%. `d3-scale` is imported by nothing
else in `src/`, so deleting the function drops the dependency with it.

### And the export filename was never the problem

`ExportSidebar.tsx` builds the stem as `Domapus-{metric}-{region}`, so metric and region
survive on disk with the title off. What is missing from both the filename and an untitled
image is the **data period**. A PNG pasted into a deck six months later cannot be dated.

---

## 2026-09-12, later — the five open decisions, answered and implemented

All five were answered in one pass and all five landed the same session. `npx tsc -b` clean,
144 vitest, 54 pytest, verified in the browser on the dev server.

### `computeQuantileBuckets` is gone, and `d3-scale` with it

Deleted from `src/lib/quantiles.ts`, its re-export dropped from `map/utils.ts`, its four tests
removed, and `d3-scale` + `@types/d3-scale` uninstalled — nothing else in `src/` imported them.

The function cut plain equal-count quantiles for every metric. That is the bug
`class-source.ts` documents in its own header: on the full national extent, classing the same
ZIPs the pipeline classed, it put 28.6% of them in the two darkest classes against the fixed
scale's 6.0%. Auto-scale has used `fitBreaks` for a while, which reads the scheme and break
gate out of the manifest, so the only thing keeping the old helper alive was a note in the
todos guessing an auto-scale path might want it one day. It already existed and did not.

`quantiles.ts` now carries a header saying what it is NOT for, because the next person
reaching for a quantile helper to answer "which class is this ZIP in" should be sent to
`fitBreaks` instead.

`choropleth-painter.test.ts` grew a local `quantileCuts`. That test is about the byte layout
and needs any monotone boundary list; several of its fixtures are deliberately smaller than
CLASSES, which `fitBreaks` refuses, so a production helper is the wrong dependency for it.

### Forecast tiers 0 and 1 are now one rung

`TIER_METRO` deleted, `_tier` no longer assigns 1, and `tier_counts` reports `(0, 2, 3)` — a
key that is structurally always zero reads as a measurement rather than an absence.

The earlier note called tier 1 unreachable. It was also unimplemented: the ladder documented
it as "the METRO's growth path on the ZIP's last level" and no such branch was ever written,
so a ZIP with 12-23 observations would have been handed the ordinary shrunk AR(1) output
stamped `f_tier: 1` — an identical forecast wearing a weaker label. It never fired because the
shortest ZHVI history in the shipped panel is 31 months, so nothing was ever published under
it. Under 24 observations now gets no forecast, which is the only reading that cannot ship a
wrong number.

The comment in `forecast.py` keeps the whole story, including that implementing the metro path
is still open if the band ever stops being empty, and that reinstating a label without the
branch behind it is not.

### Empty classes are notched in the legend

`homes_sold` and `active_listings` draw zero ZIPs in class 0, because the first of thirteen
quantile edges lands on 1.0 and nothing reports under one sale. The break is right — ties
collapsing classes is a real property of the distribution. The legend showing a swatch for a
colour with no owner was not.

An unused class now keeps its slot and its colour but shrinks to a 4 px sliver inside the
16 px band, with the title "… — no ZIP codes" and a caption under the key. Two things about
that choice:

**Width is untouched on purpose.** The tick labels are positioned from `(i + 1) / CLASSES`, so
dropping a band outright would silently move every label off the boundary it names.

**Height, not lightness.** A faded swatch on a lightness ramp is the same channel the value is
encoded in — the reason the reliability fade came off the map in the first place.

`classCounts` is withheld whenever the counts do not describe the breaks on screen. In
auto-scale the live source re-cuts to the viewport, so the published counts belong to a
different set of boundaries; marking nothing there is the safe miss, marking the national
empties would be a lie.

Verified in the browser: `homes_sold` national shows 14 bands all 15.9 px wide, the first 4 px
tall titled "below 1 — no ZIP codes", caption present. `median_sale_price` shows 14 full bands
and no caption. `homes_sold` with auto-scale on shows 14 full bands and no caption.

### Export identity, both halves

**The filename carries the period.** `Domapus-median_ppsf-United-States-2026-07-31.png`,
confirmed by intercepting the download. The period comes back from `exportToCanvas` rather
than being fetched again in the sidebar, so the name and the drawn subtitle read one value.
It also stops two exports of the same region a quarter apart from colliding in the downloads
folder.

**The image carries it too, when nothing else does.** `FOOTER_SEGMENTS` became
`footerSegments(dataDate, includeTitle)`, which prepends "Data through …" only when the title
is off. With the title on the subtitle already says it and printing it twice is worse. The row
is right-aligned from `mapRight`; measured clearance to the key at the worst case
(`median_ppsf`, longest painted label with a day-format date) is 112 px at preview scale,
about 260 stage units.

The earlier note framed this as "an untitled export cannot be identified later", which was
wrong about the file — the stem already had metric and region. What it was right about is the
picture: a PNG pasted into a deck is not a file any more.

### Kaggle is closed, not deferred

The terms were read. Redfin's Terms of Use grant "a limited, personal, non-exclusive,
non-transferable, non-sublicensable, revocable license to access, view, and use the Services"
(2.3.2), prohibit "derivative works based upon, or attempt to commercially gain from your use"
(2.3.3), and say the Terms "do not provide you a license to use, reproduce, distribute,
display or provide access to any portion of the Services on Third Party Sites" (2.3.4).

The distinction that settles it: Redfin welcomes *citing* the data and asks only for a
citation and a link on first reference, which is what Domapus does today and is squarely
permitted. A Kaggle upload is the other act — redistributing the data on a third-party site,
which 2.3.4 names directly.

The benefit was never large enough to chase written permission. The case was discovery, which
is a marketing channel; a download link on Domapus itself buys most of it, since the artifacts
are already public static files. And to interest a Kaggle audience the upload would need the
full 173-period panel rather than one month — the maximal version of exactly what the terms
refuse.

### Export memory, measured

The `pixelRatio: 3` note said "~30 MB, not measured on a low-end device". The first half is
now measured and correct; the second half is unchanged and cannot be settled from a desktop.

Chrome, national view, `median_ppsf`, title and legend on: JS heap 54.8 MB before the dialog
and 196.0 MB with it open, a rise of 141.2 MB. The main export map's GL canvas is
3402 x 2148 = 7.31 Mpx = 29.2 MB at 4 B/px; two insets at 648 x 504 add 2.6 MB; the live map
behind the dialog is 4.3 MB. Total canvas backing while open is 34.7 MB, of which roughly 30.4
belongs to the dialog. During the export call itself a further 3600 x 2700 = 38.9 MB canvas
exists transiently.

Peak is therefore about 196 MB of heap plus ~74 MB of canvas. What a phone does under that is
still unknown — memory pressure is not something the harness can emulate, so this needs a real
low-end device or a decision to drop `EXPORT_SCALE` to 2 (~13 MB instead of 29, at a 1.51x
upscale).

---

## 2026-09-16: Holistic review, dead work, dead code, script injection, comment trim

**Safety.** `update_data.yml` interpolated `override_reason` into a `run:` script with
`${{ toJSON(...) }}`; JSON escaping does not neutralise `$(...)`, so a reason could execute.
Same pattern for `release_tag` in `geometry.yml` and `ref` in `deploy.yml`. All three now pass
through `env:`. Write-access gated, but the fix is free. `index.html` also resolved
`?metric=__proto__` against the paint map's prototype; now own keys only. No `innerHTML` or
`dangerouslySetInnerHTML` anywhere; the popup builds text nodes.

**Contradiction fixed.** `index.html` carried two comments about the manifest preload: one said
`crossorigin` is required (measured 27,780 -> 55,560 bytes without it), a later one said remove
it. Code matched the first; the second is gone.

**Frontend dead work.** `HousingDashboard.legendValues` built a 33,771-number array on every metric
change and auto-scale pan, and `Legend` sorted it for p5/p50/p95 that only rendered when `breaks`
was missing, which cannot happen for the 8 painted metrics. Removed with `quantiles.ts`.
`ZipTable.checkBounds`/`boundsOf` and `MapLibreMap.labelBuild` now read Int32 columns directly
instead of two Map lookups per cell.

**Vacuous tripwire.** `setPaintPropertyCounted` was never called, so `map:sourceReload` could not
move and the bench's "must be 0" always passed. Replaced by `countZipPaintRewrites`, which wraps
`map.setPaintProperty`. Verified live: a `zips-labels` rewrite moved it 0 -> 1, a basemap rewrite
did not.

**Dead code removed.** `quantiles.ts`, `metric-value.ts` (null-to-zero helper PrintStage avoids),
`getComparison`, `SERIES_BREAK_2026_06`, `OUTLIER_CLASS`, `WorkerResponse`, eight unused `ui/`
primitives (badge, card, dialog, separator, sheet, skeleton, toggle, sonner), and the mounted but
unused `QueryClientProvider` and Sonner `Toaster`. `contracts.assert_descending`,
`classify.DIVERGING_RECOMPUTED`. Package deps left in place (owner manages package.json):
`@tanstack/react-query`, `sonner`, `@radix-ui/react-dialog`, `-separator`, `-toggle`, and
`next-themes` if only sonner used it.

**Pipeline.** `encode_columns` ran twice per release (diff + write), now once. `decode_live`
decoded 50 columns into 1.69M objects for a gate reading five; now takes `keys`. The round-trip
probe built full 33k lists before slicing `[:20]`. `redfin.ingest` materialised ~10M Python
strings to regex-check ZIPs and loop-check period order; now Arrow compute (two new tests cover
both guards). `classify.compute`/`assign` walked every record three times per metric with a
Python `class_of`; now `np.searchsorted`. `spatial` built the same KD-tree six times; one query at
k=33 now serves every k and the 8th-neighbour distance. `_log_selection_effect` used
`r.get("rel", 0) >= 1`, which raises on a present `None`. S3's receipt was written after S8 as a
second 20 KB copy of the manifest and nothing required it; it is now written after S3 and required
by S4.

**Verified against the published release** (decoded `public/data/zip-data.json`): paint table
sha256 identical for all 9 metrics, `class_counts` identical, `encode_columns` reproduces `d`/`z`
exactly, spatial Moran's I at k 4/8/16/32, BH count, raw p<0.05 count and median 8th-neighbour km
all identical. Live preview: 33,771 feature-state writes, 14 legend bands, 0 source reloads, no
console errors.

**Comments.** ~2,000 lines of prose removed, mostly bug history duplicated here. Measurements and
non-obvious constraints kept. Code verified unchanged: pipeline by AST with docstrings stripped,
TypeScript by printer output with comments removed.

**Not done.** `history.write` holds every series in memory before writing; LISA's 999-permutation
loop is not chunked; `write_snapshot` still re-parses the 11 MB file it wrote. All correct, just
slower than necessary. `use-toast.ts` `actionTypes` lint warning left (generated shadcn file).

**Follow-up, same day: helpers, deps, and the deferred items.**

- `panel.axis` (sorted distinct values of a column) and `panel.zhvi_matrix` (months, zips,
  dense ZHVI) replace the same three or four lines in `forecast`, `zhvi`, `history`, `noise`
  and `changes`. `noise.rankable(rec)` is now the one definition of the `rel >= 1` gate used by
  `classify` and `spatial`.
- `history.write` streams one bucket at a time. Sorted ZIPs arrive grouped by prefix, so no
  more than one bucket is held. Peak traced memory 711 MB -> 279 MB; output files identical.
- `write_snapshot` no longer re-parses the 11 MB file. It dumps with `allow_nan=False`, which
  refuses the only value JSON would not round-trip, and runs the value round-trip check on the
  in-memory payload.
- LISA permutation chunking dropped: the whole spatial stage takes 0.6 s.
- `ZipTable.anchors()` descales lng/lat once into Float64Arrays (NaN where absent). The label
  builder, the outlier layer and `boundsOf` read it; `col()` had no other caller and is gone.
- Removed deps: `@tanstack/react-query`, `sonner`, `next-themes`, `@radix-ui/react-dialog`,
  `-separator`, `-toggle`, `@testing-library/user-event`, `@vitejs/plugin-react-swc` and the
  explicit `postcss` (tailwindcss and vite both depend on it). `autoprefixer` stays: it is
  wired in `postcss.config.js`.
- Unused `actionTypes` in `use-toast.ts`, `lo_n` in `forecast`, `IDENTIFIERS` import in `redfin`.

Verified: history bucket digest, LISA classes, snapshot bytes, pooled YoY sample and all
receipts identical to the pre-change pipeline on `build/`. Live: outlier dots, ZIP labels and
the viewport re-cut all render, no console errors.

---

## 2026-09-16: reference moved out of todos.md

`docs/todos.md` now holds open items only. The standing conventions, landed-phase tables and measured facts it carried are kept here verbatim.

### Conventions

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

### Phases 0-5 — LANDED. Rationale and measurements in CHANGES.md.

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

### Phases 6 and 7 — LANDED 2026-09-06. Rationale and measurements in CHANGES.md.

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

### Phase 6 — closed

- **DECIDED 2026-09-06 (user): the tileset stays committed in git.** `public/data/us_zip_codes.pmtiles`
  is the 46.9 MB archive, tracked, and `deploy.yml` needs no download step. The cost accepted
  is that each geometry rebuild adds a permanent ~47 MB blob to history; geometry is a roughly
  annual job, so that is a slow clock. **Do not re-open this as a "cleanup" without asking.**
  §5.9's release path is not dead — `geometry.yml` still cuts a `geometry-vN` release when
  handed a tag, which is the escape hatch if repo size ever does become the problem.

---

### Decided 2026-09-12 and implemented. Rationale in CHANGES.md.

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

### Kaggle — CLOSED 2026-09-12. Do not re-open without new terms from Redfin.

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

### Standing rule, not an open item

**±20% diverging bound is derived, never chosen.** `classify.derive_diverging_bound()`
recomputes it from the pooled ZHVI panel every run (p95 |yoy| = 18.85% over 6,137,683 lag-12
cells, share clamped 4.07%). It has rounded to 20 on every start window tested. If a release
ever produces a different bound, that is a regime change worth seeing, not a number to
override.

---

### Benchmark protocol

- [ ] Per phase, per spec §8.7: `node bench/run.mjs` on the built `dist/` at the pinned view,
      **before and after**, result into `bench/results/` and a line here.
- [ ] **Final full benchmark after the last phase lands**, same pinned conditions as the
      2026-08-29 baseline (slow4g / 4x CPU / 1440x900 / 5 runs / pinned view).

---

### Facts established — do not re-derive

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

### Change detection and the publish gate — LANDED 2026-09-06. Rationale in CHANGES.md.

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

### Export - LANDED 2026-09-12. Measurements and rationale in CHANGES.md.

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

### UI/UX pass — LANDED 2026-09-12. B1-B9 all shipped; rationale in CHANGES.md.

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

### Open question: the count and time metrics are unmarked noise

`median_dom`, `months_of_supply`, `homes_sold` and `active_listings` read as camouflage
because at ZIP level they largely are noise — two thirds of the way to random, measured
above. The scale is honest; what is missing is that a 3-sale ZIP's median DOM paints at
full strength beside a 300-sale ZIP's. The rankable gate keeps thin ZIPs from SETTING the
breaks but still paints them, and the fill has carried no reliability channel since the
opacity fade was removed (it was a lightness signal on a lightness ramp). The deferred
texture overlay in `choropleth-painter.ts` is the intended fix. 14 classes makes the
speckle more visible without making it more or less honest.

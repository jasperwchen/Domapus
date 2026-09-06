"""How noisy is a ZIP's median sale price, and how do we say so honestly.

A median over 4 sales and a median over 400 are not the same kind of number, and
a choropleth that paints them identically is lying. This module puts a number on
that difference.

Classical order-statistic theory gives `se(median) = 1 / (2 * f(m) * sqrt(n))`.
Taking logs turns the unknown density into a single scale constant:

    se(log median) = 1.2533 * sd(log price) / sqrt(n) = K / sqrt(n)

`K` is fitted from the panel rather than assumed. The fit is a high-pass filter:
compare each period's log median against the average of the periods `lag` before
and after it, standardise by what independent sampling would predict, and take a
robust (MAD) scale of what is left. Local price trend cancels in the difference,
so what survives is sampling noise.

WHY LAG 3. Redfin's ZIP window is a calendar-aligned rolling THREE MONTHS, so
consecutive rows share two of their three months of transactions and their
sampling errors are correlated (rho1 ~= 0.70, rho2 ~= 0.33). The standardisation
assumes independence, so at lag 1 the estimator recovers only ~43% of K. Lag 3 is
the first lag with zero shared transactions; lag 4+ starts to overstate because
the local-linearity assumption degrades over a longer span. The plateau between
lag 3 and lag 4 is what proves the story, and `calibrate()` returns the ratio so a
test can assert it.

The reliability tier this produces is a property of the ZIP's TRANSACTION SAMPLE,
not of whichever metric is on screen. That is what makes it metric-invariant, and
metric-invariance is what makes the paint byte's cross-artifact assertion
writable at all (spec section 4.2).
"""

import logging

import numpy as np
import pyarrow.compute as pc
import pyarrow.parquet as pq

from .contracts import PipelineError

log = logging.getLogger(__name__)

# 1.4826 makes the MAD a consistent estimator of the standard deviation under
# normality. It is not a fudge factor.
MAD_TO_SD = 1.4826

# The lag whose K is shipped, and the sweep it is chosen from.
LAG_USED = 3
LAG_SWEEP = range(1, 8)

# `rse >= this` puts a ZIP in the tier below. The EDGES are the contract; the
# sample sizes they imply move with K and are reported per release as
# `tier_n_implied` rather than written down here, because writing them down is
# how the spec ended up quoting n >= 30 against a K that no longer implies it.
#
#   tier 3 high  rse < 4%    n >= 196 at K = 0.5598  (was 182 at K = 0.5395)
#   tier 2 good  4-6%        n >=  88               (was  81)
#   tier 1 fair  6-10%       n >=  32               (was  30)
#   tier 0 low   >= 10%      below that
TIER_EDGES = (0.10, 0.06, 0.04)

# The single rankable threshold, used for exactly three things so it can be
# explained once: which ZIPs may set the national class breaks, which are
# eligible for LISA, and which count as "rankable" in the coverage headline.
#
# IT IS AN RSE THRESHOLD, NOT A SAMPLE-SIZE ONE, and the distinction is not
# pedantry. The spec quotes it as `n >= 30`, which was true of the DEAD feed's
# K = 0.5395 (0.5395/sqrt(30) = 9.85% < 10%). The migrated feed fits K = 0.5598,
# where n = 30 gives 10.22% and is no longer rankable — so a hardcoded 30 would
# quietly stop meaning "rse < 10%" and the one number this section exists to
# explain once would be explained two different ways.
#
# So the gate is `rel >= 1`, the implied sample size is DERIVED from the fitted K
# and reported in the manifest as `rankable_n_implied` (32 on this release), and
# the methodology page quotes the percentage with the sample size in parentheses.
RANKABLE_RSE = TIER_EDGES[0]

# A plateau, not an equality. If lag 4's K ran far above lag 3's the
# local-linearity assumption would be failing and the fit would be measuring
# trend rather than noise.
PLATEAU_MAX = 1.15


def _pivot(panel_path, column: str, index) -> np.ndarray:
    """One panel column as a dense [T x Z] float array, NaN where missing.

    Reads two key columns plus the value column, so the 1.5 GB table never lands
    in memory — 173 x 33,952 float64 is 47 MB per metric.
    """
    tbl = pq.read_table(panel_path, columns=["zip", "period_end", column])
    periods, zips = index
    prow = {p: i for i, p in enumerate(periods)}
    zcol = {z: i for i, z in enumerate(zips)}

    out = np.full((len(periods), len(zips)), np.nan)
    ps = tbl["period_end"].to_pylist()
    zs = tbl["zip"].to_pylist()
    vs = tbl[column].to_numpy(zero_copy_only=False)

    rows = np.fromiter((prow[p] for p in ps), dtype=np.int32, count=len(ps))
    cols = np.fromiter((zcol[z] for z in zs), dtype=np.int32, count=len(zs))
    out[rows, cols] = vs
    return out


def panel_index(panel_path) -> tuple[list[str], list[str]]:
    """(periods oldest-first, zips sorted). The axes every pivot shares."""
    keys = pq.read_table(panel_path, columns=["zip", "period_end"])
    periods = sorted(pc.unique(keys["period_end"]).to_pylist())
    zips = sorted(pc.unique(keys["zip"]).to_pylist())
    return periods, zips


def calibrate_K(L: np.ndarray, N: np.ndarray, lag: int) -> float:
    """Robust scale of the standardised high-pass residual.

    L: [T x Z] log median sale price, NaN where missing.
    N: [T x Z] homes sold, NaN or 0 where missing.
    """
    d = L[lag:-lag] - 0.5 * (L[: -2 * lag] + L[2 * lag :])
    with np.errstate(divide="ignore", invalid="ignore"):
        w = np.sqrt(1.0 / N[lag:-lag] + 0.25 / N[: -2 * lag] + 0.25 / N[2 * lag :])
        s = (d / w).ravel()
    s = s[np.isfinite(s)]
    if s.size == 0:
        raise PipelineError(f"noise: lag {lag} left no finite residuals to fit K on")
    return float(MAD_TO_SD * np.median(np.abs(s - np.median(s))))


def calibrate(L: np.ndarray, N: np.ndarray) -> dict:
    """The lag sweep, the shipped K, and the plateau ratio that justifies it."""
    ks = [calibrate_K(L, N, lag) for lag in LAG_SWEEP]
    k_used = ks[LAG_USED - 1]
    plateau = ks[LAG_USED] / k_used

    # Stability across sample size is what validates the 1/sqrt(n) FORM. A single
    # pooled number cannot be checked against anything; this can.
    buckets = _k_by_sample_size(L, N)

    if not (0.2 <= k_used <= 1.5):
        raise PipelineError(
            f"noise: K = {k_used:.4f} is outside any plausible range for the log "
            f"scale of ZIP sale prices. The panel's units have probably changed."
        )
    if plateau > PLATEAU_MAX:
        log.warning(
            "noise: K(lag 4)/K(lag 3) = %.3f exceeds %.2f — the plateau that "
            "justifies lag 3 is weakening; check for a trend the filter is not "
            "removing", plateau, PLATEAU_MAX,
        )

    return {
        "K": round(k_used, 4),
        "K_lag_used": LAG_USED,
        "K_lag": [round(k, 4) for k in ks],
        "plateau_ratio": round(plateau, 4),
        "K_by_sample_size": buckets,
    }


def _k_by_sample_size(L: np.ndarray, N: np.ndarray) -> dict:
    """K refitted inside sample-size buckets, at the shipped lag.

    The thin buckets carrying the HIGHEST K is a stated limitation, not a bug: a
    single pooled constant makes error bars too narrow precisely for the ZIPs
    that need them widest.
    """
    lag = LAG_USED
    d = L[lag:-lag] - 0.5 * (L[: -2 * lag] + L[2 * lag :])
    with np.errstate(divide="ignore", invalid="ignore"):
        w = np.sqrt(1.0 / N[lag:-lag] + 0.25 / N[: -2 * lag] + 0.25 / N[2 * lag :])
        s = d / w
    n = N[lag:-lag]

    out = {}
    for lo, hi in ((1, 3), (3, 5), (5, 10), (10, 20), (20, 40), (40, 80), (80, 160), (160, None)):
        m = (n >= lo) & np.isfinite(s) if hi is None else (n >= lo) & (n < hi) & np.isfinite(s)
        v = s[m]
        label = f"{lo}+" if hi is None else f"{lo}-{hi - 1}"
        out[label] = round(float(MAD_TO_SD * np.median(np.abs(v - np.median(v)))), 4) \
            if v.size else None
    return out


def tier_of(rse: float | None) -> int:
    """0 low .. 3 high. Undefined reliability is tier 0, never a middle tier.

    `None` here means the ZIP has no sale sample at all — 3,393 latest-period ZIPs
    carry ACTIVE LISTINGS with HOMES SOLD null. Spec section 4.2 fixes those at
    tier 0 and forbids the client from fading a listings map by a sales
    statistic, which is the other half of the same decision.
    """
    if rse is None:
        return 0
    for tier, edge in enumerate(TIER_EDGES):  # 0.10, 0.06, 0.04
        if rse >= edge:
            return tier
    return 3


# Per-metric K. `0.5395`/`0.5598` is calibrated for MEDIAN SALE PRICE only, and
# reusing it for a different statistic on a different scale would be wrong — the
# constant is `1.2533 * sd(log x)`, and the dispersion of log days-on-market has
# nothing to do with the dispersion of log price.
#
# Only `median_dom` reaches the wire, as `dom_rse`. `avg_sale_to_list_ratio` is
# fitted and recorded as a diagnostic but has no snapshot column: it is
# detail-panel only, and adding a column for it would shift every column after it
# for a number nothing renders.
#
# NONE of these change the paint byte. The reliability nibble is metric-invariant
# by construction (spec section 4.2) and carries the sale-sample tier whatever is
# painted.
PER_METRIC = ("median_dom", "avg_sale_to_list_ratio")
RSE_COLUMN = {"median_dom": "dom_rse"}


def measure_per_metric(panel_path, records: dict, index) -> dict:
    """Fit K for the non-price metrics and write their `*_rse` columns.

    Same estimator, same lag, different series. The log transform is what makes
    one estimator serve all three: it turns the unknown density at the median into
    a scale constant, and every one of these is a positive quantity whose relative
    spread is the meaningful thing.
    """
    counts = _pivot(panel_path, "homes_sold", index)
    N = np.where(counts > 0, counts, np.nan)

    out = {}
    for metric in PER_METRIC:
        values = _pivot(panel_path, metric, index)
        with np.errstate(divide="ignore", invalid="ignore"):
            L = np.log(np.where(values > 0, values, np.nan))
        ks = [calibrate_K(L, N, lag) for lag in LAG_SWEEP]
        k = ks[LAG_USED - 1]
        out[metric] = {
            "K": round(k, 4),
            "K_lag": [round(v, 4) for v in ks],
            "plateau_ratio": round(ks[LAG_USED] / k, 4),
        }

        column = RSE_COLUMN.get(metric)
        if column is None:
            continue
        filled = 0
        for rec in records.values():
            n = rec.get("homes_sold")
            if n and rec.get(metric) is not None:
                rec[column] = round(k / (n ** 0.5), 6)
                filled += 1
            else:
                rec[column] = None
        out[metric]["column"] = column
        out[metric]["filled"] = filled

    log.info(
        "Noise (per-metric): %s",
        ", ".join(f"K[{m}] = {v['K']:.4f}" for m, v in out.items()),
    )
    return out


def measure(panel_path, records: dict) -> dict:
    """Fit K on the panel, then write `msp_rse` and `rel` into `records`.

    Mutates `records` in place: it is the same dict `serialize.assemble` built and
    the snapshot is written from it.
    """
    index = panel_index(panel_path)
    prices = _pivot(panel_path, "median_sale_price", index)
    counts = _pivot(panel_path, "homes_sold", index)

    with np.errstate(divide="ignore", invalid="ignore"):
        L = np.log(np.where(prices > 0, prices, np.nan))
    N = np.where(counts > 0, counts, np.nan)

    fit = calibrate(L, N)
    K = fit["K"]
    fit["per_metric"] = measure_per_metric(panel_path, records, index)

    tiers = dict.fromkeys(range(4), 0)
    rankable = 0
    reporting = 0
    for rec in records.values():
        n = rec.get("homes_sold")
        rse = K / (n ** 0.5) if n else None
        rec["msp_rse"] = None if rse is None else round(rse, 6)
        rec["rel"] = tier_of(rse)
        tiers[rec["rel"]] += 1
        if n:
            reporting += 1
            if rec["rel"] >= 1:
                rankable += 1

    implied_n = int(-(-((K / RANKABLE_RSE) ** 2) // 1))  # ceil
    fit["tiers"] = tiers
    fit["reporting_zips"] = reporting
    fit["rankable_zips"] = rankable
    fit["rankable_share"] = round(rankable / reporting, 4) if reporting else 0.0
    fit["rankable_rse"] = RANKABLE_RSE
    fit["rankable_n_implied"] = implied_n
    fit["tier_n_implied"] = [int(-(-((K / e) ** 2) // 1)) for e in TIER_EDGES]

    log.info(
        "Noise: K = %.4f (lag %d, plateau %.3f); %s of %s reporting ZIPs are "
        "rankable at rse < %.0f%% (n >= %d), %.1f%%",
        K, LAG_USED, fit["plateau_ratio"], f"{rankable:,}", f"{reporting:,}",
        RANKABLE_RSE * 100, implied_n, fit["rankable_share"] * 100,
    )
    return fit

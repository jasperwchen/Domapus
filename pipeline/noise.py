"""Sampling noise of a ZIP's median sale price, and the reliability tier it implies.

    se(log median) = 1.2533 * sd(log price) / sqrt(n) = K / sqrt(n)

K is fitted from the panel: compare each period's log median with the mean of the periods
`lag` before and after, standardise by the independent-sampling prediction, take a MAD
scale. Local trend cancels; sampling noise remains.

Lag 3 because Redfin's window is a rolling three months: consecutive rows share
transactions (rho1 ~0.70), which at lag 1 recovers only ~43% of K. Lag 3 shares none, and
lag 4 plateaus with it; `calibrate()` reports that ratio.

The tier describes the transaction sample, so it is metric-invariant (paint byte nibble).
"""

import logging

import numpy as np
import pyarrow.parquet as pq

from . import panel
from .contracts import PipelineError

log = logging.getLogger(__name__)

# MAD -> sd under normality.
MAD_TO_SD = 1.4826

LAG_USED = 3
LAG_SWEEP = range(1, 8)

# rse edges: >= 10% tier 0, 6-10% tier 1, 4-6% tier 2, < 4% tier 3. Implied sample sizes
# move with K and are reported per release (`tier_n_implied`), not written here.
TIER_EDGES = (0.10, 0.06, 0.04)

# Rankable = rse < 10% (`rel >= 1`): who sets class breaks, who is LISA-eligible, and the
# coverage headline. An rse threshold, not "n >= 30": that only held for an older K.
RANKABLE_RSE = TIER_EDGES[0]

# K(lag 4)/K(lag 3) above this means the filter is measuring trend, not noise.
PLATEAU_MAX = 1.15


def _pivot(panel_path, column: str, index) -> np.ndarray:
    """One panel column as a dense [T x Z] float array, reading only three columns."""
    periods, zips = index
    tbl = pq.read_table(panel_path, columns=["zip", "period_end", column])
    return panel.dense(tbl, "period_end", "zip", column, periods, zips)


def panel_index(panel_path) -> tuple[list[str], list[str]]:
    """(periods oldest-first, zips sorted). The axes every pivot shares."""
    keys = pq.read_table(panel_path, columns=["zip", "period_end"])
    return panel.axis(keys, "period_end"), panel.axis(keys, "zip")


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
    """K per sample-size bucket. Thin buckets carry a higher K, so one pooled K makes error
    bars too narrow exactly where they should be widest (a stated limitation)."""
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


def rankable(rec: dict) -> bool:
    """Tier 1 or better: the gate for ranking, classing and spatial statistics."""
    return (rec.get("rel") or 0) >= 1


def tier_of(rse: float | None) -> int:
    """0 low .. 3 high. No sale sample (e.g. listings with no sales) is tier 0."""
    if rse is None:
        return 0
    for tier, edge in enumerate(TIER_EDGES):  # 0.10, 0.06, 0.04
        if rse >= edge:
            return tier
    return 3


# K for other positive metrics, same estimator. Only `median_dom` reaches the wire
# (`dom_rse`); the sale-to-list K is a diagnostic. Neither changes the paint byte.
PER_METRIC = ("median_dom", "avg_sale_to_list_ratio")
RSE_COLUMN = {"median_dom": "dom_rse"}


def measure_per_metric(panel_path, records: dict, index) -> dict:
    """Fit K for `PER_METRIC` and write their `*_rse` columns."""
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
    """Fit K, then write `msp_rse` and `rel` into `records` in place."""
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

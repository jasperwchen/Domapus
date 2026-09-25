"""ZHVI 12-month forecast with calibrated intervals.

Model: AR(1) on log monthly growth (measured ACF(1) = 0.91), which is a damped local trend,
i.e. ARIMA(1,1,0) with drift. Closed form, ~14 us per ZIP; statsmodels is test-only.

Interval: the AR(1) multi-step variance plus the drift-estimation term

    Var(e_h)    = sigma^2 * sum_{k<h} ((1 - rho^(k+1)) / (1 - rho))^2
    Var(mu_hat) = (sigma_g^2 / W) * (1 + rho) / (1 - rho),   sigma_g^2 = sigma^2 / (1 - rho^2)

`sigma_g` is the marginal sd, not the innovation sd (5.7x apart at rho = 0.91). The shipped
band is an empirical q[h][p] table times each ZIP's residual sigma; the random-walk and
closed-form coverages are published alongside it.
"""

import contextlib
import logging
import warnings

import numpy as np

from .contracts import PipelineError

log = logging.getLogger(__name__)


@contextlib.contextmanager
def _all_nan_columns_ok():
    """Silence numpy's all-NaN-column RuntimeWarnings (no ZHVI history) and nothing else.
    `np.errstate` does not cover these; they are Python warnings."""
    with warnings.catch_warnings(), np.errstate(invalid="ignore"):
        warnings.filterwarnings("ignore", "Mean of empty slice", RuntimeWarning)
        warnings.filterwarnings("ignore", "Degrees of freedom <= 0", RuntimeWarning)
        yield

W = 36                  # months of growth the fit sees
RHO_SHRINK = 0.5        # James-Stein style pull toward the cross-sectional median
RHO_MAX = 0.98          # a unit root in a per-ZIP fit is noise, not a trend
HORIZONS = (1, 3, 6, 12)
SHIPPED_HORIZON = 12

# Tier ladder:  >= 60 obs  per-ZIP AR(1)  (3)
#               24-59      median rho, own mu  (2)
#               < 24       no forecast  (0)
# Tier 1 (a metro growth path) was never implemented, so it is never assigned; collapsed
# into tier 0 on 2026-09-12. Shortest shipped history is 31 months, so the band is empty.
TIER_FULL, TIER_SHORT = 60, 24

NOMINAL = 0.80
LEVELS = (0.50, 0.80, 0.90, 0.95, 0.98, 0.99)

# Quarterly expanding-window origins; the first half fits q, the second half evaluates.
ORIGIN_STRIDE = 3
MIN_TRAIN = 60


def fit(LZ: np.ndarray, counts: np.ndarray | None = None) -> dict:
    """AR(1) on log growth per column. LZ: [T x Z] log level, NaN where missing.

    With `counts`, ZIPs below `TIER_FULL` take the cross-sectional median rho. `None` fits
    every column alike, as the backtest wants.
    """
    g = np.diff(LZ, axis=0)[-W:]
    with _all_nan_columns_ok():
        mu = np.nanmean(g, axis=0)
        gc = g - mu
        num = np.nansum(gc[1:] * gc[:-1], axis=0)
        den = np.maximum(np.nansum(gc[:-1] ** 2, axis=0), 1e-12)
        rho = np.clip(num / den, 0.0, RHO_MAX)

    median_rho = float(np.nanmedian(rho))
    rho = RHO_SHRINK * rho + (1.0 - RHO_SHRINK) * median_rho
    if counts is not None:
        rho = np.where(counts >= TIER_FULL, rho, median_rho)

    with _all_nan_columns_ok():
        res = g[1:] - (mu + rho * (g[:-1] - mu))
        sigma = np.nanstd(res, axis=0, ddof=1)

    last = LZ[-1]
    last_g = g[-1]
    with np.errstate(invalid="ignore"):
        f = np.stack([
            last + mu * h + (last_g - mu) * rho * (1.0 - rho ** h) / np.maximum(1.0 - rho, 1e-9)
            for h in HORIZONS
        ])
    return {"mu": mu, "rho": rho, "sigma": sigma, "f": f, "median_rho": median_rho}


def closed_form_sd(rho: np.ndarray, sigma: np.ndarray, h: int) -> np.ndarray:
    """The AR(1)-on-growth h-step sd, drift-estimation term included."""
    r = np.clip(rho, 0.0, RHO_MAX)
    denom = np.maximum(1.0 - r, 1e-9)
    k = np.arange(h)[:, None]
    psi = (1.0 - r[None, :] ** (k + 1)) / denom[None, :]
    var_e = sigma ** 2 * np.sum(psi ** 2, axis=0)

    var_g = sigma ** 2 / np.maximum(1.0 - r ** 2, 1e-9)
    var_mu = (var_g / W) * (1.0 + r) / denom
    return np.sqrt(var_e + (h ** 2) * var_mu)


def _tier(counts: np.ndarray) -> np.ndarray:
    """0 = no forecast, 2 = shrunk fit, 3 = full per-ZIP AR(1). 1 is never assigned."""
    t = np.zeros(counts.shape, dtype=np.int8)
    t[counts >= TIER_SHORT] = 2
    t[counts >= TIER_FULL] = 3
    return t


def backtest(LZ: np.ndarray, eligible: np.ndarray) -> dict:
    """Walk-forward backtest. Each fold refits from scratch, including the median rho, so the
    shrinkage target does not leak the future."""
    T = LZ.shape[0]
    origins = list(range(MIN_TRAIN, T - max(HORIZONS), ORIGIN_STRIDE))
    if len(origins) < 4:
        raise PipelineError(f"forecast: only {len(origins)} backtest origins; need at least 4")
    half = len(origins) // 2
    calib, evaluate = origins[:half], origins[half:]

    def errors(where, keep_abs):
        """Standardised log errors per horizon, plus absolute errors if asked."""
        out = {h: [] for h in HORIZONS}
        raw = {h: [] for h in HORIZONS}
        for o in where:
            m = fit(LZ[:o])
            sig = np.where(np.isfinite(m["sigma"]) & (m["sigma"] > 0), m["sigma"], np.nan)
            for hi, h in enumerate(HORIZONS):
                actual = LZ[o + h - 1]
                err = actual - m["f"][hi]
                ok = np.isfinite(err) & np.isfinite(sig) & eligible
                out[h].append(err[ok] / sig[ok])
                if keep_abs:
                    raw[h].append(np.abs(err[ok]))
        return ({h: np.concatenate(v) for h, v in out.items()},
                {h: np.concatenate(v) for h, v in raw.items()} if keep_abs else None)

    std_c, _ = errors(calib, keep_abs=False)
    std_e, abs_e = errors(evaluate, keep_abs=True)

    q = {}
    for h in HORIZONS:
        s = std_c[h]
        q[h] = {}
        for p in LEVELS:
            lo, hi = (1.0 - p) / 2.0, 1.0 - (1.0 - p) / 2.0
            q[h][p] = [round(float(np.quantile(s, lo)), 4), round(float(np.quantile(s, hi)), 4)]

    hi_n = 1.0 - (1.0 - NOMINAL) / 2.0
    z = float(np.quantile(std_c[1], hi_n))  # a normal-ish 1-step multiplier
    # Diagnostic scale for the closed-form row; independent of h.
    full = fit(LZ)
    coverage = {"nominal": NOMINAL, "random_walk_sqrt_h": {}, "ar1_closed_form": {},
                "empirical_quantiles": {}}
    for h in HORIZONS:
        s = std_e[h]
        # 1. random walk sigma*sqrt(h)
        coverage["random_walk_sqrt_h"][h] = round(float(np.mean(np.abs(s) <= z * np.sqrt(h))), 4)
        # 2. AR(1) closed form at the median rho
        scale = float(np.nanmedian(
            closed_form_sd(full["rho"], np.ones_like(full["sigma"]), h)
        ))
        coverage["ar1_closed_form"][h] = round(float(np.mean(np.abs(s) <= z * scale)), 4)
        # 3. shipped empirical quantiles
        ql, qh = q[h][NOMINAL]
        coverage["empirical_quantiles"][h] = round(float(np.mean((s >= ql) & (s <= qh))), 4)

    mae = {h: round(float(np.mean(abs_e[h])) * 100, 3) for h in HORIZONS}
    naive = _naive_mae(LZ, evaluate, eligible)
    mase = {h: round(mae[h] / naive[h], 3) if naive[h] else None for h in HORIZONS}

    # Drift, not contract: failing to beat naive warns and is recorded, never blocks.
    beats = all(v is not None and v < 1.0 for v in mase.values())
    if not beats:
        log.warning(
            "forecast: AR(1) does not beat naive at every horizon (MASE %s). Shipping "
            "AR(1) anyway; the MASE is recorded in the manifest.", mase,
        )

    return {
        "origins": {"total": len(origins), "calibration": len(calib), "evaluation": len(evaluate),
                    "stride_months": ORIGIN_STRIDE,
                    # h=12 windows overlap 9 months at a 3-month stride.
                    "effective_independent": max(1, len(origins) // (max(HORIZONS) // ORIGIN_STRIDE))},
        "eligible_zips": int(eligible.sum()),
        "q": {str(h): {str(p): v for p, v in q[h].items()} for h in HORIZONS},
        "coverage": coverage,
        "mae_log_x100": mae,
        "naive_mae_log_x100": naive,
        "mase": mase,
        "beats_naive": beats,
    }


def _naive_mae(LZ: np.ndarray, origins, eligible) -> dict:
    """Last-value-carried-forward, the benchmark MASE is defined against."""
    out = {}
    for h in HORIZONS:
        acc = []
        for o in origins:
            err = LZ[o + h - 1] - LZ[o - 1]
            ok = np.isfinite(err) & eligible
            acc.append(np.abs(err[ok]))
        out[h] = round(float(np.mean(np.concatenate(acc))) * 100, 3)
    return out


def run(panel_path, records: dict) -> dict:
    """Fit, backtest, and write `f_h12`, `f_sigma` and `f_tier` into `records`."""
    from . import panel

    months, zips, A = panel.zhvi_matrix(panel_path)
    zi = {z: i for i, z in enumerate(zips)}

    with np.errstate(divide="ignore", invalid="ignore"):
        LZ = np.log(np.where(A > 0, A, np.nan))

    counts = np.isfinite(LZ).sum(axis=0)
    tiers = _tier(counts)
    model = fit(LZ, counts)

    # Headline backtest on >= 60 obs, not complete history (a survivorship filter).
    eligible = counts >= TIER_FULL
    bt = backtest(LZ, eligible)
    bt["complete_history_zips"] = int((counts == len(months)).sum())

    hi = HORIZONS.index(SHIPPED_HORIZON)
    sd = closed_form_sd(model["rho"], model["sigma"], SHIPPED_HORIZON)

    # Only f_h12 is a snapshot column; f_h1/3/6 stay on the record for history.py.
    filled = 0
    for zip_code, rec in records.items():
        j = zi.get(zip_code)
        if j is None or tiers[j] == 0 or not np.isfinite(model["f"][hi, j]):
            rec["f_sigma"] = None
            rec["f_tier"] = 0
            for h in HORIZONS:
                rec[f"f_h{h}"] = None
            continue
        for k, h in enumerate(HORIZONS):
            v = model["f"][k, j]
            rec[f"f_h{h}"] = int(round(float(np.exp(v)))) if np.isfinite(v) else None
        rec["f_sigma"] = round(float(model["sigma"][j]), 6) if np.isfinite(model["sigma"][j]) else None
        rec["f_tier"] = int(tiers[j])
        filled += 1

    report = {
        "horizon": SHIPPED_HORIZON,
        "horizons": list(HORIZONS),
        "window_months": W,
        "rho_shrink": RHO_SHRINK,
        "median_rho": round(model["median_rho"], 4),
        "vintage": months[-1],
        "zips_forecast": filled,
        "tier_counts": {t: int((tiers == t).sum()) for t in (0, 2, 3)},
        "median_sd_h12": round(float(np.nanmedian(sd)), 6),
        "backtest": bt,
    }
    log.info(
        "Forecast: %s ZIPs at h=%d, median rho %.3f; MASE %s; shipped-band coverage %s",
        f"{filled:,}", SHIPPED_HORIZON, model["median_rho"], bt["mase"],
        bt["coverage"]["empirical_quantiles"],
    )
    return report

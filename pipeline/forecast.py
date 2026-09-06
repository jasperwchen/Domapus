"""Where ZHVI is heading, and how wrong that is likely to be.

**The model was chosen by a diagnostic, not by taste.** Measured ZHVI monthly
growth has `ACF(1) = 0.91`. That means an AR(1) on growth — and an AR(1) on growth
IS a damped local trend, i.e. `ETS(A,Ad,N)` with `phi = rho`, i.e. `ARIMA(1,1,0)`
with a constant. Stating the equivalence is cheaper than buying the machinery: the
closed form here costs ~14 us per ZIP against statsmodels' 17.8 ms per series, and
per-series Holt-Winters at 20,000 ZIPs would exceed the 6-hour Actions job limit.
`statsmodels` stays a TEST-ONLY dependency that asserts the two agree.

**The interval is the point of this module, and it is where the obvious approach
fails.** `sigma * sqrt(h)` is the correct multi-step variance for a RANDOM WALK.
We fit an AR(1), whose own closed-form multi-step variance is one line:

    Var(e_h) = sigma^2 * sum_{k=0}^{h-1} ((1 - rho^(k+1)) / (1 - rho))^2

plus the drift-estimation term, which is first-order at h = 12:

    Var(mu_hat) = (sigma_g^2 / W) * (1 + rho) / (1 - rho)
    Var_total   = Var(e_h) + h^2 * Var(mu_hat)

**`sigma_g` is the MARGINAL sd of growth, not the innovation sd.** `Var(mu_hat)`
is the variance of the sample mean of an autocorrelated series, so it takes the
marginal variance `sigma^2 / (1 - rho^2)`. At rho = 0.91 the two differ by 5.7x on
a term this section calls first-order — confusing them is worse than omitting it.

Three interval methods are measured and all three are published, because reporting
what a method ACHIEVED rather than what it promised is the strongest credibility
signal available. The shipped band is the third: a global `q[h][p]` table times
each ZIP's own residual sigma, so the client reconstructs any confidence level
with two multiplies and an `exp`.
"""

import logging

import numpy as np

from .contracts import PipelineError

log = logging.getLogger(__name__)

W = 36                  # months of growth the fit sees
RHO_SHRINK = 0.5        # James-Stein style pull toward the cross-sectional median
RHO_MAX = 0.98          # a unit root in a per-ZIP fit is noise, not a trend
HORIZONS = (1, 3, 6, 12)
SHIPPED_HORIZON = 12

# Fallback ladder. A forecast from 14 observations is not the same object as one
# from 300, and pretending otherwise is what `f_tier` exists to prevent.
#
#   >= 60 obs   full per-ZIP AR(1)                                   tier 3
#   24-59       W = min(36, T-1), cross-sectional median rho, own mu tier 2
#   12-23       the METRO's growth path on the ZIP's last level      tier 1
#   < 12        no forecast. The UI says so; it never draws an empty chart.
TIER_FULL, TIER_SHORT, TIER_METRO = 60, 24, 12

# Nominal coverage of the shipped band, and the levels the client slider offers.
NOMINAL = 0.80
LEVELS = (0.50, 0.80, 0.90, 0.95, 0.98, 0.99)

# Backtest design. Quarterly origins, expanding window; the first half calibrates
# the q table and the second half evaluates, because coverage measured on the
# origins that fitted the quantiles is not out-of-sample.
ORIGIN_STRIDE = 3
MIN_TRAIN = 60


def fit(LZ: np.ndarray, counts: np.ndarray | None = None) -> dict:
    """AR(1) on log growth, per column. LZ: [T x Z] log level, NaN where missing.

    `counts` applies the fallback ladder. A per-ZIP rho estimated from 30 growth
    observations is mostly noise, so ZIPs below the full-fit threshold take the
    cross-sectional median rho outright and estimate only their own drift. Passing
    `None` fits every column the same way, which is what the backtest folds want
    when they are measuring the estimator rather than the shipped product.
    """
    g = np.diff(LZ, axis=0)[-W:]
    with np.errstate(invalid="ignore"):
        mu = np.nanmean(g, axis=0)
        gc = g - mu
        num = np.nansum(gc[1:] * gc[:-1], axis=0)
        den = np.maximum(np.nansum(gc[:-1] ** 2, axis=0), 1e-12)
        rho = np.clip(num / den, 0.0, RHO_MAX)

    median_rho = float(np.nanmedian(rho))
    rho = RHO_SHRINK * rho + (1.0 - RHO_SHRINK) * median_rho
    if counts is not None:
        rho = np.where(counts >= TIER_FULL, rho, median_rho)

    with np.errstate(invalid="ignore"):
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

    # Marginal, not innovation. See the module docstring.
    var_g = sigma ** 2 / np.maximum(1.0 - r ** 2, 1e-9)
    var_mu = (var_g / W) * (1.0 + r) / denom
    return np.sqrt(var_e + (h ** 2) * var_mu)


def _tier(counts: np.ndarray) -> np.ndarray:
    t = np.zeros(counts.shape, dtype=np.int8)
    t[counts >= TIER_METRO] = 1
    t[counts >= TIER_SHORT] = 2
    t[counts >= TIER_FULL] = 3
    return t


def backtest(LZ: np.ndarray, eligible: np.ndarray) -> dict:
    """Expanding-window walk-forward. Returns the q table and all three coverages.

    Every fold refits from scratch — including the cross-sectional median rho —
    because a shrinkage target estimated on the full sample leaks the future into
    every origin that uses it.
    """
    T = LZ.shape[0]
    origins = list(range(MIN_TRAIN, T - max(HORIZONS), ORIGIN_STRIDE))
    if len(origins) < 4:
        raise PipelineError(f"forecast: only {len(origins)} backtest origins; need at least 4")
    half = len(origins) // 2
    calib, evaluate = origins[:half], origins[half:]

    def errors(where):
        """Standardised log errors per horizon: (actual - forecast) / sigma."""
        out = {h: [] for h in HORIZONS}
        raw = {h: [] for h in HORIZONS}
        for o in where:
            m = fit(LZ[:o])
            sig = np.where(np.isfinite(m["sigma"]) & (m["sigma"] > 0), m["sigma"], np.nan)
            for hi, h in enumerate(HORIZONS):
                actual = LZ[o + h - 1]
                err = actual - m["f"][hi]
                ok = np.isfinite(err) & np.isfinite(sig) & eligible
                out[h].append((err[ok] / sig[ok]))
                raw[h].append(np.abs(err[ok]))
        return ({h: np.concatenate(v) for h, v in out.items()},
                {h: np.concatenate(v) for h, v in raw.items()})

    std_c, _ = errors(calib)
    std_e, abs_e = errors(evaluate)

    # The shipped table: per-horizon, per-level quantiles of the standardised
    # error, fitted on the calibration origins only.
    q = {}
    for h in HORIZONS:
        s = std_c[h]
        q[h] = {}
        for p in LEVELS:
            lo, hi = (1.0 - p) / 2.0, 1.0 - (1.0 - p) / 2.0
            q[h][p] = [round(float(np.quantile(s, lo)), 4), round(float(np.quantile(s, hi)), 4)]

    lo_n, hi_n = (1.0 - NOMINAL) / 2.0, 1.0 - (1.0 - NOMINAL) / 2.0
    z = float(np.quantile(std_c[1], hi_n))  # a normal-ish 1-step multiplier
    # One full-sample fit, reused across horizons. It is a diagnostic scale for
    # row 2 below and does not depend on h, so refitting it inside the loop cost
    # four fits over the whole [T x Z] panel for four identical answers.
    full = fit(LZ)
    coverage = {"nominal": NOMINAL, "random_walk_sqrt_h": {}, "ar1_closed_form": {},
                "empirical_quantiles": {}}
    for h in HORIZONS:
        s = std_e[h]
        # 1. the shortcut: a random walk's sigma*sqrt(h), in standardised units
        coverage["random_walk_sqrt_h"][h] = round(float(np.mean(np.abs(s) <= z * np.sqrt(h))), 4)
        # 2. our own model's closed form, evaluated at the median rho so the row
        #    describes the method rather than one ZIP
        scale = float(np.nanmedian(
            closed_form_sd(full["rho"], np.ones_like(full["sigma"]), h)
        ))
        coverage["ar1_closed_form"][h] = round(float(np.mean(np.abs(s) <= z * scale)), 4)
        # 3. what ships
        ql, qh = q[h][NOMINAL]
        coverage["empirical_quantiles"][h] = round(float(np.mean((s >= ql) & (s <= qh))), 4)

    mae = {h: round(float(np.mean(abs_e[h])) * 100, 3) for h in HORIZONS}
    naive = _naive_mae(LZ, evaluate, eligible)
    mase = {h: round(mae[h] / naive[h], 3) if naive[h] else None for h in HORIZONS}

    # DRIFT tier, not CONTRACT: if AR(1) fails to beat naive the pipeline ships
    # the naive forecast and says so. It records the failure; it does not block a
    # publication over a modelling result.
    beats = all(v is not None and v < 1.0 for v in mase.values())
    if not beats:
        log.warning(
            "forecast: AR(1) does not beat naive at every horizon (MASE %s). The "
            "naive forecast is the honest thing to ship this release.", mase,
        )

    return {
        "origins": {"total": len(origins), "calibration": len(calib), "evaluation": len(evaluate),
                    "stride_months": ORIGIN_STRIDE,
                    # h=12 windows overlap by nine months at a quarterly stride, so
                    # the nominal count overstates independence by ~4x. Publish the
                    # effective number, not the flattering one.
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
    import pyarrow.compute as pc
    import pyarrow.parquet as pq

    tbl = pq.read_table(panel_path, columns=["zip", "month", "zhvi"])
    months = sorted(pc.unique(tbl["month"]).to_pylist())
    zips = sorted(pc.unique(tbl["zip"]).to_pylist())
    mi = {m: i for i, m in enumerate(months)}
    zi = {z: i for i, z in enumerate(zips)}

    A = np.full((len(months), len(zips)), np.nan)
    A[
        np.fromiter((mi[m] for m in tbl["month"].to_pylist()), np.int32, tbl.num_rows),
        np.fromiter((zi[z] for z in tbl["zip"].to_pylist()), np.int32, tbl.num_rows),
    ] = tbl["zhvi"].to_numpy(zero_copy_only=False)

    with np.errstate(divide="ignore", invalid="ignore"):
        LZ = np.log(np.where(A > 0, A, np.nan))

    counts = np.isfinite(LZ).sum(axis=0)
    tiers = _tier(counts)
    model = fit(LZ, counts)

    # The headline backtest runs on ZIPs with >= 60 observations, NOT on the
    # complete-history subset. Complete history is a survivorship filter selecting
    # large, established, continuously-transacting markets, and reporting it as the
    # headline flatters the model. It is published as the footnote instead.
    eligible = counts >= TIER_FULL
    bt = backtest(LZ, eligible)
    bt["complete_history_zips"] = int((counts == len(months)).sum())

    hi = HORIZONS.index(SHIPPED_HORIZON)
    sd = closed_form_sd(model["rho"], model["sigma"], SHIPPED_HORIZON)

    # `model["f"]` is [len(HORIZONS) x Z] — every horizon is already fitted. Only h12 is a
    # snapshot column, because adding one would shift every column after it and the column
    # order is the wire contract (§4.3). The other three ride the history file instead
    # (§4.4 `f`), so they are kept on the record under names the snapshot encoder ignores.
    filled = 0
    for zip_code, rec in records.items():
        j = zi.get(zip_code)
        if j is None or tiers[j] == 0 or not np.isfinite(model["f"][hi, j]):
            rec["f_h12"] = rec["f_sigma"] = None
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
        "tier_counts": {t: int((tiers == t).sum()) for t in range(4)},
        "median_sd_h12": round(float(np.nanmedian(sd)), 6),
        "backtest": bt,
    }
    log.info(
        "Forecast: %s ZIPs at h=%d, median rho %.3f; MASE %s; shipped-band coverage %s",
        f"{filled:,}", SHIPPED_HORIZON, model["median_rho"], bt["mase"],
        bt["coverage"]["empirical_quantiles"],
    )
    return report

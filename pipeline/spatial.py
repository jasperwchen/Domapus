"""Local Moran's I over the rankable set: which ZIPs break their neighbourhood's price pattern.

Hand-written numpy + KD-tree; KNN weights because ZCTA islands have no contiguity neighbours.

Gated to rel >= 1: ungated, the outlier classes were a low-sample detector (79.7% of "price
islands" had < 10 sales). Gating rebuilds the weights, so no ungated figure carries over.

Inference is conditional permutation only (KNN weights are asymmetric, so no analytical
z-score), screened with BH FDR. Bonferroni at ~9,500 ZIPs needs ~190,000 permutations.
"""

import logging

import numpy as np
from scipy.spatial import cKDTree

from . import noise
from .contracts import PipelineError

log = logging.getLogger(__name__)

K_SHIPPED = 8
K_REPORTED = (4, 8, 16, 32)   # global I is k-dependent; quoting one number is meaningless
NPERM = 999
FDR_Q = 0.05
EARTH_R = 6371.0

# 0 = not significant. The four signed classes are the standard quadrants.
CLASS_NAMES = {0: "ns", 1: "HH", 2: "LL", 3: "LH", 4: "HL"}


def _project(lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
    """Equirectangular km around the mean latitude; adequate for a KNN graph."""
    lat0 = np.deg2rad(np.nanmean(lat))
    return np.c_[EARTH_R * np.deg2rad(lon) * np.cos(lat0), EARTH_R * np.deg2rad(lat)]


def benjamini_hochberg(p: np.ndarray, q: float) -> np.ndarray:
    """Step-up FDR. Valid under positive regression dependency — an ASSUMPTION
    under spatial dependence, not a fact, and one the methodology page states."""
    n = p.size
    order = np.argsort(p)
    ranked = p[order]
    thresh = q * np.arange(1, n + 1) / n
    passed = np.where(ranked <= thresh)[0]
    out = np.zeros(n, dtype=bool)
    if passed.size:
        out[order[: passed[-1] + 1]] = True
    return out


def local_moran(v: np.ndarray, nb: np.ndarray, nperm: int = NPERM, q: float = FDR_Q,
                seed: int = 0) -> dict:
    """v: [Z] values ALREADY filtered to eligible ZIPs; nb: [Z x k] neighbour indices, self excluded."""
    k = nb.shape[1]
    z = (v - v.mean()) / v.std(ddof=0)
    lag = z[nb].mean(1)                                # row-standardised, w_ij = 1/k
    Ii = z * lag

    # Conditional permutation: resample neighbours from the other n-1 points, holding self fixed.
    rng = np.random.default_rng(seed)
    n = z.size
    ge = np.zeros(n, dtype=np.int32)
    idx = np.arange(n)[:, None]
    for _ in range(nperm):
        samp = rng.integers(0, n - 1, size=(n, k))
        samp += (samp >= idx)
        ge += np.abs(z * z[samp].mean(1)) >= np.abs(Ii)

    p = (ge + 1) / (nperm + 1)
    sig = benjamini_hochberg(p, q)
    cls = np.where(
        sig,
        np.where(z > 0, np.where(lag > 0, 1, 4), np.where(lag > 0, 3, 2)),
        0,
    ).astype(np.int8)
    return {"I": Ii, "p": p, "cls": cls, "global_I": float((z * lag).mean())}


def run(records: dict, previous: dict | None = None) -> dict:
    """Write `lisa` into `records`. `previous` ({zip: class}) holds a ZIP's significant class
    for one release when it drops to ns, so borderline ZIPs do not flicker monthly."""
    eligible = [
        (z, r) for z, r in records.items()
        if noise.rankable(r) and r.get("median_sale_price") and r.get("lat") is not None
        and r.get("lng") is not None
    ]
    if len(eligible) <= max(K_REPORTED):
        raise PipelineError(
            f"spatial: only {len(eligible)} rankable ZIPs with a price and a "
            f"location; cannot build a k = {max(K_REPORTED)} graph"
        )

    zips = [z for z, _ in eligible]
    v = np.log(np.array([r["median_sale_price"] for _, r in eligible], dtype=float))
    lon = np.array([r["lng"] for _, r in eligible], dtype=float)
    lat = np.array([r["lat"] for _, r in eligible], dtype=float)

    # One KNN query at the widest k serves the shipped graph, every reported k and
    # the 8th-neighbour distance. Column 0 is the point itself.
    pts = _project(lon, lat)
    dist, idx = cKDTree(pts).query(pts, k=max(K_REPORTED) + 1)

    result = local_moran(v, idx[:, 1:K_SHIPPED + 1])
    cls = result["cls"]

    flips_held = 0
    if previous:
        for i, zip_code in enumerate(zips):
            was = previous.get(zip_code)
            if was is not None and was != cls[i] and was != 0 and cls[i] == 0:
                # It was significant and is now not. Hold one release.
                cls[i] = was
                flips_held += 1

    for rec in records.values():
        rec["lisa"] = None
    counts = dict.fromkeys(CLASS_NAMES.values(), 0)
    for i, zip_code in enumerate(zips):
        records[zip_code]["lisa"] = int(cls[i])
        counts[CLASS_NAMES[int(cls[i])]] += 1

    # Median sales per class: shows whether outliers are still a low-sample effect.
    median_n = {}
    for code, name in CLASS_NAMES.items():
        ns = [records[z]["homes_sold"] for i, z in enumerate(zips)
              if cls[i] == code and records[z].get("homes_sold")]
        median_n[name] = int(np.median(ns)) if ns else None

    # k-dependence, reported in full because "I = 0.66" without the weights is
    # meaningless.
    z = (v - v.mean()) / v.std(ddof=0)
    moran = {str(k): round(float((z * z[idx[:, 1:k + 1]].mean(1)).mean()), 4) for k in K_REPORTED}

    d8 = dist[:, K_SHIPPED]

    bonferroni = FDR_Q / len(zips)
    report = {
        "gated": True,
        "gate": "rel >= 1 (rse < 10%)",
        "n": len(zips),
        "k_shipped": K_SHIPPED,
        "permutations": NPERM,
        "fdr_q": FDR_Q,
        "moran_I_by_k": moran,
        "class_counts": counts,
        "lisa_median_n_by_class": median_n,
        "bh_significant": int((cls != 0).sum()),
        "raw_p_below_05": int((result["p"] < 0.05).sum()),
        "hysteresis_held": flips_held,
        "median_8th_neighbour_km": round(float(np.median(d8)), 2),
        "bonferroni_threshold": bonferroni,
        "bonferroni_attainable": bonferroni >= 1.0 / (NPERM + 1),
        "permutations_for_bonferroni": int(np.ceil(1.0 / bonferroni)) - 1,
    }
    log.info(
        "LISA (gated, n = %s): I@k8 = %s, %s significant after BH; classes %s; "
        "median 8th-neighbour %.1f km",
        f"{len(zips):,}", moran["8"], f"{report['bh_significant']:,}", counts,
        report["median_8th_neighbour_km"],
    )
    return report

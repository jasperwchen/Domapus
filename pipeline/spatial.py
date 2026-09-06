"""Local Moran's I — where prices cluster, and where a ZIP disagrees with its neighbours.

~40 lines of numpy plus a KD-tree. `libpysal` and `esda` are deliberately refused:
not because of wheels (they are pure Python and install fine) but because this is
more explainable hand-written, and because KNN weights are the right choice on
their own merits — ZCTA islands and disjoint parts produce zero-neighbour units
for which contiguity-based Moran's I is undefined.

**THE GATE IS THE POINT OF THIS MODULE.** Run ungated, the spatial-outlier classes
are a low-sample detector wearing a spatial-statistics costume. Measured on the
ungated set: median `homes_sold` by class was HH 38, ns 22, LL 5, LH 6, HL 2, and
79.7% of the 133 "price islands" had fewer than ten sales. That is not a discovery,
it is sampling noise pushing a thin ZIP away from its neighbourhood mean — which is
the definition of an HL/LH outlier. An earlier draft justified shipping LISA
*because* the outliers were rare; they were rare because they were noise.

So LISA is computed only over the rankable set, and every published figure is
recomputed there. Gating does not merely drop rows, it REBUILDS THE WEIGHTS: the 8
nearest neighbours among ~9,500 rankable ZIPs are much further apart than the 8
nearest among ~25,000, so no ungated figure carries over. Nothing in this file
reports a number computed on the ungated set.

**Inference is permutation-only.** KNN weights are asymmetric, which invalidates
the closed-form variance of Moran's I, so an analytical z-score must never be
quoted. And the honest framing is descriptive clustering with a permutation-based
screen, not a hypothesis test: conditional permutation tests each location against
complete spatial randomness, a null that a global I of 0.66 has already rejected
everywhere.

**Bonferroni is not conservative here, it is unattainable.** At ~9,500 ZIPs the
threshold is 5.3e-6 while the smallest pseudo-p reachable with 999 permutations is
1e-3; attaining it would need ~190,000 permutations. That arithmetic is *why* FDR,
it is recorded in the manifest, and the site says it out loud.
"""

import logging

import numpy as np
from scipy.spatial import cKDTree

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
    """Equirectangular km around the sample's own mean latitude.

    Good enough for a nearest-neighbour graph over the contiguous US and honest
    about being an approximation. A global projection would be worse here: the
    dataset crosses the antimeridian if territories are included, so any
    mean-centroid computation over all features is garbage — the territory filter
    upstream is what makes this safe.
    """
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


def local_moran(v: np.ndarray, lon: np.ndarray, lat: np.ndarray,
                k: int = K_SHIPPED, nperm: int = NPERM, q: float = FDR_Q,
                seed: int = 0) -> dict:
    """v: [Z] values, ALREADY filtered to eligible ZIPs."""
    if v.size <= k:
        raise PipelineError(f"spatial: {v.size} ZIPs cannot support k = {k} neighbours")

    pts = _project(lon, lat)
    nb = cKDTree(pts).query(pts, k=k + 1)[1][:, 1:]   # self excluded
    z = (v - v.mean()) / v.std(ddof=0)
    lag = z[nb].mean(1)                                # row-standardised, w_ij = 1/k
    Ii = z * lag

    # Conditional permutation: for each location, resample its NEIGHBOURS from
    # everywhere else, holding its own value fixed. Sampling from n-1 and shifting
    # past self is what excludes self without a rejection loop.
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
    return {"I": Ii, "p": p, "cls": cls, "global_I": float((z * lag).mean()),
            "neighbours": nb, "points": pts}


def global_moran(v: np.ndarray, lon: np.ndarray, lat: np.ndarray, k: int) -> float:
    pts = _project(lon, lat)
    nb = cKDTree(pts).query(pts, k=k + 1)[1][:, 1:]
    z = (v - v.mean()) / v.std(ddof=0)
    return float((z * z[nb].mean(1)).mean())


def run(records: dict, previous: dict | None = None) -> dict:
    """Compute LISA over the rankable set and write `lisa` into `records`.

    `previous` is the last release's `{zip: class}`, for hysteresis: a ZIP must
    clear the threshold two consecutive months to CHANGE class. Without it,
    borderline ZIPs flicker every month and the diff gate sees churn that is not a
    data problem.
    """
    eligible = [
        (z, r) for z, r in records.items()
        if r.get("rel") is not None and r["rel"] >= 1
        and r.get("median_sale_price") and r.get("lat") is not None
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

    result = local_moran(v, lon, lat)
    cls = result["cls"]

    # Hysteresis, applied after classing so the published class is the stable one.
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

    # The cross-tab that killed the ungated version. If the outlier classes are
    # still a low-sample detector after gating, this is where it shows.
    median_n = {}
    for code, name in CLASS_NAMES.items():
        ns = [records[z]["homes_sold"] for i, z in enumerate(zips)
              if cls[i] == code and records[z].get("homes_sold")]
        median_n[name] = int(np.median(ns)) if ns else None

    # k-dependence, reported in full because "I = 0.66" without the weights is
    # meaningless.
    moran = {str(k): round(global_moran(v, lon, lat, k), 4) for k in K_REPORTED}

    pts = result["points"]
    d8 = cKDTree(pts).query(pts, k=K_SHIPPED + 1)[0][:, -1]

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
        # Recorded so the site can state the arithmetic rather than assert FDR.
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

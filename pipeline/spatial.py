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
    """Points on a sphere of radius EARTH_R. Chord distance orders neighbours exactly as
    great-circle distance does; a flat projection centred near 38N stretched east-west
    distance ~1.6x in Alaska and shrank it ~0.87x in Florida."""
    lo, la = np.deg2rad(lon), np.deg2rad(lat)
    return EARTH_R * np.c_[np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)]


def _chord_to_km(chord: np.ndarray) -> np.ndarray:
    return 2.0 * EARTH_R * np.arcsin(np.clip(chord / (2.0 * EARTH_R), 0.0, 1.0))


def _draw_distinct(rng: np.random.Generator, n: int, k: int) -> np.ndarray:
    """[n x k] indices into 0..n-1, each row k distinct values none equal to its own row."""
    idx = np.arange(n)[:, None]
    samp = rng.integers(0, n - 1, size=(n, k))
    samp += samp >= idx
    while True:
        s = np.sort(samp, axis=1)
        dup = (s[:, 1:] == s[:, :-1]).any(axis=1)
        if not dup.any():
            return samp
        redo = rng.integers(0, n - 1, size=(int(dup.sum()), k))
        redo += redo >= idx[dup]
        samp[dup] = redo


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

    # Conditional permutation: k distinct neighbours from the other n-1 points, self held fixed.
    rng = np.random.default_rng(seed)
    n = z.size
    ge = np.zeros(n, dtype=np.int32)
    for _ in range(nperm):
        samp = _draw_distinct(rng, n, k)
        ge += np.abs(z * z[samp].mean(1)) >= np.abs(Ii)

    p = (ge + 1) / (nperm + 1)
    sig = benjamini_hochberg(p, q)
    cls = np.where(
        sig,
        np.where(z > 0, np.where(lag > 0, 1, 4), np.where(lag > 0, 3, 2)),
        0,
    ).astype(np.int8)
    return {"I": Ii, "p": p, "cls": cls, "global_I": float((z * lag).mean())}


def _apply_hysteresis(cls: np.ndarray, zips: list[str], previous: dict | None,
                      previously_held: set[str] | None) -> tuple[np.ndarray, list[str]]:
    """Hold a ZIP's significant class for ONE release when it drops to ns, then let it go.

    The published `lisa` column cannot tell a real class from a held one — both are the same
    integer — so the rule needs `previously_held`, last release's held set, read back from
    `manifest.spatial.held`. A ZIP already held is not eligible to be held again; without
    that second input the hold republishes itself as `previous` every month and a ZIP that
    stopped being an outlier is drawn as one forever.

    `previously_held is None` means the published manifest predates the key, so which ZIPs
    were held is unknown. Hold nothing that run rather than assume nothing was held: the
    cost is one release of undamped flicker, once, against holding the unknown set forever.
    """
    if not previous or previously_held is None:
        return cls, []
    held = []
    for i, zip_code in enumerate(zips):
        was = previous.get(zip_code)
        if was and cls[i] == 0 and zip_code not in previously_held:
            cls[i] = was
            held.append(zip_code)
    return cls, held


def hysteresis_inputs(live_lisa: dict, live_held: list[str] | None,
                      live_period: str | None, period: str) -> tuple[dict, set[str] | None]:
    """`previous` and `previously_held` for this run, read off the live release.

    A rebuild of the period that is already live (a `force_rebuild` shipping a pipeline fix)
    must not treat that release as last month: it would release every hold it made, and the
    digest would change with no change in the data. Instead it re-applies exactly the holds
    the live release made, with the classes it held them at. Over unchanged input that
    reproduces the live `lisa` column and held set; a ZIP the fix makes significant again
    is simply not held."""
    if live_period == period:
        if live_held is None:
            return {}, None
        return {z: live_lisa[z] for z in live_held if live_lisa.get(z)}, set()
    return live_lisa, set(live_held) if live_held is not None else None


def run(records: dict, previous: dict | None = None,
        previously_held: set[str] | None = None) -> dict:
    """Write `lisa` into `records`. `previous` ({zip: class}) is last release's published
    class and `previously_held` the ZIPs it was holding; see `_apply_hysteresis`."""
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
    cls, held = _apply_hysteresis(result["cls"], zips, previous, previously_held)

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

    d8 = _chord_to_km(dist[:, K_SHIPPED])

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
        "hysteresis_held": len(held),
        # Next release reads this back: a ZIP held once is not eligible to be held again.
        "held": sorted(held),
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

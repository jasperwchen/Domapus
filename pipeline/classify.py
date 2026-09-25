"""Class breaks for the painted metrics, computed once so the map, legend and export agree.

- 14 classes. The ceiling is measured by `scripts/palette/derive_ramp.mjs` (separable
  span under simulated colour blindness), not chosen.
- One scheme per metric family: log-equal p1..p99 for prices (log-normal, ratio
  meaning), quantile for counts and rank-like series.
- Anchored at p1/p99 so a single extreme sale cannot stretch the scale; outliers clamp
  to the end classes. Recomputed each release; every release's breaks stay in the manifest.
- Estimates are cut on the rankable set only (rse < 10%); exact counts on every
  reporting ZIP. Every ZIP with a value is classed either way.
"""

import logging

import numpy as np

from . import noise
from .contracts import PipelineError

log = logging.getLogger(__name__)

CLASSES = 14
EDGES = CLASSES - 1  # 13 boundary values

# `breaks` covers exactly these; an unpainted column with breaks implies a legend that does not exist.
PAINTED = (
    "zhvi", "median_sale_price", "median_ppsf", "homes_sold",
    "active_listings", "median_dom", "sold_above_list", "months_of_supply",
)

# `active_listings`, `median_dom` and `months_of_supply` are right-skewed with no natural
# anchor, so they join the quantile family.
SCHEMES = {
    "zhvi": "log_equal_p1_p99",
    "median_sale_price": "log_equal_p1_p99",
    "median_ppsf": "log_equal_p1_p99",

    "homes_sold": "quantile",
    "active_listings": "quantile",
    "median_dom": "quantile",
    "months_of_supply": "quantile",

    # A share bounded at [0, 100]. A 100-anchored grid never reached the data (2026-07:
    # 65.6% of ZIPs in one class). 29.3% report exactly 0.0, which no scheme can split.
    "sold_above_list": "equal_interval_0_100",
}

# Who votes on where the cuts go (everyone with a value is still classed).
#
# The rankable gate exists for sampling error, so it applies only to estimates. Counts are
# measured exactly, and the gate (`rel >= 1`) is itself a function of sales volume, so
# gating a count kept only high-volume ZIPs and pushed the rest into the bottom class
# (2026-07, 7 classes: homes_sold 68%, active_listings 70%, sold_above_list 74% in class 0,
# against 13-21% for prices). `months_of_supply` and `sold_above_list` stay gated because
# they derive from the sale count.
COUNT_METRICS = frozenset({
    "homes_sold", "active_listings", "pending_sales", "new_listings", "inventory",
})


def break_population(metric: str, records: dict, rankable: list) -> list:
    """The ZIPs whose values may set `metric`'s class boundaries."""
    if metric in COUNT_METRICS:
        return [r for r in records.values() if r.get(metric) is not None]
    return rankable


def _quantile_breaks(v: np.ndarray) -> list[float]:
    """`EDGES` equally spaced quantiles. Ties collapse classes; that is real."""
    return [float(np.percentile(v, 100.0 * (i + 1) / CLASSES)) for i in range(EDGES)]


def _log_equal_breaks(v: np.ndarray) -> list[float]:
    """Equal intervals on log10 between the p1 and p99 anchors."""
    pos = v[v > 0]
    if pos.size == 0:
        raise PipelineError("classify: log scheme needs positive values")
    lo, hi = np.log10(np.percentile(pos, 1)), np.log10(np.percentile(pos, 99))
    if not hi > lo:
        raise PipelineError(f"classify: degenerate log anchors p1={lo} p99={hi}")
    step = (hi - lo) / CLASSES
    return [float(10 ** (lo + step * (i + 1))) for i in range(EDGES)]


def _equal_interval_0_100_breaks() -> list[float]:
    """Equal intervals over [0, 100]. Reads no sample, so the rankable gate cannot bias it."""
    return [round(100.0 * (i + 1) / CLASSES, 4) for i in range(EDGES)]


def class_of(value, breaks) -> int:
    """0..CLASSES-1. Values past either anchor clamp to the end class."""
    k = 0
    while k < len(breaks) and value >= breaks[k]:
        k += 1
    return k


def compute(records: dict) -> dict:
    """Breaks and class counts for the painted columns.

    Counts are taken over every ZIP with a value, breaks over `break_population`; the
    sum assertion below catches the two drifting apart (once a 398-ZIP shortfall).
    """
    rankable = [r for r in records.values() if noise.rankable(r)]
    if not rankable:
        raise PipelineError(
            "classify: no rankable ZIPs. `noise.measure()` must run before this — "
            "`rel` is what gates the break population."
        )

    breaks: dict[str, list[float]] = {}
    classing: dict[str, dict] = {}

    for metric in PAINTED:
        scheme = SCHEMES[metric]

        population = break_population(metric, records, rankable)
        sample = np.array(
            [r[metric] for r in population if r.get(metric) is not None], dtype=float
        )
        if sample.size < CLASSES:
            raise PipelineError(
                f"classify: {metric} has only {sample.size} value(s) in its break "
                f"population; cannot cut {CLASSES} classes"
            )
        if scheme == "quantile":
            edges = _quantile_breaks(sample)
        elif scheme == "log_equal_p1_p99":
            edges = _log_equal_breaks(sample)
        elif scheme == "equal_interval_0_100":
            edges = _equal_interval_0_100_breaks()
        else:
            raise PipelineError(f"classify: unknown scheme {scheme!r} for {metric}")
        break_n = int(sample.size)

        edges = [round(e, 4) for e in edges]
        if len(edges) != EDGES:
            raise PipelineError(f"classify: {metric} produced {len(edges)} edges, expected {EDGES}")
        # Quantile edges may tie: when more than 1/14 of ZIPs share one sale count, two
        # quantiles land on it and the class between them is empty, which the legend draws.
        # `homes_sold` ties in every December-May period. Every other scheme stays strict.
        if scheme == "quantile":
            bad = any(edges[i] > edges[i + 1] for i in range(EDGES - 1)) or edges[0] == edges[-1]
        else:
            bad = any(edges[i] >= edges[i + 1] for i in range(EDGES - 1))
        if bad:
            raise PipelineError(
                f"classify: {metric} breaks are out of order or all equal: {edges}. "
                f"The distribution is too degenerate for {CLASSES} classes."
            )

        values = np.array([r[metric] for r in records.values() if r.get(metric) is not None],
                          dtype=float)
        classes = np.searchsorted(edges, values, side="right")
        counts = np.bincount(classes, minlength=CLASSES).tolist()
        classed = int(values.size)

        if sum(counts) != classed:
            raise PipelineError(
                f"classify: {metric} class counts sum to {sum(counts):,} but "
                f"{classed:,} ZIPs carry a non-null value. Clamping cannot drop a "
                f"ZIP, so the counts and the values were taken over different sets."
            )

        breaks[metric] = edges
        classing[metric] = {
            "scheme": scheme,
            "classes": CLASSES,
            "breaks": edges,
            "class_counts": counts,
            "non_null": classed,
            "break_population": break_n,
            "break_gate": None if scheme == "equal_interval_0_100"
                          else ("all_reporting" if metric in COUNT_METRICS else "rankable"),
            "bottom_class_share": round(counts[0] / classed, 4) if classed else None,
            "clamped_low": int((values < edges[0]).sum()),
            "clamped_high": int((values >= edges[-1]).sum()),
        }

    _log_selection_effect(records, classing)
    gated = [m for m in PAINTED if m not in COUNT_METRICS]
    log.info(
        "Classing: %d painted columns, %d classes. Breaks from %s rankable ZIPs for "
        "%d estimated columns; from every reporting ZIP for %d exact counts.",
        len(PAINTED), CLASSES, f"{len(rankable):,}", len(gated),
        len([m for m in PAINTED if m in COUNT_METRICS]),
    )
    return {"classes": CLASSES, "breaks": breaks, "classing": classing,
            "break_population": len(rankable)}


def _log_selection_effect(records: dict, classing: dict) -> None:
    """Record how much the rankable gate paints thin (cheaper, rural) ZIPs colder."""
    inc, exc = [], []
    for r in records.values():
        if r.get("median_sale_price") is not None:
            (inc if noise.rankable(r) else exc).append(r["median_sale_price"])
    if not inc or not exc:
        return
    edges = classing["median_sale_price"]["breaks"]
    bottom_inc = sum(1 for v in inc if class_of(v, edges) == 0) / len(inc)
    bottom_exc = sum(1 for v in exc if class_of(v, edges) == 0) / len(exc)
    classing["median_sale_price"]["selection_effect"] = {
        "median_price_rankable": float(np.median(inc)),
        "median_price_excluded": float(np.median(exc)),
        "bottom_class_share_rankable": round(bottom_inc, 4),
        "bottom_class_share_excluded": round(bottom_exc, 4),
    }


def assign(records: dict, breaks: dict) -> None:
    """Write `class_<metric>` for the paint encoder. Not shipped in the snapshot: derivable from value + breaks."""
    recs = list(records.values())
    for metric, edges in breaks.items():
        key = f"class_{metric}"
        present = [r for r in recs if r.get(metric) is not None]
        classes = np.searchsorted(edges, [r[metric] for r in present], side="right")
        for r in recs:
            r[key] = None
        for r, k in zip(present, classes.tolist()):
            r[key] = k

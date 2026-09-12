"""Which colour class each ZIP falls in, and where the boundaries are.

The pipeline computes the breaks and ships them. Today the on-screen legend, the
export legend and the map each compute their own, from different samples, so they
can disagree — and they do. Computing them once here makes them agree by
construction rather than by luck.

Three decisions carry the section.

**14 classes, and the number is derived rather than chosen.** It was 7, on the rule
that sequential ramps support 5-9 steps before adjacent swatches stop being
distinguishable. That rule is about reading a legend swatch by swatch; the map is
read as a gradient, and at 7 classes one class spanned a factor of 1.49 in price,
so two ZIPs $190k apart at the $400k mark painted identically.

The real ceiling is the ramp's arc length under simulated colour blindness — about
84 dE76, bounded by the usable L* range, because tritanopia collapses the
yellow-blue axis the ramp's chroma lives on. `derive_ramp.mjs` measures the
SEPARABLE SPAN (how many classes apart two ZIPs must be before every reader can
tell them apart) and rejects any count whose span/classes ratio is worse than the
14.3% of range the 7-class ramp gave. 14 is the largest count that passes: a
colour-blind reader still resolves 7 bands, normal vision resolves 14. 15 needs a
3-class span and fails.

**One scheme per metric FAMILY, not one scheme for everything.** Universal
quantile classing makes every map look equally hot regardless of the real
distribution. Prices are approximately log-normal, so equal intervals on log10
preserve the ratio meaning ("each class is 1.4x the last"). Counts are
zero-inflated and rank is the meaningful thing, so quantile. Signed change data
gets a diverging scale symmetric about zero — painting signed data on a
sequential ramp is a correctness bug, not a taste question.

**Anchored, and recomputed every release.** 7 log-equal classes over the observed
min..max put 95% of ZIPs in two colours, because one $1,500 sale and one $22M
sale set the whole scale. Anchoring at p1..p99 fixes that; values outside the
anchors clamp to the end classes so no ZIP is dropped. Recomputing rather than
freezing was argued the other way first — a frozen scale keeps colours comparable
across months — but nobody compares two releases by colour, they compare by
value, and a frozen scale slowly stops describing the data it paints. Cross-
release comparison is served by keeping every release's breaks in the manifest.

**The rankable gate applies to ESTIMATES, not to counts.** Breaks for a sample
statistic are computed over the rankable set only (spec section 6.2's rse < 10%),
so that a 1-sale ZIP showing $1,500 cannot move the national colour scale for
everyone else. Counts are exempt, and that exemption is a correction — see
`BREAK_POPULATION` below. Every ZIP with a value is CLASSED either way.
"""

import logging
import math

import numpy as np

from .contracts import PipelineError

log = logging.getLogger(__name__)

CLASSES = 14
EDGES = CLASSES - 1  # 13 boundary values

# The 9 painted columns: 8 map-selectable metrics + the one painted change series.
# `breaks` has an entry for each of these and for NOTHING else — an unpainted
# column with breaks would imply a legend that does not exist.
PAINTED = (
    "zhvi", "median_sale_price", "median_ppsf", "homes_sold",
    "active_listings", "median_dom", "sold_above_list", "months_of_supply",
    "zhvi_yoy",
)

# Scheme per family. Spec section 6.6's table names four families but assigns
# only twelve metrics; `active_listings`, `median_dom` and `months_of_supply` are
# painted and appear in none of them. All three are right-skewed positives with
# no meaningful anchor value the way 100% is for a share, and for all three rank
# is what a reader actually compares ("is this ZIP slow or fast relative to the
# rest"), so they join the quantile family. Recorded here rather than in a commit
# message because it is a judgement the spec did not make.
SCHEMES = {
    "zhvi": "log_equal_p1_p99",
    "median_sale_price": "log_equal_p1_p99",
    "median_list_price": "log_equal_p1_p99",
    "median_ppsf": "log_equal_p1_p99",

    "homes_sold": "quantile",
    "pending_sales": "quantile",
    "new_listings": "quantile",
    "inventory": "quantile",
    "active_listings": "quantile",
    "median_dom": "quantile",
    "months_of_supply": "quantile",

    # 100% is a PIVOT for the sale-to-list ratio — it is the price the seller
    # asked — and the series straddles it, so anchoring the grid there is right.
    "avg_sale_to_list_ratio": "equal_anchored_100",

    # These two are SHARES OF SALES, bounded [0, 100], and 100% is the top of the
    # domain rather than a pivot. Anchoring their grid at 100 and walking down
    # meant the grid never reached the data: measured on the 2026-07 release,
    # `sold_above_list` has a national median of 16.7% and a p25 of 0.0, while the
    # lowest edge landed at 33.6%, so 65.6% of ZIPs and 96.9% of the drawn area
    # painted as one colour. Equal intervals over the real domain puts 33.0% in
    # the bottom class, and 29.3% of ZIPs report EXACTLY 0.0 — no scheme can split
    # those, so that floor is the data rather than the classing.
    "sold_above_list": "equal_interval_0_100",
    "off_market_in_two_weeks": "equal_interval_0_100",

    "zhvi_yoy": "diverging",
}

# Which ZIPs may SET the boundaries, per scheme. Every ZIP with a value is
# classed regardless; this is only about who votes on where the cuts go.
#
# THE GATE EXISTS FOR SAMPLING ERROR, SO IT APPLIES ONLY WHERE THERE IS SAMPLING
# ERROR. A median over four sales is an estimate and a noisy one, so letting it
# set a national boundary is letting noise move everyone else's colour. That is
# the whole argument for the gate, and it is sound for `median_sale_price`,
# `median_ppsf`, `median_dom` and the share metrics.
#
# It is NOT sound for a count. `homes_sold` is not estimated from a sample — it is
# how many homes sold, measured exactly, with no standard error to gate on. And
# the gate is `rel >= 1`, which is a cut on the relative standard error of the
# median sale price, which is K / sqrt(n) in the number of sales. So gating a
# count's break population on it means: to decide the boundaries for "how many
# homes sold here", look only at the ZIPs where a lot of homes sold. The ZIPs
# filtered out then land in the bottom class by construction.
#
# MEASURED on the 2026-07 release under the old single-population rule, share of
# ZIPs falling in the lowest of seven classes:
#
#   sold_above_list  74%   active_listings 70%   homes_sold 68%
#   median_ppsf      21%   median_sale_price 18%   zhvi 14%
#   median_dom       15%   months_of_supply 13%
#
# The three at the top are the three whose breaks were cut on a population
# selected by the very quantity being classed. The price and time metrics, which
# are only correlated with it, sit at 13-21%. That gap is the bug.
#
# `months_of_supply` is deliberately gated: it is inventory over the sales RATE,
# so it does derive from a count of sales and inherits their noise. `sold_above_list`
# is gated for the same reason — it is a share OF the sales, so a ZIP with four
# sales reports 0%, 25%, 50%, 75% or 100% and nothing between.
COUNT_METRICS = frozenset({
    "homes_sold", "active_listings", "pending_sales", "new_listings", "inventory",
})


def break_population(metric: str, records: dict, rankable: list) -> list:
    """The ZIPs whose values may set `metric`'s class boundaries."""
    if metric in COUNT_METRICS:
        return [r for r in records.values() if r.get(metric) is not None]
    return rankable


# The diverging bound, in percent. DERIVED, not chosen:
#
#   B = the smallest multiple of 5 percentage points not less than the p95 of
#       |yoy|, pooled over the whole panel of every metric painted on a
#       diverging scale.
#
# p95 targets ~5% saturation — the same order as the p1/p99 anchors used for the
# sequential ramps — and rounding to 5 pp buys a legend a human can read.
# Measured on the full ZHVI panel, 6,137,683 finite lag-12 cells [M]: pooled
# |zhvi_yoy| p95 = 18.85%, p97.5 = 22.72%, share above 20% = 4.07%. The p95 is
# stable across start windows (2000+ 18.85 · 2012+ 18.02 · 2016+ 18.60) and every
# one rounds to 20. `derive_diverging_bound()` reproduces this each release.
#
# `zhvi_yoy` is the ONLY painted YoY, and that is the reason this bound is what it
# is. Redfin's ZIP-level median-price YoY exceeds +-25% for 29-41% of ZIPs in
# every year measured — a diverging map of it is a saturated noise field — but it
# is detail-panel only, so it never had a clamp to be too tight for. On the series
# that IS painted the old +-25% was too LOOSE. The two series must never share a
# class scale: ZHVI is smoothed and seasonally adjusted, Redfin's is a raw NSA
# transaction median over ~14 sales, and their dispersions differ by an order of
# magnitude.
DIVERGING_BOUND = 20.0
DIVERGING_ROUNDING = 5.0
DIVERGING_TARGET_PCTILE = 95.0

# Unlike the sequential ramps, this one is FIXED rather than recomputed, and for
# the opposite reason. Prices drift slowly in one direction so a recomputed scale
# always fits them. YoY *swings* — p99 of +40% in a boom and +3% in a flat year —
# so a recomputed YoY scale renders both years equally dramatic and erases the
# regime difference that is the entire point of showing YoY. A clamped fixed scale
# is not stale, because the clamp is stated: the end swatch reads ">= +20%", which
# is true in every regime.
DIVERGING_RECOMPUTED = False


def derive_diverging_bound(yoy_values: np.ndarray) -> dict:
    """B from the pooled |yoy| p95, rounded up to the next multiple of 5 pp."""
    a = np.abs(yoy_values[np.isfinite(yoy_values)])
    if a.size == 0:
        raise PipelineError("classify: no finite YoY values to derive the diverging bound from")
    p95 = float(np.percentile(a, DIVERGING_TARGET_PCTILE))
    b = float(math.ceil(p95 / DIVERGING_ROUNDING) * DIVERGING_ROUNDING)
    return {
        "bound": b,
        "p95": round(p95, 2),
        "cells": int(a.size),
        "share_clamped": round(float((a > b).mean()), 4),
    }


def _quantile_breaks(v: np.ndarray) -> list[float]:
    """Six equally-spaced quantiles. Ties collapse classes; that is real."""
    return [float(np.percentile(v, 100.0 * (i + 1) / CLASSES)) for i in range(EDGES)]


def _log_equal_breaks(v: np.ndarray) -> list[float]:
    """Equal intervals on log10 between the p1 and p99 anchors.

    Ratio-preserving: with p1..p99 spanning roughly 16x, each class is about 1.22x
    the last. At 7 classes it was 1.49x, which is why two ZIPs $190k apart at the
    $400k mark used to paint identically.
    """
    pos = v[v > 0]
    if pos.size == 0:
        raise PipelineError("classify: log scheme needs positive values")
    lo, hi = np.log10(np.percentile(pos, 1)), np.log10(np.percentile(pos, 99))
    if not hi > lo:
        raise PipelineError(f"classify: degenerate log anchors p1={lo} p99={hi}")
    step = (hi - lo) / CLASSES
    return [float(10 ** (lo + step * (i + 1))) for i in range(EDGES)]


def _equal_anchored_100_breaks(v: np.ndarray) -> list[float]:
    """Equal-width classes whose grid is pinned to 100%, for series that PIVOT there.

    The width comes from the p1..p99 span, the same anchoring the sequential ramps
    use, and the edges are laid down at 100 - k*width. This is right for the
    average sale-to-list ratio, where 100% is the price the seller asked and the
    series straddles it in both directions.

    IT IS WRONG FOR A SHARE BOUNDED AT 100, and that was the shipped bug. A share
    of sales does not straddle 100%, it approaches it from below, so a grid pinned
    at the top and walked down by `EDGES` steps of a width taken from the rankable
    spread never reaches the data. Measured on the 2026-07 release,
    `sold_above_list` had a national median of 16.7% and a lowest edge of 33.6%:
    65.6% of ZIPs in one colour. Those series use `_equal_interval_0_100_breaks`.
    """
    lo, hi = float(np.percentile(v, 1)), float(np.percentile(v, 99))
    width = (hi - lo) / CLASSES
    if width <= 0:
        raise PipelineError(f"classify: degenerate anchors p1={lo} p99={hi}")
    return [round(100.0 - width * k, 4) for k in range(EDGES, 0, -1)]


def _equal_interval_0_100_breaks() -> list[float]:
    """Equal intervals over the definitional [0, 100] domain. Takes no sample.

    For a share of sales, which cannot leave [0, 100] and whose meaningful
    reference points — none, a quarter, half, all — are absolute rather than
    relative. Because it reads no data at all, the rankable gate cannot bias it
    and a thin month cannot move it, which is why `classing.break_gate` reports
    None here rather than naming a population it does not consult.
    """
    return [round(100.0 * (i + 1) / CLASSES, 4) for i in range(EDGES)]


def _diverging_breaks(bound: float) -> list[float]:
    """Edges symmetric about zero. With an EVEN class count, zero is a boundary.

    The outer two edges land ON +-bound and the gaps between them are equal, so
    the step is `2 * bound / (EDGES - 1)`. At 14 classes that is 13 edges, an odd
    number, so the middle one falls exactly on 0: at B = 20 the edges run -20
    -16.67 ... -3.33 0 +3.33 ... +20.

    That is a change of meaning from the 7-class scale and an improvement. There
    used to be a neutral class straddling zero, -4%..+4%, and on the 2026-07
    release 57% of ZIPs sat in it — the map's single largest block was the one
    that said nothing. With an edge on zero instead, every cool colour means
    decline and every warm one means growth, and the sign of a ZIP's change is
    never ambiguous. `DIVERGING_COLORS` is resampled per half to match, so no
    swatch sits on neutral either.

    THE DIVISOR IS `EDGES - 1`, NOT `EDGES`, and getting that wrong is silent.
    It shipped as `bound / (EDGES / 2 + 0.5)` = `bound / 3.5`, which put the edges
    at -20 -14.29 -8.57 -2.86 +2.86 +8.57: still six edges, still increasing,
    still passing every assertion in `compute()`, and asymmetric. The top class
    then meant ">= +8.57%" while the legend's own reasoning ("p95 of |yoy| is
    18.85, round to 20") described a +-20 scale, and 8.75% of ZIPs saturated at
    the top against 0.22% at the bottom on a scale whose entire purpose is that
    the two sides are comparable.
    """
    step = 2.0 * bound / (EDGES - 1)
    return [round(-bound + step * i, 4) for i in range(EDGES)]


def class_of(value, breaks) -> int:
    """0..CLASSES-1. Values past either anchor clamp to the end class."""
    k = 0
    while k < len(breaks) and value >= breaks[k]:
        k += 1
    return k


def compute(records: dict, diverging_bound: float = DIVERGING_BOUND) -> dict:
    """Breaks and class counts for the 9 painted columns.

    The break POPULATION is per metric — the rankable set for an estimate, every
    ZIP with a value for an exact count; see `break_population`. The CLASSED
    population is always every ZIP with a value. Those are deliberately different,
    and conflating them is what produced spec section 6.6's unexplained 398-ZIP
    shortfall: one row of counts was computed over all reporting ZIPs and the
    other over the break set, so they could not sum to the same total. The
    assertion below is what makes that class of error impossible to ship rather
    than merely unlikely.
    """
    rankable = [r for r in records.values() if r.get("rel") is not None and r["rel"] >= 1]
    if not rankable:
        raise PipelineError(
            "classify: no rankable ZIPs. `noise.measure()` must run before this — "
            "`rel` is what gates the break population."
        )

    breaks: dict[str, list[float]] = {}
    classing: dict[str, dict] = {}

    for metric in PAINTED:
        scheme = SCHEMES[metric]

        if scheme == "diverging":
            edges = _diverging_breaks(diverging_bound)
            break_n = None
            population = None
        else:
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
            elif scheme == "equal_anchored_100":
                edges = _equal_anchored_100_breaks(sample)
            elif scheme == "equal_interval_0_100":
                edges = _equal_interval_0_100_breaks()
            else:
                raise PipelineError(f"classify: unknown scheme {scheme!r} for {metric}")
            break_n = int(sample.size)

        edges = [round(e, 4) for e in edges]
        if len(edges) != EDGES:
            raise PipelineError(f"classify: {metric} produced {len(edges)} edges, expected {EDGES}")
        if any(edges[i] >= edges[i + 1] for i in range(EDGES - 1)):
            raise PipelineError(
                f"classify: {metric} breaks are not strictly increasing: {edges}. "
                f"A tie means the distribution is too degenerate for {CLASSES} classes."
            )

        counts = [0] * CLASSES
        classed = 0
        for rec in records.values():
            v = rec.get(metric)
            if v is None:
                continue
            counts[class_of(v, edges)] += 1
            classed += 1

        # THE assertion spec section 12 item 12 exists for. Clamping cannot lose a
        # ZIP, so if these disagree the two populations are not the same set.
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
            # None where the scheme consults no sample at all, so the field never
            # names a population that did not in fact set the boundaries.
            "break_gate": None if scheme in ("diverging", "equal_interval_0_100")
                          else ("all_reporting" if metric in COUNT_METRICS else "rankable"),
            "bottom_class_share": round(counts[0] / classed, 4) if classed else None,
            "clamped_low": sum(1 for r in records.values()
                               if r.get(metric) is not None and r[metric] < edges[0]),
            "clamped_high": sum(1 for r in records.values()
                                if r.get(metric) is not None and r[metric] >= edges[-1]),
        }

    _log_selection_effect(records, classing)
    gated = [m for m in PAINTED if SCHEMES[m] != "diverging" and m not in COUNT_METRICS]
    log.info(
        "Classing: %d painted columns, %d classes. Breaks from %s rankable ZIPs for "
        "%d estimated columns; from every reporting ZIP for %d exact counts.",
        len(PAINTED), CLASSES, f"{len(rankable):,}", len(gated),
        len([m for m in PAINTED if m in COUNT_METRICS]),
    )
    return {"classes": CLASSES, "breaks": breaks, "classing": classing,
            "break_population": len(rankable)}


def _log_selection_effect(records: dict, classing: dict) -> None:
    """The honesty measure has a measurable bias. Report it, do not bury it.

    Restricting breaks to the rankable set systematically paints thin and rural
    markets colder, because thin ZIPs are cheaper on average and the scale is set
    without them. The legend has to say so.
    """
    inc = [r["median_sale_price"] for r in records.values()
           if r.get("rel", 0) >= 1 and r.get("median_sale_price") is not None]
    exc = [r["median_sale_price"] for r in records.values()
           if r.get("rel", 0) < 1 and r.get("median_sale_price") is not None]
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
    """Write `class_<metric>` into each record, for the paint encoder.

    Kept out of the snapshot: the class index is derivable from the value and the
    shipped breaks, and shipping it too would create a second authority that could
    drift from the first.
    """
    for rec in records.values():
        for metric, edges in breaks.items():
            v = rec.get(metric)
            rec[f"class_{metric}"] = None if v is None else class_of(v, edges)

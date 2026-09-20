"""Year-over-year, recomputed from published levels at lag 12. No Redfin `*_YOY` is shipped.

This keeps level and change describing the same quantity, and sidesteps two upstream
defects: the months-of-supply "(%)" YoY column is really a difference x 100 (DOM's was too,
until Redfin relabelled it "(DAYS)" and dropped the x100 for the 2026-08 release), and a
percent change on a degenerate base ($1 sale -> +30,993,016%) is nulled rather than clamped.

Because the feed's own YoY columns are never published, they are read for exactly one
purpose: `_reconcile` proves our lag-12 arithmetic against upstream's. For the two
difference-family columns that also means deriving what scale upstream is on this month
rather than trusting either the header text or a constant.

Units per family:
    ratio (9)       msp mlp ppsf lppsf hs ps nl inv al   percent change
    point (3)       s2l abv om2                          percentage-point difference
    difference (2)  dom mos                              days / months
    index (1)       zhvi                                 percent change (zhvi.py)
"""

import logging

import pyarrow.dataset as ds
import pyarrow.parquet as pq

from . import panel
from .contracts import RANGES, PipelineError
from .units import DECIMALS, DEFAULT_DECIMALS, INTEGER_KEYS, METRICS

log = logging.getLogger(__name__)

LAG = 12

# Percent change: (now / before - 1) * 100.
RATIO = (
    "median_sale_price", "median_list_price", "median_ppsf", "median_list_ppsf",
    "homes_sold", "pending_sales", "new_listings", "inventory", "active_listings",
)
# Percentage-point difference on an already-percent level: now - before.
POINT = ("avg_sale_to_list_ratio", "sold_above_list", "off_market_in_two_weeks")
# Level difference in the metric's own unit: whole days, months to 2 dp.
DIFFERENCE = ("median_dom", "months_of_supply")

assert set(RATIO) | set(POINT) | set(DIFFERENCE) == set(METRICS), \
    "every Redfin level must be assigned exactly one change family"

# A base below the metric's own range contract is too small to divide by.
RATIO_FLOOR = {m: max(RANGES[m][0], 1e-9) for m in RATIO}

RECONCILE_TOL = 0.02

# We recompute from ROUNDED published levels; base rounding scales with the change size,
# so the per-ZIP bound is max(0.02, (|yoy| + 100) * quantisation / base). Residual misses are
# restated bases (worst 0.262% of ZIPs, 2026-06). The contract is a share: a lag or units
# error moves nearly every ZIP. 1% is a 3.8x margin.
RECONCILE_MAX_SHARE = 0.01

# Prices only: Redfin uplifts the newest count YoY for expected revisions but not the level.
RECONCILE = ("median_sale_price", "median_ppsf", "median_list_price", "median_list_ppsf")

# --- Scale derivation for the difference family -------------------------------------------
# These two are reconciled separately because their published column has a history of scale
# drift and no stable header to read it off. Redfin shipped MEDIAN DAYS ON MARKET YOY as
# (now - before) * 100 under a "(%)" header through the 2026-07 release and as a plain
# whole-day difference under "(DAYS)" from 2026-08; MONTHS OF SUPPLY YOY is still x100 under
# "(%)". So the scale is DERIVED from the lag-12 level difference every run and recorded in
# the manifest, rather than declared in a constant nothing checks. The old declared divisor
# sat in `units.coerce`, where `recompute` overwrote its output before anything read it — it
# was wrong for a whole release and no test or contract could see it.
#
# Discrimination is easy and does not need a tight tolerance: the candidates differ by 100x,
# so the wrong one misses by ~99x the change itself.
SCALE_CANDIDATES = (1.0, 100.0)

# Tolerance per metric, measured on 2026-06-30 against 2025-06-30. The gap is entirely the
# published LEVEL's own rounding — the difference spans two levels, each rounded
# independently, while Redfin computes its column from unrounded internals. There is no
# revision noise in it at all: DOM's gap is exactly 0.0 or exactly 0.5 (max 0.5000, integer
# level) and months-of-supply's max is 0.0993 (a 1 dp level, so 2 x 0.05). These are 3x those
# measured maxima, the same order of margin the ratio family's bound carries.
SCALE_TOL = {"median_dom": 1.5, "months_of_supply": 0.3}

# Only ZIPs whose change is well clear of the tolerance can tell the candidates apart; a ZIP
# that did not move agrees with every scale. 8x keeps the vote to real evidence.
SCALE_DISCRIMINATING = 8.0
# The scale is a categorical question, so it is decided by DOMINANCE, not by an absolute
# share: the right candidate agrees with nearly every ZIP and the wrong one with almost none
# (x1 = 0.0% against x100 = 100% on 2026-06-30). A margin over the runner-up survives
# revision noise that would drag an absolute threshold under; the quantitative contract is
# the per-ZIP share check below, which is where a real units error shows up.
SCALE_MIN_AGREEMENT = 0.50
SCALE_MIN_MARGIN = 10.0
RECONCILE_DIFFERENCE = DIFFERENCE


def _period_map(panel_path, period: str, columns) -> dict:
    """One period's rows keyed by ZIP. The dataset filter skips row groups via statistics
    (0.40 s -> 0.09 s), since the panel is written in descending period order."""
    tbl = ds.dataset(panel_path, format="parquet").to_table(
        columns=["zip", *columns], filter=ds.field("period_end") == period
    )
    d = tbl.to_pydict()
    return {z: {c: d[c][i] for c in columns} for i, z in enumerate(d["zip"])}


def periods(panel_path) -> list[str]:
    keys = pq.read_table(panel_path, columns=["period_end"])
    return panel.axis(keys, "period_end")


def _quantisation(metric: str) -> float:
    """Half the published level's last digit. Taken from units.py, not restated."""
    if metric in INTEGER_KEYS:
        return 0.5
    return 0.5 * 10 ** -DECIMALS.get(metric, DEFAULT_DECIMALS)


def _yoy(metric: str, now, before):
    """One cell, in the metric's own unit. None where it is not defined."""
    if now is None or before is None:
        return None
    if metric in RATIO:
        if before < RATIO_FLOOR[metric]:
            return None
        return round((now / before - 1.0) * 100.0, 2)
    if metric == "median_dom":
        return round(now - before, 0)
    return round(now - before, 2)


def recompute(panel_path, records: dict, latest: str) -> dict:
    """Overwrite every `<metric>_yoy` in `records` with our own lag-12 value."""
    all_periods = periods(panel_path)
    if latest not in all_periods:
        raise PipelineError(f"changes: latest period {latest!r} is not in the panel")
    i = all_periods.index(latest)
    if i < LAG:
        raise PipelineError(
            f"changes: only {i + 1} period(s) at or before {latest}; need {LAG + 1} for lag-12"
        )
    base_period = all_periods[i - LAG]

    metrics = list(METRICS)
    base = _period_map(panel_path, base_period, metrics)

    filled = dict.fromkeys(metrics, 0)
    suppressed = dict.fromkeys(RATIO, 0)
    for zip_code, rec in records.items():
        prior = base.get(zip_code)
        for metric in metrics:
            now = rec.get(metric)
            before = prior.get(metric) if prior else None
            v = _yoy(metric, now, before)
            if (v is None and metric in RATIO and now is not None
                    and before is not None and before < RATIO_FLOOR[metric]):
                suppressed[metric] += 1
            rec[f"{metric}_yoy"] = v
            if v is not None:
                filled[metric] += 1

    dropped = {m: n for m, n in suppressed.items() if n}
    report = {
        "lag": LAG,
        "base_period": base_period,
        "latest_period": latest,
        "filled": filled,
        "suppressed_degenerate_base": dropped,
        "reconciliation": _reconcile(panel_path, all_periods, i),
    }
    log.info(
        "Changes: YoY recomputed at lag %d against %s; %s suppressed for a "
        "degenerate base",
        LAG, base_period, sum(dropped.values()) or "none",
    )
    return report


def _pairs(metric: str, now: dict, before: dict):
    """(published, ours) for every ZIP where both exist. The shared half of every check."""
    for zip_code, row in now.items():
        published = row.get(f"{metric}_yoy")
        prior = before.get(zip_code)
        if published is None or prior is None:
            continue
        base = prior.get(metric)
        ours = _yoy(metric, row.get(metric), base)
        if ours is None or not base:
            continue
        yield zip_code, published, ours, base


def _derive_scale(metric: str, now: dict, before: dict) -> dict:
    """Which of SCALE_CANDIDATES the feed's published column is on this release.

    Votes only on ZIPs whose own change is large enough to tell the candidates apart, then
    requires a clear winner. No winner means neither hypothesis describes the column, which
    is a real units event and not something to guess through.
    """
    tol = SCALE_TOL[metric]
    floor = SCALE_DISCRIMINATING * tol
    agree = dict.fromkeys(SCALE_CANDIDATES, 0)
    votes = 0
    for _zip, published, ours, _base in _pairs(metric, now, before):
        if abs(ours) < floor:
            continue
        votes += 1
        for scale in SCALE_CANDIDATES:
            if abs(published / scale - ours) <= tol:
                agree[scale] += 1

    if not votes:
        return {"scale": None, "votes": 0,
                "reason": f"no ZIP moved more than {floor} to discriminate on"}

    shares = {s: agree[s] / votes for s in SCALE_CANDIDATES}
    best = max(shares, key=shares.get)
    runner_up = max((s for s in SCALE_CANDIDATES if s != best), key=shares.get, default=None)
    second = shares[runner_up] if runner_up is not None else 0.0
    evidence = {"votes": votes, "agreement": {str(s): round(v, 4) for s, v in shares.items()},
                "tolerance": tol, "discriminating_floor": floor}

    dominant = second == 0.0 or shares[best] / second >= SCALE_MIN_MARGIN
    if shares[best] < SCALE_MIN_AGREEMENT or not dominant:
        raise PipelineError(
            f"changes: cannot establish the scale of Redfin's published {metric}_yoy "
            f"column against our lag-12 level difference on {votes:,} ZIPs that moved more "
            f"than {floor}.\n"
            f"Agreement per candidate: "
            + ", ".join(f"x{s:g}={shares[s]:.1%}" for s in SCALE_CANDIDATES)
            + f"\nBest x{best:g} at {shares[best]:.1%} needs at least "
            f"{SCALE_MIN_AGREEMENT:.0%} and a {SCALE_MIN_MARGIN:g}x margin over the "
            f"runner-up ({second:.1%}).\n"
            f"Either the column now means something other than a level difference, or its "
            f"scale is outside SCALE_CANDIDATES, or SCALE_TOL[{metric!r}] = {tol} no longer "
            f"covers the published level's rounding. Nothing published depends on this "
            f"column — {metric}_yoy ships from our own levels — but it is the evidence that "
            f"our arithmetic matches upstream's, so check the feed before widening anything."
        )

    evidence["scale"] = best
    return evidence


def _reconcile(panel_path, all_periods: list[str], latest_index: int) -> dict:
    """CONTRACT: recomputed YoY matches Redfin's published column on the SECOND-newest period
    (the newest carries a revision uplift on counts). Catches lag and units errors."""
    if latest_index < LAG + 1:
        return {"checked": False, "reason": "not enough history behind the newest period"}

    period = all_periods[latest_index - 1]
    base_period = all_periods[latest_index - 1 - LAG]
    metrics = list(RECONCILE) + list(RECONCILE_DIFFERENCE)
    cols = metrics + [f"{m}_yoy" for m in metrics]
    now = _period_map(panel_path, period, cols)
    before = _period_map(panel_path, base_period, metrics)

    out, failures = {}, []
    for metric in RECONCILE:
        quant = _quantisation(metric)
        compared = exceeded = 0
        worst = 0.0
        worst_zip = None
        for zip_code, published, ours, base in _pairs(metric, now, before):
            compared += 1
            gap = abs(ours - published)
            if gap > max(RECONCILE_TOL, (abs(ours) + 100.0) * quant / base):
                exceeded += 1
            if gap > worst:
                worst, worst_zip = gap, zip_code

        share = exceeded / compared if compared else 0.0
        out[metric] = {
            "compared": compared,
            "exceeded": exceeded,
            "share": round(share, 5),
            "max_abs_gap": round(worst, 4),
            "worst_zip": worst_zip,
        }
        if share > RECONCILE_MAX_SHARE:
            failures.append(
                f"  {metric}: {exceeded:,} of {compared:,} ZIPs ({share:.2%}) exceed "
                f"their quantisation bound; worst gap {worst:.4f} at ZIP {worst_zip}"
            )

    # The difference family, on whichever scale this release's feed turns out to use.
    scales = {}
    for metric in RECONCILE_DIFFERENCE:
        evidence = _derive_scale(metric, now, before)
        scales[metric] = evidence
        scale = evidence["scale"]
        if scale is None:
            out[metric] = {"compared": 0, "skipped": evidence["reason"]}
            continue

        tol = SCALE_TOL[metric]
        compared = exceeded = 0
        worst = 0.0
        worst_zip = None
        for zip_code, published, ours, _base in _pairs(metric, now, before):
            compared += 1
            gap = abs(published / scale - ours)
            if gap > tol:
                exceeded += 1
            if gap > worst:
                worst, worst_zip = gap, zip_code

        share = exceeded / compared if compared else 0.0
        out[metric] = {
            "compared": compared,
            "exceeded": exceeded,
            "share": round(share, 5),
            "max_abs_gap": round(worst, 4),
            "worst_zip": worst_zip,
            "feed_scale": scale,
        }
        if share > RECONCILE_MAX_SHARE:
            failures.append(
                f"  {metric}: {exceeded:,} of {compared:,} ZIPs ({share:.2%}) differ from "
                f"the published column by more than {tol} (feed scale x{scale:g}); "
                f"worst gap {worst:.4f} at ZIP {worst_zip}"
            )

    # Losing every check is not a clean release. One metric degrading is survivable; all of
    # them means the detector is gone and a units change would ship unseen.
    live = [m for m, r in out.items() if r.get("compared")]
    if not live:
        raise PipelineError(
            f"changes: no metric could be reconciled against Redfin's published columns on "
            f"{period}. Reasons: "
            + "; ".join(f"{m}={r.get('skipped', 'no overlapping ZIPs')}"
                        for m, r in out.items())
            + "\nThis is the only check that our lag-12 arithmetic matches upstream's."
        )

    if failures:
        raise PipelineError(
            f"changes: recomputed YoY disagrees with Redfin's published column on "
            f"{period} for more than {RECONCILE_MAX_SHARE:.0%} of ZIPs. A lag error "
            f"or a units change looks exactly like this.\n" + "\n".join(failures)
        )
    log.info(
        "Changes: reconciled %d metric(s) on %s; feed scale %s",
        len(live), period,
        ", ".join(f"{m}=x{scales[m]['scale']:g}" for m in RECONCILE_DIFFERENCE
                  if scales[m]["scale"] is not None) or "not established",
    )
    return {"checked": True, "period": period, "base_period": base_period,
            "flat_tolerance": RECONCILE_TOL, "max_share": RECONCILE_MAX_SHARE,
            "feed_scale": {m: e["scale"] for m, e in scales.items()},
            "scale_evidence": scales,
            "metrics": out}

"""Year-over-year, recomputed from published levels at lag 12. No Redfin `*_YOY` is shipped.

This keeps level and change describing the same quantity, and sidesteps two upstream
defects: the DOM and months-of-supply "(%)" YoY columns are really differences x 100, and a
percent change on a degenerate base ($1 sale -> +30,993,016%) is nulled rather than clamped.

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
from .units import DECIMALS, DEFAULT_DECIMALS, INTEGER_KEYS, LEVELS

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

assert set(RATIO) | set(POINT) | set(DIFFERENCE) == set(LEVELS.values()), \
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

    metrics = list(LEVELS.values())
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


def _reconcile(panel_path, all_periods: list[str], latest_index: int) -> dict:
    """CONTRACT: recomputed YoY matches Redfin's published column on the SECOND-newest period
    (the newest carries a revision uplift on counts). Catches lag and units errors."""
    if latest_index < LAG + 1:
        return {"checked": False, "reason": "not enough history behind the newest period"}

    period = all_periods[latest_index - 1]
    base_period = all_periods[latest_index - 1 - LAG]
    cols = list(RECONCILE) + [f"{m}_yoy" for m in RECONCILE]
    now = _period_map(panel_path, period, cols)
    before = _period_map(panel_path, base_period, list(RECONCILE))

    out, failures = {}, []
    for metric in RECONCILE:
        quant = _quantisation(metric)
        compared = exceeded = 0
        worst = 0.0
        worst_zip = None
        for zip_code, row in now.items():
            published = row.get(f"{metric}_yoy")
            prior = before.get(zip_code)
            if published is None or prior is None:
                continue
            base = prior.get(metric)
            ours = _yoy(metric, row.get(metric), base)
            if ours is None or not base:
                continue
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

    if failures:
        raise PipelineError(
            f"changes: recomputed YoY disagrees with Redfin's published column on "
            f"{period} for more than {RECONCILE_MAX_SHARE:.0%} of ZIPs. A lag error "
            f"or a units change looks exactly like this.\n" + "\n".join(failures)
        )
    return {"checked": True, "period": period, "base_period": base_period,
            "flat_tolerance": RECONCILE_TOL, "max_share": RECONCILE_MAX_SHARE,
            "metrics": out}

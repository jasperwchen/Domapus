"""Year-over-year, recomputed from published levels at lag 12.

ONE RULE: every change metric is computed by us from the levels Redfin publishes,
in that metric's own native unit. No Redfin `*_YOY` column is ever republished.

That rule is not tidiness. It is what makes the displayed level and the displayed
change describe the SAME quantity, which is the premise the whole site rests on.
It also disposes of two upstream defects without a correction factor:

  * `MEDIAN DAYS ON MARKET YOY (%)` and `MONTHS OF SUPPLY YOY (%)` are not
    percents. They are the absolute difference times 100, under a "(%)" suffix
    that is a lie — 43.2% of median_dom YoY values in the latest period are below
    -100, which a percent change cannot be. Recomputing means those columns are
    never read, so there is no `/100` to remember and no trap left behind.

  * A percent change against a degenerate base is a division artifact, not a
    measurement. ZIP 12207 (Albany, NY) recorded a $1 median sale price in
    2025-07 — one $1 transaction — so the published change to 2026-07 is
    +30,993,016%. That number is arithmetically correct, useless to a reader, and
    does not fit in the int32 the wire format uses. It is nulled here rather than
    clamped, because there is no honest value to clamp it to: we do not know what
    that ZIP's prices did, we know its year-ago sample was one $1 sale.

**Three units, not one.** A change is not automatically a percent:

    ratio (9)       msp mlp ppsf lppsf hs ps nl inv al   percent change
    point (3)       s2l abv om2                          percentage-POINT difference
    difference (2)  dom mos                              days / months, natively
    index (1)       zhvi                                 percent change (in zhvi.py)

The point family is the subtle one. `sold_above_list` is already a percentage, so
the change from 40% to 45% is +5 percentage points, not +12.5%. Shipping that as a
percent would be a second silent 100x-style error in a different disguise.

YoY IS A PERCENT CHANGE, NOT A LOG DIFFERENCE. The two are equal only at zero — at
+25% they differ by 2.686 pp. The log form survives only inside forecasting, where
it never reaches the UI.
"""

import logging

import pyarrow.compute as pc
import pyarrow.parquet as pq

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

# A ratio change needs a base that is actually a measurement. The floor is the
# metric's own declared plausible range, so this introduces no new number: if a
# level is too small for the range contract to accept it as a level, it is too
# small to divide by.
RATIO_FLOOR = {m: max(RANGES[m][0], 1e-9) for m in RATIO}

# A flat tolerance on the YoY value, for the ordinary case.
RECONCILE_TOL = 0.02

# ...and the part a flat tolerance gets wrong. We recompute from the levels the
# feed PUBLISHES, which are rounded; Redfin computed its own YoY from the
# unrounded values. The base's rounding propagates into the percent change
# multiplied by the size of the change itself, so a half-cent of rounding on a
# $1.01/sqft base becomes 41 percentage points on an 8,400% change. That is not a
# disagreement about method, it is information the published file does not carry.
#
#     tolerance = max(0.02, (|yoy| + 100) * quantisation / base)
#
# MEASURED on 2026-06-30 with that tolerance: median_sale_price 0 of 23,738
# exceed, median_list_price 1 of 25,625, median_list_ppsf 42 of 25,570,
# median_ppsf 62 of 23,673 — worst share 0.262%. The survivors are ZIPs whose
# BASE has been restated since Redfin computed the YoY (ZIP 31905's published
# figure implies a 2025-06 level of 491,058.7 against the 492,250.0 the file now
# carries), which no tolerance on our side can reconcile.
#
# So the contract is a SHARE, not a per-ZIP absolute. That is what makes it
# sharp against the failure it exists to catch: a lag error or a units error
# moves essentially every ZIP, not 0.3% of them. The gate sits at 1%, a 3.8x
# margin over the worst series measured.
RECONCILE_MAX_SHARE = 0.01

# Prices and rates only. Count metrics are excluded because Redfin pre-emptively
# uplifts the newest period's published YoY for expected revisions while leaving
# the published LEVEL un-uplifted — so a blanket "recomputed must equal published"
# check passes at 100% for prices and hard-fails on every count metric, for a
# reason that is upstream policy rather than an error on either side.
RECONCILE = ("median_sale_price", "median_ppsf", "median_list_price", "median_list_ppsf")


def _period_map(panel_path, period: str, columns) -> dict:
    tbl = pq.read_table(panel_path, columns=["zip", "period_end", *columns])
    tbl = tbl.filter(pc.equal(tbl["period_end"], period))
    d = tbl.to_pydict()
    return {z: {c: d[c][i] for c in columns} for i, z in enumerate(d["zip"])}


def periods(panel_path) -> list[str]:
    keys = pq.read_table(panel_path, columns=["period_end"])
    return sorted(set(pc.unique(keys["period_end"]).to_pylist()))


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
    if metric in DIFFERENCE and metric == "median_dom":
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
    """CONTRACT: our recomputed YoY matches Redfin's published one, to 2 dp.

    Run on the SECOND-newest period, not the newest. In the newest period only,
    Redfin computes the level and the YoY on different bases — the published YoY
    carries a curing uplift for expected revisions and the published level does
    not — so the two legitimately disagree there by ~1-7 pp on count metrics. Any
    older period is clean, and this is the check that would have caught a lag-4
    error, which is the failure mode worth guarding against.
    """
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

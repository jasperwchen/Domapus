"""The diff gate: refuse to publish a snapshot that moved more than a real month can.

This is the check that would have caught the property-type bug. The fingerprint
was already sitting in the site's own published metadata — `last_updated.json`
reported 26,267 of 33,771 ZIPs changed in one month, 77.8%, from a rolling
three-month window. No real month does that.

Thresholds are calibrated from the panel's OWN month-over-month transitions by
`scripts/calibrate_diff_gate.py`, which writes `tests/baselines/diff_gate.json`.
They are explicitly NOT calibrated from `public/data/archive/*.json.gz`: those
snapshots were produced by the buggy pipeline, so calibrating on them would bake
the defect into the baseline permanently and blind the gate forever.
"""

import json
import logging
import math
from pathlib import Path

from .contracts import PipelineError

log = logging.getLogger(__name__)

# Four price-like series. A units change, a grain change or a source swap moves
# all of them; a genuine market month moves none of them much.
GATED = ["median_sale_price", "median_list_price", "median_ppsf", "zhvi"]

# National aggregates, checked separately because a distributional shift can hide
# inside a per-ZIP threshold.
NATIONAL_MEDIAN_LIMIT = 0.10
HOMES_SOLD_TOTAL_LIMIT = 0.30
COVERAGE_LIMIT = 0.02

MOVE = 0.25  # "moved" means |new/live - 1| > 25%


def _median(values: list[float]) -> float | None:
    v = sorted(x for x in values if x is not None and math.isfinite(x))
    if not v:
        return None
    n = len(v)
    return v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2


def moved_fraction(new: dict, live: dict, metric: str) -> tuple[float, int]:
    """Share of comparable ZIPs whose value moved more than MOVE. (fraction, n)."""
    moved = comparable = 0
    for zip_code, row in new.items():
        old = live.get(zip_code)
        if old is None:
            continue
        a, b = row.get(metric), old.get(metric)
        if a is None or b is None or not b:
            continue
        comparable += 1
        if abs(a / b - 1.0) > MOVE:
            moved += 1
    return (moved / comparable if comparable else 0.0), comparable


def load_thresholds(path: Path) -> dict:
    if not path.exists():
        raise PipelineError(
            f"diff-gate baseline missing: {path}. Run "
            f"scripts/calibrate_diff_gate.py against build/panel.parquet."
        )
    return json.loads(path.read_text(encoding="utf-8"))["thresholds"]


def gate(new: dict, live: dict, thresholds: dict, coverage: dict | None = None,
         live_coverage: dict | None = None, override: bool = False,
         reason: str = "") -> dict:
    """Compare a candidate snapshot against the live one. Returns a report.

    Raises unless `override` is set AND `reason` is non-empty. The first run of a
    fixed pipeline trips this on purpose — which means the very first thing anyone
    does with the gate is override it, and that is exactly the habit that destroys
    gates. Pre-write the reason in the PR, do not discover the need at 2am.
    """
    failures: list[str] = []
    observed: dict[str, dict] = {}

    if not live:
        log.warning("No live snapshot to compare against — gate cannot run")
        return {"failures": [], "overridden": False, "reason": "", "skipped": "no live snapshot"}

    for metric in GATED:
        limit = thresholds.get(metric, {}).get("moved_gt_25pct")
        frac, n = moved_fraction(new, live, metric)
        observed[metric] = {"moved_gt_25pct": round(frac, 5), "comparable": n}
        if limit is not None and frac > limit:
            failures.append(
                f"{metric}: {frac:.1%} of {n:,} comparable ZIPs moved >25% (limit {limit:.1%})"
            )

        a = _median([r.get(metric) for r in new.values()])
        b = _median([r.get(metric) for r in live.values()])
        if a is not None and b:
            shift = a / b - 1.0
            observed[metric]["national_median_shift"] = round(shift, 5)
            if abs(shift) > NATIONAL_MEDIAN_LIMIT:
                failures.append(
                    f"{metric}: national median moved {shift:+.1%} "
                    f"(limit +/-{NATIONAL_MEDIAN_LIMIT:.0%})"
                )

    a = sum(r["homes_sold"] for r in new.values() if r.get("homes_sold"))
    b = sum(r["homes_sold"] for r in live.values() if r.get("homes_sold"))
    if b:
        shift = a / b - 1.0
        observed["homes_sold"] = {"national_total_shift": round(shift, 5)}
        if abs(shift) > HOMES_SOLD_TOTAL_LIMIT:
            failures.append(
                f"homes_sold: national total moved {shift:+.1%} "
                f"(limit +/-{HOMES_SOLD_TOTAL_LIMIT:.0%})"
            )

    if coverage and live_coverage:
        for k in ("both", "redfin_only", "zhvi_only", "no_data"):
            prev = live_coverage.get(k)
            if not prev:
                continue
            shift = coverage[k] / prev - 1.0
            observed.setdefault("coverage", {})[k] = round(shift, 5)
            if abs(shift) > COVERAGE_LIMIT:
                failures.append(
                    f"coverage.{k} moved {shift:+.1%} (limit +/-{COVERAGE_LIMIT:.0%})"
                )

    report = {
        "failures": failures,
        "observed": observed,
        "overridden": bool(failures and override),
        "reason": reason,
    }
    if failures and not override:
        raise PipelineError("Diff gate FAILED:\n  " + "\n  ".join(failures))
    if failures:
        if not reason.strip():
            raise PipelineError(
                "override_diff_gate requires a non-empty override_reason. The reason "
                "is recorded verbatim in the manifest; an unexplained override is "
                "indistinguishable from a broken gate."
            )
        log.warning("Gate OVERRIDDEN (%s): %s", reason, failures)
    return report

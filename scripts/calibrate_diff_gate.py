"""Calibrate the diff gate from the panel's own month-over-month transitions.

    python scripts/calibrate_diff_gate.py build/panel.parquet \
        temp-data/Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv

Writes `tests/baselines/diff_gate.json`. Committed next to the baseline it
produces, so the numbers can be re-derived rather than trusted.

The rule: for each gated metric, take the share of ZIPs that moved more than 25%
between consecutive periods, over every real transition in the panel; the
threshold is the P99 of that distribution times 1.5.

**Not calibrated from `public/data/archive/*.json.gz`.** Those snapshots were
produced by the buggy pipeline — an arbitrary property type per ZIP, re-rolled
every run — so their month-over-month movement is dominated by the defect. Baking
that into the baseline would blind the gate to the exact failure it exists to
catch.
"""

import json
import math
import sys
from pathlib import Path

import pyarrow.compute as pc
import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "tests" / "baselines" / "diff_gate.json"

PANEL_METRICS = ["median_sale_price", "median_list_price", "median_ppsf"]
MOVE = 0.25
P = 0.99
SAFETY = 1.5

# A threshold floor, because the P99 x 1.5 rule degenerates on a smooth series.
# Measured: `zhvi` moved >25% for ZERO ZIPs in all 318 monthly transitions, so
# p99 and max are both 0.0 and the rule would set the threshold to 0.0 — a gate
# that fires on a single outlier ZIP. ZHVI is `sm_sa`, smoothed and seasonally
# adjusted, so that degeneracy is a property of the series, not a sampling
# artefact. 1% of ZIPs is small enough to catch a regime change and large enough
# not to fire on a handful of them.
FLOOR = 0.01


def _quantile(values, q):
    v = sorted(values)
    if not v:
        return None
    idx = (len(v) - 1) * q
    lo, hi = math.floor(idx), math.ceil(idx)
    return v[lo] * (1 - (idx - lo)) + v[hi] * (idx - lo)


def from_panel(panel_path: Path) -> tuple[dict, dict]:
    tbl = pq.read_table(panel_path, columns=["zip", "period_end"] + PANEL_METRICS)
    periods = sorted(set(pc.unique(tbl["period_end"]).to_pylist()), reverse=True)

    by_period: dict[str, dict[str, dict]] = {}
    zips = tbl["zip"].to_pylist()
    ends = tbl["period_end"].to_pylist()
    cols = {m: tbl[m].to_pylist() for m in PANEL_METRICS}
    for i, period in enumerate(ends):
        by_period.setdefault(period, {})[zips[i]] = {m: cols[m][i] for m in PANEL_METRICS}

    dists = {m: [] for m in PANEL_METRICS}
    transitions = 0
    for newer, older in zip(periods, periods[1:]):
        a, b = by_period[newer], by_period[older]
        transitions += 1
        for m in PANEL_METRICS:
            moved = comparable = 0
            for z, row in a.items():
                prev = b.get(z)
                if prev is None:
                    continue
                x, y = row[m], prev[m]
                if x is None or y is None or not y or y != y:
                    continue
                comparable += 1
                if abs(x / y - 1.0) > MOVE:
                    moved += 1
            if comparable >= 1000:
                dists[m].append(moved / comparable)
    return dists, {"transitions": transitions, "periods": len(periods)}


def from_zhvi(csv_path: Path) -> list[float]:
    """ZHVI is not in the panel — calibrate it from its own wide monthly file."""
    import csv
    import re

    with open(csv_path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    date_cols = sorted(c for c in rows[0] if re.match(r"^\d{4}-\d{2}-\d{2}$", c))
    dist = []
    for newer, older in zip(date_cols[1:], date_cols):
        moved = comparable = 0
        for r in rows:
            try:
                x, y = float(r[newer]), float(r[older])
            except (TypeError, ValueError):
                continue
            if not y:
                continue
            comparable += 1
            if abs(x / y - 1.0) > MOVE:
                moved += 1
        if comparable >= 1000:
            dist.append(moved / comparable)
    return dist


def main() -> int:
    panel = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "build" / "panel.parquet"
    dists, meta = from_panel(panel)
    if len(sys.argv) > 2:
        dists["zhvi"] = from_zhvi(Path(sys.argv[2]))

    thresholds = {}
    for metric, dist in dists.items():
        if not dist:
            continue
        p99 = _quantile(dist, P)
        thresholds[metric] = {
            "moved_gt_25pct": round(min(1.0, max(p99 * SAFETY, FLOOR)), 5),
            "observed_p99": round(p99, 5),
            "observed_max": round(max(dist), 5),
            "observed_median": round(_quantile(dist, 0.5), 5),
            "transitions": len(dist),
        }

    payload = {
        "generated_from": {
            "panel": str(panel.name),
            "panel_periods": meta["periods"],
            "panel_transitions": meta["transitions"],
        },
        "rule": f"max(P{int(P * 100)} of the observed moved>{int(MOVE * 100)}% "
                f"distribution x {SAFETY}, floor {FLOOR})",
        "note": "NOT calibrated from public/data/archive/*.json.gz — those were "
                "produced by the buggy pipeline and would bake the defect in.",
        "thresholds": thresholds,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

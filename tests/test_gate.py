"""Diff-gate tests.

The gate exists because the property-type bug shipped for months with the
evidence in plain sight: `last_updated.json` reported 26,267 of 33,771 ZIPs
changed in one month, 77.8%, from a rolling three-month window. No real month
does that.
"""

import json
from pathlib import Path

import pytest

from pipeline import gate
from pipeline.contracts import PipelineError

ROOT = Path(__file__).resolve().parent.parent
BASELINE = ROOT / "tests" / "baselines" / "diff_gate.json"


@pytest.fixture(scope="module")
def thresholds():
    return gate.load_thresholds(BASELINE)


def _snapshot(n: int, price: float, listing: float | None = None, ppsf: float = 200.0,
              zhvi: float = 400_000.0, sold: int = 20) -> dict:
    return {
        f"{10_000 + i:05d}": {
            "median_sale_price": price,
            "median_list_price": listing if listing is not None else price,
            "median_ppsf": ppsf,
            "zhvi": zhvi,
            "homes_sold": sold,
        }
        for i in range(n)
    }


def test_baseline_is_calibrated_from_the_panel_not_the_archive():
    payload = json.loads(BASELINE.read_text(encoding="utf-8"))
    assert payload["generated_from"]["panel_periods"] == 173
    assert payload["generated_from"]["panel_transitions"] == 172
    assert "archive" in payload["note"]


def test_thresholds_reflect_real_zip_level_noise(thresholds):
    """A ZIP median over ~14 sales is genuinely noisy: in a NORMAL month 14% of
    ZIPs move more than 25%. The threshold has to sit above that, so it lands
    near 28%, not the ~5% an earlier estimate assumed."""
    msp = json.loads(BASELINE.read_text(encoding="utf-8"))["thresholds"]["median_sale_price"]
    assert 0.10 < msp["observed_median"] < 0.20
    assert thresholds["median_sale_price"]["moved_gt_25pct"] > msp["observed_max"]


def test_zhvi_threshold_uses_the_floor(thresholds):
    """ZHVI moved >25% for zero ZIPs in all 318 monthly transitions, so P99 x 1.5
    is 0.0 — a gate that fires on one outlier. The floor is what stops that."""
    z = json.loads(BASELINE.read_text(encoding="utf-8"))["thresholds"]["zhvi"]
    assert z["observed_p99"] == 0.0
    assert thresholds["zhvi"]["moved_gt_25pct"] == 0.01


def test_a_quiet_month_passes(thresholds):
    live = _snapshot(5000, 400_000)
    new = _snapshot(5000, 404_000)  # +1% everywhere
    report = gate.gate(new, live, thresholds)
    assert report["failures"] == []


def test_a_property_type_swap_is_rejected(thresholds):
    """Simulates the bug: a large minority of ZIPs suddenly report a different
    property type, so their median jumps by far more than a month can move it."""
    live = _snapshot(5000, 400_000)
    new = _snapshot(5000, 400_000)
    for i, z in enumerate(sorted(new)):
        if i % 5 < 2:  # 40% of ZIPs draw a different property type
            new[z]["median_sale_price"] = 1_100_000
            new[z]["median_list_price"] = 1_100_000
            new[z]["median_ppsf"] = 560.0
    with pytest.raises(PipelineError, match="Diff gate FAILED"):
        gate.gate(new, live, thresholds)


def test_a_units_change_is_rejected(thresholds):
    """A 100x error looks exactly like this and is the other thing the gate is for."""
    live = _snapshot(5000, 400_000)
    new = _snapshot(5000, 4_000)
    with pytest.raises(PipelineError, match="Diff gate FAILED"):
        gate.gate(new, live, thresholds)


def test_national_median_shift_is_caught_even_below_the_per_zip_threshold(thresholds):
    """A uniform 15% lift moves NO individual ZIP past the 25% per-ZIP test, so
    the per-ZIP check is blind to it. The national median check is not."""
    live = _snapshot(5000, 400_000)
    new = _snapshot(5000, 460_000)
    frac, _ = gate.moved_fraction(new, live, "median_sale_price")
    assert frac == 0.0, "per-ZIP check should see nothing here"
    with pytest.raises(PipelineError, match="national median moved"):
        gate.gate(new, live, thresholds)


def test_homes_sold_national_total_is_checked(thresholds):
    live = _snapshot(5000, 400_000, sold=20)
    new = _snapshot(5000, 400_000, sold=40)
    with pytest.raises(PipelineError, match="homes_sold: national total"):
        gate.gate(new, live, thresholds)


def test_coverage_shift_is_caught(thresholds):
    live = _snapshot(100, 400_000)
    new = _snapshot(100, 400_000)
    with pytest.raises(PipelineError, match=r"coverage\.both"):
        gate.gate(new, live, thresholds,
                  coverage={"both": 20_000, "redfin_only": 3_000,
                            "zhvi_only": 600, "no_data": 4_000},
                  live_coverage={"both": 25_604, "redfin_only": 3_315,
                                 "zhvi_only": 658, "no_data": 4_194})


def test_override_requires_a_written_reason(thresholds):
    """The first run of a fixed pipeline trips the gate on purpose, so the very
    first thing anyone does with it is override it. An unexplained override is
    indistinguishable from a broken gate."""
    live = _snapshot(5000, 400_000)
    new = _snapshot(5000, 4_000)
    with pytest.raises(PipelineError, match="requires a non-empty override_reason"):
        gate.gate(new, live, thresholds, override=True, reason="   ")

    report = gate.gate(new, live, thresholds, override=True,
                       reason="first run after the 2026-09 feed migration")
    assert report["overridden"] is True
    assert report["reason"]
    assert report["failures"]


def test_no_live_snapshot_skips_rather_than_failing(thresholds):
    report = gate.gate(_snapshot(10, 400_000), {}, thresholds)
    assert report["skipped"]

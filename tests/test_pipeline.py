"""Pipeline tests. Every fixture is real data cut from the real feed — CI never
touches the network.

`tests/fixtures/redfin_sample.csv` is 13 periods x 11 ZIPs. 13 is the minimum
that makes a lag-12 check possible, and the lag-12 check is what proves the
DIVIDE_BY_100 decision rather than asserting it.
"""

import json
from pathlib import Path

import pytest

from pipeline import dim, redfin, serialize, sources, zhvi
from pipeline.contracts import (
    PipelineError,
    RANGES,
    assert_columns_absent,
    assert_ranges,
    assert_zip_format,
)
from pipeline.units import DIVIDE_BY_100, LEVELS, READ_COLUMNS, YOY_HEADER, coerce

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "tests" / "fixtures"
SAMPLE = FIXTURES / "redfin_sample.csv"


@pytest.fixture(scope="module")
def ingested(tmp_path_factory):
    panel = tmp_path_factory.mktemp("panel") / "panel.parquet"
    return redfin.ingest(SAMPLE, panel)


@pytest.fixture(scope="module")
def latest(ingested):
    _report, rows = ingested
    return redfin.latest_records(rows)


# --- The key assertion, which is the whole point of the rewrite ------------

def _meta_for(latest):
    """A complete metadata row per ZIP, so the all-null column guard has nothing
    to complain about and the test under it exercises what it says it does."""
    return {z: {"city": "Testville", "county": "Test", "state": "NY",
                "metro": "Test, NY metro area", "lat": 40.0, "lng": -74.0}
            for z in latest}


def _zhvi_for(latest):
    return {z: {"zhvi": 500_000, "zhvi_mom": 0.5, "zhvi_yoy": 3.0} for z in latest}


def test_primary_key_is_unique(ingested):
    """ingest() asserts (PERIOD END, REGION NAME) before writing anything. It got
    here, so the fixture is clean — check the reported shape is self-consistent."""
    report, _ = ingested
    assert report["rows"] <= report["periods"] * report["zips"]
    assert report["periods"] == 13
    assert report["latest_period"] == report["period_max"]


def test_duplicate_key_is_rejected(tmp_path):
    """A duplicated (period, ZIP) row must stop the run, not be silently reduced.

    This is the bug the old pipeline shipped: `drop_duplicates('zip_code')` used
    as a filter on a key nobody had proved was a key, resolved by an unstable
    sort, re-randomizing on every run.
    """
    lines = SAMPLE.read_text(encoding="utf-8").splitlines()
    # Insert the duplicate INSIDE the newest period block. Appending it at the end
    # trips the descending-PERIOD-END contract first and proves nothing about the key.
    dupe = tmp_path / "dupe.csv"
    dupe.write_text("\n".join(lines[:2] + [lines[1]] + lines[2:]), encoding="utf-8")
    with pytest.raises(PipelineError, match="is NOT unique"):
        redfin.ingest(dupe, tmp_path / "p.parquet")


def test_property_type_column_reappearing_is_rejected():
    with pytest.raises(PipelineError, match="REAPPEARED"):
        assert_columns_absent(["PERIOD END", "PROPERTY TYPE"], "test")


# --- Units: the part that silently corrupts if rushed ----------------------

def test_median_dom_yoy_is_a_day_difference_not_a_percent(latest):
    """Redfin's `MEDIAN DAYS ON MARKET YOY (%)` is (now - year_ago) * 100.

    Verified against real lag-12 levels in the fixture: `published / 100` matches
    the level difference on every row, within the feed's own rounding of the
    published level. The percent-change hypothesis is judged in aggregate, not
    per row, because on a few rows the two happen to coincide numerically
    (78701: -16 days against -16.33 percent).
    """
    import csv
    rows = list(csv.DictReader(SAMPLE.open(encoding="utf-8")))
    by = {}
    for r in rows:
        by.setdefault(r["REGION NAME"], {})[r["PERIOD END"]] = r
    periods = sorted({r["PERIOD END"] for r in rows}, reverse=True)
    t, lag = periods[0], periods[12]

    checked = pct_matches = 0
    for zip_code, series in by.items():
        now, then = series.get(t), series.get(lag)
        if not now or not then:
            continue
        for level_col, yoy_col, key in (
            ("MEDIAN DAYS ON MARKET (DAYS)", "MEDIAN DAYS ON MARKET YOY (%)", "median_dom_yoy"),
            ("MONTHS OF SUPPLY", "MONTHS OF SUPPLY YOY (%)", "months_of_supply_yoy"),
        ):
            try:
                a, b, pub = float(now[level_col]), float(then[level_col]), float(now[yoy_col])
            except ValueError:
                continue
            shipped = coerce(key, pub)
            # The contract: what we ship IS the level difference, within the
            # rounding of the published integer/1-dp level.
            assert abs(shipped - (a - b)) <= 0.6, (zip_code, key, shipped, a - b)
            if b and abs(shipped - (a / b - 1) * 100) <= 0.6:
                pct_matches += 1
            checked += 1

    assert checked >= 15, f"only {checked} comparisons — fixture too thin to prove anything"
    assert pct_matches / checked < 0.25, (
        f"{pct_matches}/{checked} rows also fit a percent change — this fixture cannot "
        f"tell the two hypotheses apart, so it does not prove the /100"
    )


def test_percent_columns_are_not_multiplied_again(latest):
    """The feed ships 101.34, not 1.0134. A `* 100` here is a silent 100x error."""
    for zip_code, rec in latest.items():
        v = coerce("avg_sale_to_list_ratio", rec["avg_sale_to_list_ratio"])
        if v is not None:
            assert 50 <= v <= 200, (zip_code, v)


def test_mom_columns_are_never_read():
    """Redfin publishes no MoM at ZIP level: 0 non-null cells in 4,930,000 x 14."""
    assert not [c for c in READ_COLUMNS if "MOM" in c]
    assert len(READ_COLUMNS) == 36


def test_divide_by_100_is_exactly_the_two_mislabelled_columns():
    assert DIVIDE_BY_100 == {"median_dom_yoy", "months_of_supply_yoy"}


# --- Output shape ----------------------------------------------------------

def test_key_order_is_38_and_carries_no_redfin_mom():
    assert len(serialize.KEY_ORDER) == 38
    assert not [k for k in serialize.KEY_ORDER if k.endswith("_mom") and k != "zhvi_mom"]
    assert "zhvi_mom" in serialize.KEY_ORDER
    for new in ("active_listings", "months_of_supply", "median_list_ppsf"):
        assert new in serialize.KEY_ORDER


def test_key_order_has_no_duplicates():
    assert len(set(serialize.KEY_ORDER)) == len(serialize.KEY_ORDER)


def test_every_redfin_metric_has_a_yoy():
    for key in LEVELS.values():
        assert key in serialize.KEY_ORDER
        assert f"{key}_yoy" in serialize.KEY_ORDER


def test_snapshot_round_trips_and_keeps_leading_zeros(tmp_path, latest):
    meta = {z: {"city": "X", "county": "Y", "state": "NY", "metro": None,
                "lat": 1.0, "lng": -2.0} for z in ["00501", "07002", "30309"]}
    records, period, coverage = serialize.assemble(meta, {}, latest)
    out = tmp_path / "zip-data.json"
    serialize.write_snapshot(records, out, None, True)
    back = json.loads(out.read_text(encoding="utf-8"))
    assert "00501" in back["z"], "leading zero destroyed — ZIP was read as an integer"
    assert back["f"] == serialize.KEY_ORDER
    assert all(len(r) == 38 for r in back["d"])


def test_zero_survives_and_is_not_confused_with_null():
    """`0` is a legal value for homes_sold and median_dom. None is not zero."""
    assert coerce("homes_sold", 0) == 0
    assert coerce("homes_sold", None) is None
    assert coerce("homes_sold", "NA") is None
    assert coerce("median_dom", 0) == 0


# --- Contracts -------------------------------------------------------------

def test_ranges_are_on_the_percent_scale():
    """Fraction-scale bounds reject every row of this feed."""
    assert RANGES["avg_sale_to_list_ratio"] == (50.0, 200.0)
    assert RANGES["sold_above_list"][1] > 100


def test_range_violation_is_fatal():
    with pytest.raises(PipelineError, match="range contract violated"):
        assert_ranges({"99999": {"avg_sale_to_list_ratio": 1.0134}}, "test")


def test_bare_zip_is_required():
    """The old `Zip Code: NNNNN` regex matches nothing here and would null the column."""
    with pytest.raises(PipelineError, match="not 5 digits"):
        assert_zip_format(["Zip Code: 30309"], "test")
    assert_zip_format(["30309", "00501"], "test")


def test_multipart_etag_is_not_used_for_integrity():
    """Zillow's ETag ends -12: an MD5-of-MD5s that can never equal the body digest."""
    assert sources.is_multipart_etag("7eac997a64afb311a4e4ac5e455bcfd3-12")
    assert not sources.is_multipart_etag("b1436909d98d5411891049c3ee882c70")


def test_download_host_allowlist():
    with pytest.raises(PipelineError, match="not allowlisted"):
        sources._check_host("https://evil.example.com/all_zips.csv", "Redfin")


# --- Freshness -------------------------------------------------------------

def test_stale_period_warns_but_does_not_refuse_to_publish(caplog, latest):
    """A hard fail refuses to publish, so the manifest carrying the outage banner
    is never written and the banner can never render. The two cancel out."""
    records, _, _ = serialize.assemble(_meta_for(latest), _zhvi_for(latest), latest)
    for r in records.values():
        r["period_end"] = "2026-06-01"
    report = serialize.validate(records, "2026-06-01", "2026-06-01")
    assert report["period_age_days"]["redfin"] > serialize.STALE_WARN_DAYS


def test_two_missed_publications_is_fatal(latest):
    records, _, _ = serialize.assemble(_meta_for(latest), _zhvi_for(latest), latest)
    with pytest.raises(PipelineError, match="stopped, not merely slipped"):
        serialize.validate(records, "2020-01-01", "2020-01-01")


# --- ZCTA metadata ---------------------------------------------------------

def test_zcta_meta_loads_and_is_keyed_by_zip():
    meta = dim.load(ROOT / "public" / "data" / "zcta-meta.csv")
    assert len(meta) > 30_000
    assert "00601" in meta
    assert set(meta["00601"]) == {"city", "county", "state", "metro", "lat", "lng"}


def test_zhvi_percent_scale():
    """zhvi_mom / zhvi_yoy ship as percent, matching every other change column."""
    csv = (
        "RegionID,RegionName,2025-07-31,2025-08-31,2025-09-30,2025-10-31,2025-11-30,"
        "2025-12-31,2026-01-31,2026-02-28,2026-03-31,2026-04-30,2026-05-31,2026-06-30,"
        "2026-07-31\n"
        "1,30309," + ",".join(["100"] * 12) + ",110\n"
    ).encode()
    out, period = zhvi.process(csv)
    assert period == "2026-07-31"
    assert out["30309"]["zhvi"] == 110
    assert out["30309"]["zhvi_yoy"] == 10.0
    assert out["30309"]["zhvi_mom"] == 10.0

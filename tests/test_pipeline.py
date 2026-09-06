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

def test_snapshot_is_50_columns_and_carries_no_redfin_mom():
    f = serialize.SNAPSHOT_COLUMNS
    assert len(f) == 50
    assert len(set(f)) == 50
    # Redfin publishes no MoM at ZIP level: 0 non-null cells in 4,930,000 x 14.
    # ZHVI does, because it is smoothed and seasonally adjusted on real months.
    assert not [k for k in f if k.endswith("_mom") and k != "zhvi_mom"]
    assert "zhvi_mom" in f
    for new in ("al", "mos", "lppsf"):
        assert new in f


def test_every_redfin_metric_has_a_level_and_a_yoy_on_the_wire():
    """Both halves of every metric survive the projection to short names."""
    for key in LEVELS.values():
        assert key in serialize.SOURCE_OF.values(), key
        assert f"{key}_yoy" in serialize.SOURCE_OF.values(), key


def test_every_column_declares_a_scale():
    """A missing scale is SILENT: the column decodes unscaled and a 4.6% relative
    standard error reaches the popup as the number 46."""
    for name in serialize.SNAPSHOT_COLUMNS:
        assert name in serialize.SCALES, name


def test_breaks_may_only_name_painted_columns():
    """A break set for an unpainted column implies a legend that does not exist."""
    assert set(serialize.PAINTED_SHORT.values()) <= set(serialize.SNAPSHOT_COLUMNS)
    assert len(serialize.PAINTED_SHORT) == 9


def _envelope(**over):
    base = {"built_utc": "2026-09-05T00:00:00Z", "period_start": "2026-05-01",
            "period_end": "2026-07-31", "frequency": "Rolling 3 Months",
            "vintage": "2026-08-03", "zhvi_month": "2026-07-31",
            "classes": 7, "breaks": {}, "classing": {}}
    base.update(over)
    return base


def test_snapshot_round_trips_and_keeps_leading_zeros(tmp_path, latest):
    meta = {z: {"city": "X", "county": "Y", "state": "NY", "metro": None,
                "lat": 1.0, "lng": -2.0} for z in ["00501", "07002", "30309"]}
    records, period, coverage = serialize.assemble(meta, {}, latest)
    out = tmp_path / "zip-data.json"
    serialize.write_snapshot(records, out, _envelope())
    back = json.loads(out.read_text(encoding="utf-8"))
    assert "00501" in back["z"], "leading zero destroyed — ZIP was read as an integer"
    assert back["f"] == serialize.SNAPSHOT_COLUMNS
    # COLUMN-major: 50 arrays each as long as z, not one row per ZIP.
    assert len(back["d"]) == 50
    assert all(len(col) == len(back["z"]) for col in back["d"])


def test_null_is_not_zero_on_the_wire(tmp_path, latest):
    """The failure a one-pass Int32Array conversion causes: `0` is a legal value
    for homes_sold, median_dom, sold_above_list, cov, rel and lisa, so mapping
    null to 0 destroys real zeros."""
    meta = {z: {"city": "X", "county": "Y", "state": "NY", "metro": None,
                "lat": 1.0, "lng": -2.0} for z in ["00501", "07002", "30309"]}
    records, _, _ = serialize.assemble(meta, {}, latest)
    records["00501"]["median_dom"] = 0
    records["07002"]["median_dom"] = None

    out = tmp_path / "zip-data.json"
    serialize.write_snapshot(records, out, _envelope())
    back = json.loads(out.read_text(encoding="utf-8"))

    j = back["f"].index("dom")
    row = {z: i for i, z in enumerate(back["z"])}
    assert back["d"][j][row["00501"]] == 0
    assert back["d"][j][row["07002"]] == back["null_sentinel"]
    assert back["null_sentinel"] == serialize.NULL_SENTINEL


def test_unpainted_breaks_are_refused(tmp_path, latest):
    meta = {z: {"city": "X", "county": "Y", "state": "NY", "metro": None,
                "lat": 1.0, "lng": -2.0} for z in ["00501", "07002", "30309"]}
    records, _, _ = serialize.assemble(meta, {}, latest)
    with pytest.raises(PipelineError, match="unpainted column"):
        serialize.write_snapshot(
            records, tmp_path / "x.json",
            _envelope(breaks={"mlp": [1, 2, 3, 4, 5, 6]}),
        )


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


# --- The headline bug's regression test ------------------------------------

def test_30309_reports_the_all_residential_truth(ingested):
    """The ZIP the property-type bug was first caught on.

    At PERIOD END 2026-05-31 the live site published **$360,000 across 105 sales**
    for 30309. The all-residential truth is **$402,500 across 146 sales**. The
    published figure was whichever property type an unstable quicksort happened to
    leave last in its chunk, so it was not merely wrong, it was a DIFFERENT wrong
    number on every run — which is why the value here does not match the one the
    spec quotes ($575,000 across 9 sales, a Townhouse row observed on some earlier
    run of the same broken code).

    This test does not re-check the arithmetic; it checks that the pipeline reads
    the aggregate row and reduces nothing. There is exactly one row per
    (period, ZIP) in this feed and `assert_unique_key` proves it, so there is no
    selection left to get wrong.
    """
    import csv
    rows = [r for r in csv.DictReader(SAMPLE.open(encoding="utf-8"))
            if r["REGION NAME"] == "30309" and r["PERIOD END"] == "2026-05-31"]
    assert len(rows) == 1, (
        f"{len(rows)} rows for (30309, 2026-05-31) — a breakout dimension has "
        f"returned and every reduction in this pipeline is now picking arbitrarily"
    )
    row = rows[0]
    assert coerce("median_sale_price", row["MEDIAN SALE PRICE NSA ($)"]) == 402_500
    assert coerce("homes_sold", row["HOMES SOLD"]) == 146

    # And the number the broken pipeline published is not reachable from this row.
    assert coerce("median_sale_price", row["MEDIAN SALE PRICE NSA ($)"]) != 360_000


def test_every_fixture_zip_has_exactly_one_row_per_period():
    """The property-type bug in one assertion, across the whole fixture.

    The old feed carried five rows per (ZIP, period) and the code deduplicated on
    ZIP alone. If this feed ever grows a second row for any (ZIP, period), every
    downstream number becomes a coin flip again.
    """
    import csv
    from collections import Counter
    counts = Counter(
        (r["REGION NAME"], r["PERIOD END"])
        for r in csv.DictReader(SAMPLE.open(encoding="utf-8"))
    )
    dupes = {k: v for k, v in counts.items() if v > 1}
    assert not dupes, f"duplicate (ZIP, period) keys: {dupes}"


# --- The change report -----------------------------------------------------
# What the old `count_changes` reported was a constant: it iterated SOURCE_KEYS,
# which contains `period_end` — a key with NO wire column — so `live[z]` had
# None there for every ZIP on every run and every Redfin-reporting ZIP read as
# changed by exactly one point. Published forever as 28,919 zips AND 28,919 data
# points, which is the tell: those two can only be equal by accident.

def _published(records, tmp_path):
    """`records` as the live snapshot would come back on the next run."""
    out = tmp_path / "live.json"
    serialize.write_snapshot(records, out, _envelope())
    return serialize.read_live(out)


def _sample_records(latest):
    """A FINISHED build: assembled, then carrying the statistics S5-S5c write.

    `diff` refuses an unfinished one on purpose — seven wire columns have no
    producer until after the diff gate, so diffing at S3 reports them as moved
    for every ZIP."""
    meta = {z: {"city": "X", "county": "Y", "state": "NY", "metro": None,
                "lat": 1.0, "lng": -2.0} for z in latest}
    records, _, _ = serialize.assemble(meta, _zhvi_for(latest), latest)
    for i, rec in enumerate(records.values()):
        rec["msp_rse"] = 0.05
        rec["rel"] = 2
        rec["lisa"] = i % 5
        rec["f_h12"] = 500_000
        rec["f_sigma"] = 0.01
        rec["f_tier"] = 3
    return records


def test_diff_refuses_a_build_whose_statistics_have_not_run(latest):
    """The ordering trap: `rel`, `msp_rse`, `dom_rse`, `f_h12`, `f_sigma`,
    `f_tier` and `lisa` are wire columns written AFTER the diff gate. Diffing
    before them reports seven columns as moved for every ZIP, which reads as a
    plausible data change rather than a staging mistake."""
    meta = {z: {"city": "X", "county": "Y", "state": "NY", "metro": None,
                "lat": 1.0, "lng": -2.0} for z in latest}
    unfinished, _, _ = serialize.assemble(meta, _zhvi_for(latest), latest)
    with pytest.raises(PipelineError, match="statistics stages have not run"):
        serialize.diff(None, unfinished)


def test_rebuilding_the_same_data_reports_no_change(tmp_path, latest):
    """The regression that matters. The snapshot quantises; the records do not.
    Comparing one against the other made quantisation look like movement, and
    `period_end` made it look like movement for every reporting ZIP."""
    records = _sample_records(latest)
    live = _published(records, tmp_path)
    _, decoded = serialize.decode_live(live)

    report = serialize.diff(live, decoded)
    assert report["status"] == serialize.DIFF_COMPARED
    assert report["zips"]["changed"] == 0
    assert report["data_points"] == 0
    assert report["by_column"] == {}


def test_period_end_cannot_inflate_the_change_count(tmp_path, latest):
    """`period_end` has no wire column, so it must not be compared at all."""
    records = _sample_records(latest)
    live = _published(records, tmp_path)
    _, decoded = serialize.decode_live(live)
    assert all("period_end" not in r for r in decoded.values())

    for r in decoded.values():
        r["period_end"] = "1999-12-31"
    assert serialize.diff(live, decoded)["data_points"] == 0


def test_one_moved_cell_is_one_zip_and_one_point(tmp_path, latest):
    records = _sample_records(latest)
    live = _published(records, tmp_path)
    _, decoded = serialize.decode_live(live)

    victim = sorted(decoded)[0]
    decoded[victim]["median_sale_price"] = (decoded[victim]["median_sale_price"] or 0) + 1000
    decoded[victim]["city"] = "Renamed"

    report = serialize.diff(live, decoded)
    assert report["zips"]["changed"] == 1
    assert report["data_points"] == 2
    assert report["by_column"] == {"ci": 1, "msp": 1}


def test_added_and_removed_zips_are_counted_separately(tmp_path, latest):
    records = _sample_records(latest)
    live = _published(records, tmp_path)
    _, decoded = serialize.decode_live(live)

    del decoded[sorted(decoded)[0]]
    decoded["99999"] = {k: None for k in serialize.SOURCE_KEYS}

    report = serialize.diff(live, decoded)
    assert report["zips"]["added"] == 1
    assert report["zips"]["removed"] == 1
    assert report["zips"]["changed"] == 2


def test_a_lost_scale_shows_up_as_one_column_moving_everywhere(tmp_path, latest):
    """The diagnostic the `by_column` map exists for. One column moving for every
    ZIP while nothing else moved is a broken scale, not a market."""
    records = _sample_records(latest)
    live = _published(records, tmp_path)
    _, decoded = serialize.decode_live(live)
    for r in decoded.values():
        if r.get("median_ppsf") is not None:
            r["median_ppsf"] *= 100

    report = serialize.diff(live, decoded)
    assert list(report["by_column"]) == ["ppsf"]
    assert report["by_column"]["ppsf"] == report["data_points"]


def test_no_baseline_is_not_reported_as_unchanged(latest):
    """The old version returned (0, 0) here, and update_data.yml gates both the
    commit and the deploy on that number being positive — so an unreadable live
    snapshot silently skipped publication."""
    report = serialize.diff(None, _sample_records(latest))
    assert report["status"] == serialize.DIFF_NO_BASELINE
    assert report["zips"]["changed"] == report["zips"]["total"] > 0
    assert report["data_points"] is None


def test_a_format_change_is_not_reported_as_movement(tmp_path, latest):
    records = _sample_records(latest)
    live = _published(records, tmp_path)
    live["version"] = serialize.VERSION - 1
    report = serialize.diff(live, records)
    assert report["status"] == serialize.DIFF_FORMAT_CHANGE
    assert report["data_points"] is None


def test_unreadable_live_snapshot_is_absent_not_empty(tmp_path):
    assert serialize.read_live(tmp_path / "nope.json") is None
    broken = tmp_path / "broken.json"
    broken.write_text("{not json", encoding="utf-8")
    assert serialize.read_live(broken) is None
    truncated = tmp_path / "truncated.json"
    truncated.write_text('{"format":"domapus-snapshot"}', encoding="utf-8")
    assert serialize.read_live(truncated) is None


# --- Release identity ------------------------------------------------------

PAINT = {"zhvi": {"sha256": "a" * 64}, "median_sale_price": {"sha256": "b" * 64}}


def test_release_digest_ignores_timestamps_but_not_values(tmp_path, latest):
    records = _sample_records(latest)
    live = _published(records, tmp_path)

    base = serialize.payload_digest(live)
    restamped = {**live, "built_utc": "2099-01-01T00:00:00+00:00"}
    assert serialize.payload_digest(restamped) == base, \
        "a rebuild over identical data must reproduce the digest, or every run publishes"

    moved = {**live, "d": [list(c) for c in live["d"]]}
    moved["d"][live["f"].index("msp")][0] += 1
    assert serialize.payload_digest(moved) != base


def test_release_digest_covers_the_paint_tables(tmp_path, latest):
    """The paint tables are half of what the map renders and are hashed
    separately, so a digest over the snapshot alone would call a release
    unchanged when the colours moved."""
    snap = serialize.payload_digest(_published(_sample_records(latest), tmp_path))
    other = {**PAINT, "zhvi": {"sha256": "c" * 64}}
    assert serialize.release_digest(snap, PAINT) != serialize.release_digest(snap, other)
    assert serialize.release_digest(snap, PAINT) == serialize.release_digest(snap, dict(PAINT))


# --- The diverging scale ---------------------------------------------------

def test_diverging_breaks_are_symmetric_and_reach_the_bound():
    """Shipped as `bound / (EDGES / 2 + 0.5)`, which put the edges at
    -20 -14.29 -8.57 -2.86 +2.86 +8.57: six edges, strictly increasing, passing
    every assertion in `compute()`, and asymmetric. The top class then meant
    ">= +8.57%" on a scale whose whole purpose is that the two sides compare."""
    from pipeline import classify

    edges = classify._diverging_breaks(20.0)
    assert edges == [-20.0, -12.0, -4.0, 4.0, 12.0, 20.0]
    assert edges[0] == -20.0 and edges[-1] == 20.0
    assert [-e for e in reversed(edges)] == edges, "the scale is not symmetric about zero"
    # The neutral class straddles zero and nothing else does.
    assert classify.class_of(0.0, edges) == classify.CLASSES // 2
    steps = [round(b - a, 6) for a, b in zip(edges, edges[1:])]
    assert len(set(steps)) == 1, f"unequal steps {steps}"


def test_diverging_bound_is_reached_at_both_ends():
    """A value at +bound clamps to the top class and -bound to the bottom, which
    is what makes the end swatches' ">= +B%" / "<= -B%" labels true."""
    from pipeline import classify

    edges = classify._diverging_breaks(20.0)
    assert classify.class_of(-25.0, edges) == 0
    assert classify.class_of(25.0, edges) == classify.CLASSES - 1
    assert classify.class_of(19.9, edges) == classify.CLASSES - 2

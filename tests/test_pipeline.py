"""Pipeline tests. Every fixture is real data cut from the real feed — CI never
touches the network.

`tests/fixtures/redfin_sample.csv` is 13 periods x 11 ZIPs. 13 is the minimum
that makes a lag-12 check possible, and the lag-12 check is what proves the
DIVIDE_BY_100 decision rather than asserting it.
"""

import json
from datetime import date, timedelta
from pathlib import Path

import pytest

from pipeline import changes, dim, redfin, serialize, sources, zhvi
from pipeline.contracts import (
    PipelineError,
    RANGES,
    assert_columns_absent,
    assert_ranges,
    assert_zip_format,
)
from pipeline.units import (
    LEVEL_HEADERS,
    METRICS,
    READ_COLUMNS,
    YOY_HEADERS,
    coerce,
    resolve,
)

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "tests" / "fixtures"
SAMPLE = FIXTURES / "redfin_sample.csv"
# The same real rows under the 2026-08 header generation: MEDIAN DAYS ON MARKET YOY renamed
# to "(DAYS)" and rescaled from (now - before) * 100 to a whole-day difference.
SAMPLE_2026_08 = FIXTURES / "redfin_sample_2026_08.csv"


def _header_of(path: Path) -> list[str]:
    return path.read_text(encoding="utf-8").splitlines()[0].split(",")


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


def test_rows_out_of_period_order_are_rejected(tmp_path):
    lines = SAMPLE.read_text(encoding="utf-8").splitlines()
    shuffled = tmp_path / "order.csv"
    shuffled.write_text("\n".join(lines[:1] + [lines[-1]] + lines[1:-1]), encoding="utf-8")
    with pytest.raises(PipelineError, match="not descending"):
        redfin.ingest(shuffled, tmp_path / "p.parquet")


def test_zip_without_leading_zero_is_rejected(tmp_path):
    header, first, *rest = SAMPLE.read_text(encoding="utf-8").splitlines()
    cols = first.split(",")
    cols[header.split(",").index("REGION NAME")] = "501"
    bad = tmp_path / "zip.csv"
    bad.write_text("\n".join([header, ",".join(cols), *rest]), encoding="utf-8")
    with pytest.raises(PipelineError, match="not 5 digits"):
        redfin.ingest(bad, tmp_path / "p.parquet")


def test_property_type_column_reappearing_is_rejected():
    with pytest.raises(PipelineError, match="REAPPEARED"):
        assert_columns_absent(["PERIOD END", "PROPERTY TYPE"], "test")


# --- Units: the part that silently corrupts if rushed ----------------------

def _lag12_from(path):
    """(now, before) keyed by ZIP in OUR key namespace, from a fixture's newest period and
    the one twelve back. What `changes._derive_scale` and `_reconcile` consume."""
    import csv
    rows = list(csv.DictReader(path.open(encoding="utf-8")))
    binding = resolve(rows[0].keys(), PipelineError)
    by = {}
    for r in rows:
        by.setdefault(r["REGION NAME"], {})[r["PERIOD END"]] = r
    ps = sorted({r["PERIOD END"] for r in rows}, reverse=True)
    t, lag = ps[0], ps[changes.LAG]

    def num(row, header):
        v = (row.get(header) or "").strip()
        try:
            return float(v)
        except ValueError:
            return None

    now, before = {}, {}
    for zip_code, series in by.items():
        a, b = series.get(t), series.get(lag)
        if not a or not b:
            continue
        now[zip_code] = {
            **{m: num(a, binding.level[m]) for m in changes.DIFFERENCE},
            **{f"{m}_yoy": num(a, binding.yoy[m]) for m in changes.DIFFERENCE
               if binding.yoy[m]},
        }
        before[zip_code] = {m: num(b, binding.level[m]) for m in changes.DIFFERENCE}
    return now, before


@pytest.mark.parametrize(
    "fixture, dom_scale",
    [(SAMPLE, 100.0), (SAMPLE_2026_08, 1.0)],
    ids=["2026-07 feed", "2026-08 feed"],
)
def test_difference_family_scale_is_derived_from_the_data(fixture, dom_scale):
    """The scale of Redfin's DOM and months-of-supply YoY columns is MEASURED per release.

    Both fixtures hold the same real rows. In the 2026-07 generation the DOM column is
    "(%)" carrying (now - before) * 100; in the 2026-08 generation it is "(DAYS)" carrying a
    whole-day difference. Nothing but the data distinguishes them, which is the point: a
    declared divisor was wrong about this for a release and no contract could see it, because
    `changes.recompute` overwrites the column before anything reads it.
    """
    now, before = _lag12_from(fixture)
    assert changes._derive_scale("median_dom", now, before)["scale"] == dom_scale
    # Months of supply is still "(%)" and still x100 in both generations.
    assert changes._derive_scale("months_of_supply", now, before)["scale"] == 100.0


def test_a_scale_outside_the_candidates_is_refused_not_rounded_to_the_nearest():
    """An unlisted scale means the column stopped being a level difference. Guessing the
    closest candidate would publish a reconciliation that proves nothing."""
    now, before = _lag12_from(SAMPLE)
    bad = {z: {**r, "median_dom_yoy": (r["median_dom_yoy"] or 0) / 14.0}
           for z, r in now.items()}
    with pytest.raises(PipelineError, match="cannot establish the scale"):
        changes._derive_scale("median_dom", bad, before)


def test_coerce_applies_no_scale_correction():
    """`coerce` maps a cell to its wire precision and nothing else. The /100 that used to
    live here was dead — `changes.recompute` overwrites every `*_yoy` from the levels — and
    being dead is how it stayed wrong about median_dom_yoy through a release."""
    assert coerce("median_dom_yoy", -654.0) == -654.0
    assert coerce("months_of_supply_yoy", -8175.0) == -8175.0
    # Precision still applies: integers round, decimals clamp to their declared places.
    assert coerce("median_dom", 43.4) == 43
    assert coerce("months_of_supply", 3.4567) == 3.46


def test_the_feeds_own_yoy_never_reaches_the_wire(tmp_path):
    """The invariant that makes a YoY rename survivable: whatever the feed publishes, the
    shipped value is our own lag-12 computation. Asserted with an absurd feed value so a
    regression cannot pass by coincidence."""
    panel = tmp_path / "panel.parquet"
    _report, rows = redfin.ingest(SAMPLE, panel)
    records = redfin.latest_records(rows)
    for rec in records.values():
        rec["median_dom_yoy"] = 999_999.0
        rec["months_of_supply_yoy"] = 999_999.0

    period = next(iter(records.values()))["period_end"]
    changes.recompute(panel, records, period)

    assert not [z for z, r in records.items() if r["median_dom_yoy"] == 999_999.0], \
        "recompute left the feed's value in place"
    lo, hi = RANGES["median_dom_yoy"]
    for zip_code, rec in records.items():
        v = rec["median_dom_yoy"]
        assert v is None or lo <= v <= hi, (zip_code, v)


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


def test_both_header_generations_bind_to_the_same_keys():
    """A renamed column must not stop a release. The 2026-09-18 run died on a missing
    `MEDIAN DAYS ON MARKET YOY (%)` — a column whose value is discarded before publication."""
    old = resolve(_header_of(SAMPLE), PipelineError)
    new = resolve(_header_of(SAMPLE_2026_08), PipelineError)

    assert old.yoy["median_dom"] == "MEDIAN DAYS ON MARKET YOY (%)"
    assert new.yoy["median_dom"] == "MEDIAN DAYS ON MARKET YOY (DAYS)"
    assert not new.aliased, "the newest spelling must be listed first in YOY_HEADERS"
    assert old.aliased == {"median_dom_yoy": "MEDIAN DAYS ON MARKET YOY (%)"}
    for b in (old, new):
        assert set(b.level) == set(METRICS)
        assert not b.missing_yoy
        assert len(b.read_columns) == 36


def test_a_missing_level_stops_the_run_and_a_missing_yoy_does_not():
    """Criticality follows the dependency: the levels are the published wire, the YoY columns
    are evidence for a check."""
    header = _header_of(SAMPLE)

    without_yoy = [c for c in header if c != "MEDIAN DAYS ON MARKET YOY (%)"]
    b = resolve(without_yoy, PipelineError)
    assert b.missing_yoy == ["median_dom"]
    assert b.yoy["median_dom"] is None
    assert len(b.read_columns) == 35

    without_level = [c for c in header if c != "MEDIAN DAYS ON MARKET (DAYS)"]
    with pytest.raises(PipelineError, match="LEVEL column"):
        resolve(without_level, PipelineError)


def test_a_missing_level_error_names_the_near_miss():
    """The 2026-09-18 failure printed all 50 columns and left the reader to spot the rename."""
    header = [c if c != "MEDIAN DAYS ON MARKET (DAYS)" else "MEDIAN DAYS ON MARKET (D)"
              for c in _header_of(SAMPLE)]
    with pytest.raises(PipelineError, match=r"Closest in file: \['MEDIAN DAYS ON MARKET \(D\)'"):
        resolve(header, PipelineError)


def test_a_yoy_column_the_feed_drops_becomes_a_null_panel_column(tmp_path):
    """The panel's schema is fixed across releases. A column that VANISHES crashes `changes`
    and `noise` three stages later; an all-null column reads cleanly and is reported."""
    import csv

    import pyarrow.parquet as pq

    rows = list(csv.reader(SAMPLE.open(encoding="utf-8", newline="")))
    drop = rows[0].index("MEDIAN DAYS ON MARKET YOY (%)")
    trimmed = tmp_path / "no_dom_yoy.csv"
    with trimmed.open("w", encoding="utf-8", newline="") as f:
        csv.writer(f, lineterminator="\n").writerows(
            [r[:drop] + r[drop + 1:] for r in rows]
        )

    panel = tmp_path / "panel.parquet"
    report, latest_rows = redfin.ingest(trimmed, panel)
    assert report["binding"]["missing_yoy"] == ["median_dom"]

    tbl = pq.read_table(panel)
    assert tbl.column_names == redfin.PANEL_COLUMNS
    assert tbl["median_dom_yoy"].null_count == tbl.num_rows
    assert tbl["median_dom"].null_count < tbl.num_rows
    assert redfin.latest_records(latest_rows)[latest_rows[0]["REGION NAME"]][
        "median_dom_yoy"] is None


# --- Output shape ----------------------------------------------------------

def test_snapshot_is_49_columns_and_carries_no_redfin_mom():
    f = serialize.SNAPSHOT_COLUMNS
    assert len(f) == 49
    assert len(set(f)) == 49
    # Redfin publishes no MoM at ZIP level: 0 non-null cells in 4,930,000 x 14.
    # ZHVI does, because it is smoothed and seasonally adjusted on real months.
    assert not [k for k in f if k.endswith("_mom") and k != "zhvi_mom"]
    assert "zhvi_mom" in f
    for new in ("al", "mos", "lppsf"):
        assert new in f


def test_every_redfin_metric_has_a_level_and_a_yoy_on_the_wire():
    """Both halves of every metric survive the projection to short names."""
    for key in METRICS:
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
    assert len(serialize.PAINTED_SHORT) == 8


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
    # COLUMN-major: 49 arrays each as long as z, not one row per ZIP.
    assert len(back["d"]) == 49
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


def test_the_probed_header_parses_to_the_same_names_pyarrow_reads():
    """S0 binds columns off the 1 MB probe so a rename costs 0.2 s instead of a 1.33 GB
    download. That only works if the probe's raw first line is read the way pyarrow reads
    it: Redfin quotes every field, so splitting on commas yields '"LAST UPDATED"' and
    matches nothing."""
    quoted = ",".join(f'"{c}"' for c in _header_of(SAMPLE))
    assert sources.probe_header({"header": quoted}) == _header_of(SAMPLE)
    # Unquoted files parse the same way, and an empty probe is empty rather than [''].
    assert sources.probe_header({"header": "A,B,C"}) == ["A", "B", "C"]
    assert sources.probe_header({"header": ""}) == []
    # End to end: the quoted live-shaped header must bind.
    assert resolve(sources.probe_header({"header": quoted}), PipelineError).level


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


def _recent_month_end(months_back: int) -> str:
    """A real month end, `months_back` months before this one. Relative to today
    so these tests do not silently start tripping MAX_PERIOD_AGE_DAYS."""
    first = date.today().replace(day=1)
    for _ in range(months_back):
        first = (first - timedelta(days=1)).replace(day=1)
    return (first - timedelta(days=1)).isoformat()


def test_one_month_apart_warns_but_still_publishes(latest):
    """Redfin publishes early in the month and ZHVI on the 16th. A run that lands
    between them sees one feed ahead; fresh Redfin beside a month-old ZHVI still
    beats republishing last month's everything."""
    records, _, _ = serialize.assemble(_meta_for(latest), _zhvi_for(latest), latest)
    report = serialize.validate(records, _recent_month_end(1), _recent_month_end(2))
    assert report["period_gap_months"] == 1


def test_two_months_apart_is_fatal(latest):
    records, _, _ = serialize.assemble(_meta_for(latest), _zhvi_for(latest), latest)
    with pytest.raises(PipelineError, match="broken feed, not a late one"):
        serialize.validate(records, _recent_month_end(1), _recent_month_end(3))


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
    out, period = zhvi.process(*zhvi.read(csv))
    assert period == "2026-07-31"
    assert out["30309"]["zhvi"] == 110
    assert out["30309"]["zhvi_yoy"] == 10.0
    assert out["30309"]["zhvi_mom"] == 10.0


def test_zhvi_missing_or_zero_base_reports_no_change():
    """A missing or zero base is "no change to report", not a division. The
    vectorised path gets NaN and +/-inf where the row-at-a-time one short-circuited."""
    months = ["2025-07-31", "2025-08-31", "2025-09-30", "2025-10-31", "2025-11-30",
              "2025-12-31", "2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30",
              "2026-05-31", "2026-06-30", "2026-07-31"]
    csv = ("RegionID,RegionName," + ",".join(months) + "\n"
           + "1,30309,0," + ",".join(["100"] * 10) + ",,110\n"      # zero yoy base, no prev
           + "2,601," + ",".join(["100"] * 12) + ",110\n").encode()
    out, _ = zhvi.process(*zhvi.read(csv))
    assert out["30309"] == {"zhvi": 110, "zhvi_mom": None, "zhvi_yoy": None}
    assert out["00601"]["zhvi_yoy"] == 10.0


def test_zhvi_panel_is_long_and_drops_nulls(tmp_path):
    """`read` parses once and both consumers share the frame. The panel keeps only
    non-null cells, so a ZIP that started reporting late costs no rows."""
    csv = ("RegionID,RegionName,2026-06-30,2026-07-31\n"
           "1,601,,100\n"
           "2,30309,200,210\n").encode()
    report = zhvi.write_panel(*zhvi.read(csv), tmp_path / "zhvi-panel.parquet")
    assert report["rows"] == 3 and report["zips"] == 2 and report["months"] == 2
    assert report["vintage"] == "2026-07-31"


# --- The headline bug's regression test ------------------------------------

def test_30309_reports_the_all_residential_truth(ingested):
    """The ZIP the property-type bug was first caught on.

    At PERIOD END 2026-05-31 the live site published **$360,000 across 105 sales**
    for 30309. The all-residential truth is **$402,500 across 146 sales**. The
    published figure was whichever property type an unstable quicksort happened to
    leave last in its chunk, so it was not merely wrong, it was a DIFFERENT wrong
    number on every run — which is why the value here does not match the one
    once quoted ($575,000 across 9 sales, a Townhouse row observed on some earlier
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


def test_paint_encode_matches_the_golden_bytes():
    """`golden.test.ts` checks the frontend reader against `paint_50.json`; this is the writer's
    half. Without it, dropping the `+ 1` from the class nibble passed pytest: only
    `assert_files_match_classes`, inside a real run, read the bytes back."""
    from pipeline import classify, paint

    snap = json.loads((ROOT / "tests" / "golden" / "snapshot_50.json").read_text(encoding="utf-8"))
    gold = json.loads((ROOT / "tests" / "golden" / "paint_50.json").read_text(encoding="utf-8"))
    null = snap["null_sentinel"]

    def column(short):
        return snap["d"][snap["f"].index(short)]

    records = {z: {"rel": None if r == null else r} for z, r in zip(snap["z"], column("rel"))}
    for metric, short in serialize.PAINTED_SHORT.items():
        edges, scale = snap["breaks"][short], snap["scales"][short]
        for z, v in zip(snap["z"], column(short)):
            records[z][f"class_{metric}"] = (
                None if v == null else classify.class_of(v / scale, edges)
            )
        table = paint.encode(records, metric)
        got = {z: table[int(z)] for z in snap["z"] if table[int(z)]}
        assert got == gold["bytes"][metric], metric


def test_quantile_breaks_may_tie_and_the_empty_class_stays_empty():
    """2026-03: 15.1% of ZIPs sold exactly one home, more than 1/14, so two `homes_sold`
    quantiles land on 1.0. Refusing that failed every December-May period."""
    import numpy as np

    from pipeline import classify

    rng = np.random.default_rng(0)
    counts = np.concatenate([np.ones(160), rng.integers(2, 400, 840)]).astype(float)
    records = {}
    for i, c in enumerate(counts):
        rec = {m: None for m in classify.PAINTED}
        rec.update(zhvi=1e5 + i * 100, median_sale_price=1e5 + i * 100, median_ppsf=100 + i,
                   median_dom=10 + i % 90, sold_above_list=i % 100,
                   months_of_supply=1 + i % 12, active_listings=1 + i % 50,
                   homes_sold=c, rel=2)
        records[f"{i:05d}"] = rec

    out = classify.compute(records)["classing"]["homes_sold"]
    edges = out["breaks"]
    assert any(a == b for a, b in zip(edges, edges[1:])), "the sample was meant to tie"
    assert all(a <= b for a, b in zip(edges, edges[1:]))
    assert sum(out["class_counts"]) == len(counts)
    tied = [i + 1 for i, (a, b) in enumerate(zip(edges, edges[1:])) if a == b]
    assert all(out["class_counts"][k] == 0 for k in tied)


def test_non_quantile_schemes_still_refuse_ties():
    from pipeline import classify
    from pipeline.contracts import PipelineError

    records = {}
    for i in range(100):
        rec = {m: 1.0 + i for m in classify.PAINTED}
        rec.update(median_sale_price=250_000.0, rel=2)
        records[f"{i:05d}"] = rec
    with pytest.raises(PipelineError):
        classify.compute(records)


def _release(computed: dict, previous: dict, previously_held: set | None):
    """One run of the hold rule. `computed` is {zip: class} as Moran's I came out;
    returns what would be published and what the manifest would record as held."""
    import numpy as np

    from pipeline import spatial

    zips = sorted(computed)
    cls = np.array([computed[z] for z in zips], dtype=np.int8)
    cls, held = spatial._apply_hysteresis(cls, zips, previous, previously_held)
    return {z: int(c) for z, c in zip(zips, cls)}, set(held)


def test_lisa_hysteresis_releases_after_one_hold():
    """HH that computes ns is held one release, then let go — the bug was that the held
    class came back as `previous` next month and was held again, forever."""
    computed_ns = {"10001": 0}

    # Release 1: really HH. Nothing to hold.
    pub1, held1 = _release({"10001": 1}, previous={}, previously_held=set())
    assert pub1 == {"10001": 1} and held1 == set()

    # Release 2: computes ns, was HH, not yet held. HOLD.
    pub2, held2 = _release(computed_ns, previous=pub1, previously_held=held1)
    assert pub2 == {"10001": 1}, "a one-month drop to ns should not flicker"
    assert held2 == {"10001"}

    # Release 3: computes ns again. It is in `previously_held`, so the hold expires.
    pub3, held3 = _release(computed_ns, previous=pub2, previously_held=held2)
    assert pub3 == {"10001": 0}, "the hold must expire after one release, not persist"
    assert held3 == set()


def test_lisa_hysteresis_holds_again_only_after_a_real_class():
    """Re-arming: a ZIP that goes back to significant on its own is eligible to be held
    again, so the rule damps repeated borderline runs rather than firing once per ZIP."""
    pub1, held1 = _release({"10001": 2}, previous={}, previously_held=set())
    pub2, held2 = _release({"10001": 0}, previous=pub1, previously_held=held1)
    assert pub2["10001"] == 2 and held2 == {"10001"}

    # Significant again, computed not held, so the held set empties.
    pub3, held3 = _release({"10001": 2}, previous=pub2, previously_held=held2)
    assert pub3["10001"] == 2 and held3 == set()

    pub4, held4 = _release({"10001": 0}, previous=pub3, previously_held=held3)
    assert pub4["10001"] == 2 and held4 == {"10001"}


def test_lisa_hysteresis_holds_nothing_when_the_held_set_is_unknown():
    """`manifest.spatial.held` is absent on releases older than the rule. Unknown is not
    empty: holding then would hold the previous run's held ZIPs for a second release."""
    pub, held = _release({"10001": 0}, previous={"10001": 1}, previously_held=None)
    assert pub == {"10001": 0} and held == set()

    # Known-empty is the ordinary case and still holds.
    pub, held = _release({"10001": 0}, previous={"10001": 1}, previously_held=set())
    assert pub == {"10001": 1} and held == {"10001"}


def test_lisa_same_month_rebuild_reproduces_the_live_holds():
    """A `force_rebuild` of the live period used to read the live release as last month
    and release every hold it had made, changing `lisa` and the digest over unchanged data."""
    from pipeline import spatial

    # Month N-1 published 10001 as HH (1). Month N computes ns and holds it.
    computed_n = {"10001": 0, "10002": 2, "10003": 0}
    live, live_held = _release(computed_n, previous={"10001": 1}, previously_held=set())
    assert live["10001"] == 1 and live_held == {"10001"}

    # Rebuild of month N over the same input: same classes, same held set.
    prev, held_in = spatial.hysteresis_inputs(live, sorted(live_held), "2026-08-31", "2026-08-31")
    assert _release(computed_n, prev, held_in) == (live, live_held)

    # The next real month still expires the hold.
    prev, held_in = spatial.hysteresis_inputs(live, sorted(live_held), "2026-08-31", "2026-09-30")
    pub, held = _release(computed_n, prev, held_in)
    assert pub["10001"] == 0 and held == set()

    # A rebuild over a live release with no `held` key knows nothing: hold nothing.
    assert spatial.hysteresis_inputs(live, None, "2026-08-31", "2026-08-31") == ({}, None)


def test_noise_measure_writes_a_tier_every_record_can_be_read_by(tmp_path, latest, monkeypatch):
    """`noise.measure` had no test. Every published ZIP needs `rel`, including one with no
    sales, and `msp_rse` must be K / sqrt(n) for the K it reports. The 13-period fixture is
    too short for the lag-7 fit, so K is fixed and only the write-back is under test."""
    from pipeline import noise

    panel = tmp_path / "panel.parquet"
    redfin.ingest(SAMPLE, panel)
    monkeypatch.setattr(noise, "calibrate", lambda L, N: {"K": 0.5, "plateau_ratio": 1.0})
    monkeypatch.setattr(noise, "measure_per_metric", lambda *a: {})
    records = {z: dict(r) for z, r in latest.items()}
    records["99998"] = {"homes_sold": None}
    fit = noise.measure(panel, records)

    assert sum(fit["tiers"].values()) == len(records)
    assert records["99998"]["rel"] == 0 and records["99998"]["msp_rse"] is None
    for rec in records.values():
        assert rec["rel"] in (0, 1, 2, 3)
        if rec.get("homes_sold"):
            assert rec["msp_rse"] == pytest.approx(fit["K"] / rec["homes_sold"] ** 0.5, abs=1e-6)
            assert rec["rel"] == noise.tier_of(rec["msp_rse"])


def test_history_buckets_carry_full_length_series(tmp_path):
    """`history.write` had no test. The chart reads each series against the shared axes in
    index.json, so a short array would silently shift every point."""
    from pipeline import history

    panel = tmp_path / "panel.parquet"
    redfin.ingest(SAMPLE, panel)
    zcsv = ("RegionID,RegionName,2026-06-30,2026-07-31\n"
            "1,30309,400000,410000\n").encode()
    zpanel = tmp_path / "zhvi-panel.parquet"
    zhvi.write_panel(*zhvi.read(zcsv), zpanel)

    out = tmp_path / "history"
    out.mkdir()
    (out / "9999.json").write_text("{}", encoding="utf-8")
    records = {"30309": {"f_h1": 1.0, "f_h3": 2.0, "f_h6": 3.0, "f_h12": 4.0, "f_sigma": 0.05}}
    report = history.write(panel, zpanel, records, out, q_table={})

    assert not (out / "9999.json").exists(), "last run's buckets are removed first"
    index = json.loads((out / "index.json").read_text(encoding="utf-8"))
    assert index["zhvi_months"] == ["2026-06-30", "2026-07-31"]
    bucket = json.loads((out / "3030.json").read_text(encoding="utf-8"))
    rec = bucket["zips"]["30309"]
    assert len(rec["msp"]) == len(index["periods"]) == report["periods"] == 13
    assert rec["zhvi"] == [400000, 410000]
    assert rec["f"] == [1.0, 2.0, 3.0, 4.0] and rec["sig"] == 500
    assert all(len(p.stem) == 4 for p in out.glob("*.json") if p.stem != "index")


def _spatial_records():
    """A 20x20 grid of rankable ZIPs with one expensive 5x5 corner, plus one thin ZIP."""
    import numpy as np

    rng = np.random.default_rng(1)
    records = {}
    for r in range(20):
        for c in range(20):
            hot = r < 5 and c < 5
            records[f"{r:02d}{c:03d}"] = {
                "lat": 40.0 + r * 0.05, "lng": -90.0 + c * 0.05, "rel": 2, "homes_sold": 30,
                "median_sale_price": float((2_000_000 if hot else 200_000) * rng.uniform(0.9, 1.1)),
            }
    records["99999"] = {"lat": 40.1, "lng": -89.9, "rel": 0, "homes_sold": 2,
                        "median_sale_price": 5_000_000.0}
    return records


def test_spatial_run_finds_the_cluster_and_skips_thin_zips():
    """`spatial.run` had no test: the gate, the class written back and determinism."""
    from pipeline import spatial

    records = _spatial_records()
    report = spatial.run(records)
    hot = [z for z in records if z != "99999" and int(z[:2]) < 5 and int(z[2:]) < 5]

    assert report["n"] == 400, "the thin ZIP must not enter the graph"
    assert records["99999"]["lisa"] is None
    assert sum(records[z]["lisa"] == 1 for z in hot) >= 20, "the expensive corner is HH"
    assert report["held"] == [] and report["class_counts"]["HH"] >= 20

    again = _spatial_records()
    spatial.run(again)
    assert {z: r["lisa"] for z, r in again.items()} == {z: r["lisa"] for z, r in records.items()}, \
        "seeded permutations: a rebuild over the same input must reproduce the classes"


def test_spatial_run_refuses_a_graph_it_cannot_build():
    from pipeline import spatial
    from pipeline.contracts import PipelineError

    records = dict(list(_spatial_records().items())[:30])
    with pytest.raises(PipelineError, match="rankable"):
        spatial.run(records)


def test_closed_form_ar1_matches_statsmodels():
    """The forecast is a hand-written geometric sum instead of a library call because
    statsmodels measured 1,245x slower per series. This is the check that buys that:
    given the SAME (mu, rho), our closed form must reproduce statsmodels' own AR(1)
    recursion. It tests the recursion, not the estimator — `fit` shrinks and clips rho,
    so the parameters are ours and only the arithmetic on top of them is compared.
    """
    import numpy as np
    from statsmodels.tsa.statespace.sarimax import SARIMAX

    from pipeline import forecast

    # Three ZIPs with different growth persistence, on the log level scale `fit` expects.
    rng = np.random.default_rng(7)
    T = 120
    LZ = np.empty((T, 3))
    for j, (rho, mu) in enumerate(((0.3, 0.002), (0.7, 0.004), (0.9, 0.001))):
        g = np.empty(T - 1)
        g[0] = mu
        for t in range(1, T - 1):
            g[t] = mu + rho * (g[t - 1] - mu) + rng.normal(0, 0.002)
        LZ[:, j] = np.log(200_000.0) + np.concatenate(([0.0], np.cumsum(g)))

    out = forecast.fit(LZ)
    growth = np.diff(LZ, axis=0)

    for j in range(3):
        mu, rho, sigma = out["mu"][j], out["rho"][j], out["sigma"][j]
        # SARIMAX trend="c" parameterises as g_t = intercept + rho*g_{t-1} + e,
        # so the intercept is mu*(1 - rho). sigma2 does not move a point forecast.
        res = SARIMAX(growth[-forecast.W:, j], order=(1, 0, 0), trend="c").filter(
            np.array([mu * (1.0 - rho), rho, sigma**2])
        )
        # Growth forecasts accumulate onto the last observed log level.
        expected = LZ[-1, j] + np.cumsum(res.forecast(max(forecast.HORIZONS)))
        for i, h in enumerate(forecast.HORIZONS):
            assert out["f"][i, j] == pytest.approx(expected[h - 1], abs=1e-9), (
                f"horizon {h}, column {j}: closed form {out['f'][i, j]} vs "
                f"statsmodels {expected[h - 1]}"
            )

"""Redfin ingest: stream the 1.33 GB CSV once into `panel.parquet`, keep the latest period.

Asserts (PERIOD END, REGION NAME) is unique before any reduction. Batches stream to disk;
the uniqueness check reads back only the two key columns.
"""

import logging
import math
from pathlib import Path

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.csv as pacsv
import pyarrow.parquet as pq

from .contracts import (
    OPTIONAL_CONSTANTS,
    GRAINS,
    PipelineError,
    RANGES,
    assert_columns_absent,
    assert_constants,
    assert_unique_key,
    assert_zip_format,
)
from .units import METRICS, resolve

log = logging.getLogger(__name__)

BLOCK_SIZE = 8 << 20

PRICE_METRICS = ("median_sale_price", "median_ppsf", "median_list_price", "median_list_ppsf")
# At most one in 1,000 observed prices per metric/month may be omitted.
# The cached 2012-2026 panel's worst rate is 8/24,563 (0.033%).
MAX_INVALID_PRICE_SHARE = 0.001

# String types so "00501" keeps its leading zeros.
FORCED_TYPES = {
    "LAST UPDATED": pa.string(),
    "FREQUENCY": pa.string(),
    "PERIOD BEGIN": pa.string(),
    "PERIOD END": pa.string(),
    "REGION TYPE": pa.string(),
    "REGION NAME": pa.string(),
    "METRO": pa.string(),
}

# Keep the panel schema fixed across releases; absent feed YoY columns stay null.
PANEL_LEVELS = list(METRICS)
PANEL_YOY = [f"{k}_yoy" for k in PANEL_LEVELS]
PANEL_COLUMNS = ["zip", "period_end"] + PANEL_LEVELS + PANEL_YOY

PANEL_SCHEMA = pa.schema(
    [("zip", pa.string()), ("period_end", pa.string())]
    + [(c, pa.float64()) for c in PANEL_LEVELS + PANEL_YOY]
)


def read_header(path: Path) -> list[str]:
    """Column names only. Cheap enough to do before committing to a full read."""
    with pacsv.open_csv(path, read_options=pacsv.ReadOptions(block_size=1 << 20)) as r:
        return list(r.schema.names)


def _rename_batch(batch: pa.RecordBatch, binding) -> pa.RecordBatch:
    """Map feed headers to the fixed panel schema, filling absent YoY columns with null."""
    def col(header):
        return batch.column(batch.schema.get_field_index(header)).cast(pa.float64())

    nulls = None
    cols = [batch.column(batch.schema.get_field_index("REGION NAME")),
            batch.column(batch.schema.get_field_index("PERIOD END"))]
    cols.extend(col(binding.level[key]) for key in METRICS)
    for key in METRICS:
        header = binding.yoy[key]
        if header is not None:
            cols.append(col(header))
        else:
            if nulls is None:
                nulls = pa.nulls(batch.num_rows, type=pa.float64())
            cols.append(nulls)
    return pa.RecordBatch.from_arrays(cols, schema=PANEL_SCHEMA)


def _clean_prices(tbl: pa.Table, binding, quality: dict) -> pa.Table:
    """Null unusable prices before either the snapshot or panel can consume them."""
    for metric in PRICE_METRICS:
        header = binding.level[metric]
        values = tbl[header].cast(pa.float64())
        lo, hi = RANGES[metric]
        valid = pc.and_(pc.is_finite(values),
                        pc.and_(pc.greater_equal(values, lo), pc.less_equal(values, hi)))
        invalid = pc.fill_null(pc.invert(valid), False)
        counts = pa.table({
            "period": tbl["PERIOD END"],
            "observed": pc.cast(pc.is_valid(values), pa.int64()),
            "invalid": pc.cast(invalid, pa.int64()),
        }).group_by("period").aggregate([("observed", "sum"), ("invalid", "sum")])
        for row in counts.to_pylist():
            entry = quality.setdefault((metric, row["period"]),
                                       {"observed": 0, "invalid": 0, "samples": []})
            entry["observed"] += row["observed_sum"]
            entry["invalid"] += row["invalid_sum"]
        if not pc.any(invalid).as_py():
            continue
        for row in tbl.select(["PERIOD END", "REGION NAME", header]).filter(invalid).to_pylist():
            samples = quality[metric, row["PERIOD END"]]["samples"]
            if len(samples) < 3:
                value = row[header]
                samples.append({"zip": row["REGION NAME"],
                                "value": value if math.isfinite(value) else str(value)})
        tbl = tbl.set_column(tbl.schema.get_field_index(header), header,
                             pc.if_else(invalid, None, values))
        yoy_header = binding.yoy[metric]
        if yoy_header is not None:
            tbl = tbl.set_column(tbl.schema.get_field_index(yoy_header), yoy_header,
                                 pc.if_else(invalid, None, tbl[yoy_header]))
    return tbl


def _price_quality_report(quality: dict) -> dict:
    """Check complete months, so CSV batch boundaries cannot change acceptance."""
    affected = []
    failures = []
    for (metric, period), entry in sorted(quality.items()):
        if not entry["invalid"]:
            continue
        affected.append({"metric": metric, "period": period, **entry})
        if entry["invalid"] > MAX_INVALID_PRICE_SHARE * entry["observed"]:
            failures.append(
                f"  {metric} {period}: {entry['invalid']}/{entry['observed']} observed "
                f"prices outside {RANGES[metric]}; sample {entry['samples']}"
            )
    if failures:
        raise PipelineError(
            f"redfin_raw: price quarantine exceeds {MAX_INVALID_PRICE_SHARE:.1%} "
            "per metric/month; possible units change or widespread corruption.\n"
            + "\n".join(failures)
        )
    total = sum(e["invalid"] for e in affected)
    if total:
        log.warning("Redfin: quarantined %s price cells across %s metric/month groups; "
                    "levels and their YoY are null; details in price_quality", total, len(affected))
    return {"max_invalid_share": MAX_INVALID_PRICE_SHARE,
            "ranges": {m: list(RANGES[m]) for m in PRICE_METRICS},
            "invalid_cells": total, "affected": affected}


def ingest(csv_path: Path, panel_path: Path) -> tuple[dict, list[dict]]:
    """Stream the CSV to `panel_path`. Returns (report, latest-period rows). Schema checks run first."""
    header = read_header(csv_path)
    assert_columns_absent(header, "redfin_raw")
    binding = resolve(header, PipelineError)
    for key, found in binding.aliased.items():
        log.warning("redfin_raw: %s bound to an older header spelling %r", key, found)
    if binding.missing_yoy:
        log.warning(
            "redfin_raw: %d YoY column(s) not published this release, carried as null: %s. "
            "Nothing published depends on them; `changes` loses that much reconciliation.",
            len(binding.missing_yoy), binding.missing_yoy,
        )

    optional = [c for c in OPTIONAL_CONSTANTS if c in header]
    convert = pacsv.ConvertOptions(
        include_columns=binding.read_columns + optional,
        column_types=FORCED_TYPES | {c: pa.string() for c in optional},
        null_values=["NA", ""],
        strings_can_be_null=True,
    )
    read = pacsv.ReadOptions(block_size=BLOCK_SIZE)

    panel_path.parent.mkdir(parents=True, exist_ok=True)
    rows = 0
    last_updated = set()
    frequency = set()
    prev_period = None
    periods: set[str] = set()
    zips: set[str] = set()
    latest_period = None
    latest_rows: list[dict] = []
    quality: dict = {}
    writer = None

    try:
        with pacsv.open_csv(csv_path, read_options=read, convert_options=convert) as reader:
            for batch in reader:
                if batch.num_rows == 0:
                    continue
                tbl = pa.Table.from_batches([batch])
                assert_constants(tbl, "redfin_raw")
                tbl = tbl.drop_columns(optional)
                last_updated.update(pc.unique(tbl["LAST UPDATED"]).to_pylist())
                # Verbatim for the UI label; the real window is 89-92 days.
                frequency.update(pc.unique(tbl["FREQUENCY"]).to_pylist())

                # Checked in Arrow: materialising these as Python strings cost
                # ~10M objects per run.
                names = batch.column(batch.schema.get_field_index("REGION NAME"))
                ok = pc.match_substring_regex(names, r"^\d{5}$")
                if names.null_count or not pc.all(ok).as_py():
                    assert_zip_format(names.to_pylist(), "redfin_raw REGION NAME")
                zips.update(pc.unique(names).to_pylist())

                ends = batch.column(batch.schema.get_field_index("PERIOD END"))
                first, last = ends[0].as_py(), ends[-1].as_py()
                if prev_period is not None and first > prev_period:
                    raise PipelineError(
                        "redfin_raw: PERIOD END is not descending across batch boundary "
                        f"({prev_period!r} then {first!r}). Row order has changed upstream."
                    )
                if len(ends) > 1:
                    rises = pc.greater(ends.slice(1), ends.slice(0, len(ends) - 1))
                    if pc.any(rises).as_py():
                        i = pc.index(rises, True).as_py() + 1
                        raise PipelineError(
                            f"redfin_raw: PERIOD END is not descending at row {rows + i:,} "
                            f"({ends[i - 1].as_py()!r} then {ends[i].as_py()!r})."
                        )
                prev_period = last
                periods.update(pc.unique(ends).to_pylist())

                tbl = _clean_prices(tbl, binding, quality)
                if latest_period is None:
                    latest_period = first
                if first == latest_period:
                    keep = tbl.filter(pc.equal(tbl["PERIOD END"], latest_period))
                    if keep.num_rows:
                        latest_rows.extend(keep.to_pylist())

                out = _rename_batch(tbl.to_batches()[0], binding)
                if writer is None:
                    writer = pq.ParquetWriter(panel_path, PANEL_SCHEMA, compression="zstd")
                writer.write_batch(out)
                rows += batch.num_rows
    finally:
        if writer is not None:
            writer.close()

    if rows == 0:
        raise PipelineError("redfin_raw: file produced zero rows")
    if len(last_updated) != 1:
        raise PipelineError(
            f"redfin_raw: LAST UPDATED is not uniform across the file: "
            f"{sorted(last_updated)!r}. This file is supposed to carry one vintage."
        )

    keys = pq.read_table(panel_path, columns=["zip", "period_end"])
    assert_unique_key(keys, GRAINS["panel"], "redfin_panel")
    price_quality = _price_quality_report(quality)

    report = {
        "rows": rows,
        "periods": len(periods),
        "zips": len(zips),
        "period_min": min(periods),
        "period_max": max(periods),
        "latest_period": latest_period,
        "latest_zips": len(latest_rows),
        "last_updated": last_updated.pop(),
        "frequency": frequency.pop(),
        "panel_bytes": panel_path.stat().st_size,
        "binding": binding.report(),
        "price_quality": price_quality,
    }
    log.info(
        "Redfin: %s rows, %s periods (%s..%s), %s ZIPs; latest %s has %s ZIPs",
        f"{rows:,}", report["periods"], report["period_min"], report["period_max"],
        f"{report['zips']:,}", latest_period, f"{report['latest_zips']:,}",
    )
    return report, latest_rows


def latest_records(latest_rows: list[dict]) -> dict:
    """Key latest rows by ZIP; defer wire rounding to `serialize.assemble`."""
    if not latest_rows:
        return {}
    binding = resolve(latest_rows[0].keys(), PipelineError)

    out = {}
    for row in latest_rows:
        rec = {"period_end": row["PERIOD END"], "period_begin": row["PERIOD BEGIN"]}
        for key in METRICS:
            rec[key] = row.get(binding.level[key])
            yoy = binding.yoy[key]
            rec[f"{key}_yoy"] = row.get(yoy) if yoy is not None else None
        out[row["REGION NAME"]] = rec
    return out

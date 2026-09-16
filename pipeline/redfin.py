"""Redfin ingest: stream the 1.33 GB CSV once into `panel.parquet`, keep the latest period.

Asserts (PERIOD END, REGION NAME) is unique before any reduction. Batches stream to disk;
the uniqueness check reads back only the two key columns.
"""

import logging
from pathlib import Path

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.csv as pacsv
import pyarrow.parquet as pq

from .contracts import (
    GRAINS,
    PipelineError,
    assert_columns_absent,
    assert_constants,
    assert_unique_key,
    assert_zip_format,
)
from .units import LEVELS, READ_COLUMNS, YOY_HEADER

log = logging.getLogger(__name__)

BLOCK_SIZE = 8 << 20

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

# panel.parquet column order. zip + period_end + 14 levels + 14 YoY.
PANEL_LEVELS = list(LEVELS.values())
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


def _rename_batch(batch: pa.RecordBatch) -> pa.RecordBatch:
    """Redfin headers -> our keys, keeping only the panel columns."""
    cols = [batch.column(batch.schema.get_field_index("REGION NAME")),
            batch.column(batch.schema.get_field_index("PERIOD END"))]
    for header, key in LEVELS.items():
        cols.append(batch.column(batch.schema.get_field_index(header)).cast(pa.float64()))
    for header in LEVELS:
        yoy = YOY_HEADER[header]
        cols.append(batch.column(batch.schema.get_field_index(yoy)).cast(pa.float64()))
    return pa.RecordBatch.from_arrays(cols, schema=PANEL_SCHEMA)


def ingest(csv_path: Path, panel_path: Path) -> tuple[dict, list[dict]]:
    """Stream the CSV to `panel_path`. Returns (report, latest-period rows). Schema checks run first."""
    header = read_header(csv_path)
    assert_columns_absent(header, "redfin_raw")
    missing = [c for c in READ_COLUMNS if c not in header]
    if missing:
        raise PipelineError(
            f"redfin_raw: {len(missing)} expected column(s) missing (schema drift): "
            f"{missing}\nFile has {len(header)} columns: {header}"
        )

    convert = pacsv.ConvertOptions(
        include_columns=READ_COLUMNS,
        column_types=FORCED_TYPES,
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
    writer = None

    try:
        with pacsv.open_csv(csv_path, read_options=read, convert_options=convert) as reader:
            for batch in reader:
                if batch.num_rows == 0:
                    continue
                tbl = pa.Table.from_batches([batch])
                assert_constants(tbl, "redfin_raw")
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

                if latest_period is None:
                    latest_period = first
                if first == latest_period:
                    keep = tbl.filter(pc.equal(tbl["PERIOD END"], latest_period))
                    if keep.num_rows:
                        latest_rows.extend(keep.to_pylist())

                out = _rename_batch(batch)
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
    }
    log.info(
        "Redfin: %s rows, %s periods (%s..%s), %s ZIPs; latest %s has %s ZIPs",
        f"{rows:,}", report["periods"], report["period_min"], report["period_max"],
        f"{report['zips']:,}", latest_period, f"{report['latest_zips']:,}",
    )
    return report, latest_rows


def latest_records(latest_rows: list[dict]) -> dict:
    """Latest-period rows -> {zip: {our_key: raw value}}. Raw: `serialize.assemble` is the one
    place `units.coerce` runs (coercing twice once divided two columns by 10,000)."""
    out = {}
    for row in latest_rows:
        rec = {"period_end": row["PERIOD END"], "period_begin": row["PERIOD BEGIN"]}
        for header, key in LEVELS.items():
            rec[key] = row.get(header)
            rec[f"{key}_yoy"] = row.get(YOY_HEADER[header])
        out[row["REGION NAME"]] = rec
    return out

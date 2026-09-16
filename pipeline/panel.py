"""Panel helpers. P x Z is measured every run and written to the manifest, never assumed."""

import logging
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

from .contracts import PipelineError

log = logging.getLogger(__name__)


def axis(tbl, col: str) -> list:
    """Distinct values of one column, sorted: the axis every dense pivot is laid out on."""
    return sorted(pc.unique(tbl[col]).to_pylist())


def zhvi_matrix(zhvi_panel_path) -> tuple[list[str], list[str], np.ndarray]:
    """(months, zips, [months x zips] ZHVI), NaN where absent."""
    tbl = pq.read_table(zhvi_panel_path, columns=["zip", "month", "zhvi"])
    months, zips = axis(tbl, "month"), axis(tbl, "zip")
    return months, zips, dense(tbl, "month", "zip", "zhvi", months, zips)


def dense(tbl, row_key: str, col_key: str, value_col: str,
          rows: list[str], cols: list[str]) -> np.ndarray:
    """One long column as a dense [rows x cols] array, NaN where absent (Arrow lookup, 1.68 s ->
    0.30 s vs a dict walk). `rows` and `cols` must cover the table, which is checked."""
    i = pc.index_in(tbl[row_key], value_set=pa.array(rows))
    j = pc.index_in(tbl[col_key], value_set=pa.array(cols))
    if i.null_count or j.null_count:
        raise PipelineError(
            f"dense: {i.null_count + j.null_count} key(s) in the table are outside the "
            f"given {row_key}/{col_key} axes; the index does not cover the panel"
        )

    out = np.full((len(rows), len(cols)), np.nan)
    out[i.to_numpy(zero_copy_only=False).astype(np.int64),
        j.to_numpy(zero_copy_only=False).astype(np.int64)] = \
        tbl[value_col].to_numpy(zero_copy_only=False)
    return out


def verify(panel_path: Path, expected_rows: int) -> dict:
    """Measure the panel's shape and assert it matches what was written."""
    if not panel_path.exists():
        raise PipelineError(f"panel missing: {panel_path}")

    keys = pq.read_table(panel_path, columns=["zip", "period_end"])
    if keys.num_rows != expected_rows:
        raise PipelineError(
            f"panel: wrote {expected_rows:,} rows but the file holds {keys.num_rows:,}"
        )

    periods = pc.unique(keys["period_end"]).to_pylist()
    zips = pc.unique(keys["zip"]).to_pylist()

    report = {
        "rows": keys.num_rows,
        "periods": len(periods),
        "zips": len(zips),
        "period_min": min(periods),
        "period_max": max(periods),
        "bytes": panel_path.stat().st_size,
    }
    cells = report["periods"] * report["zips"]
    if report["rows"] > cells:
        raise PipelineError(
            f"panel: {report['rows']:,} rows exceeds {report['periods']} periods x "
            f"{report['zips']:,} ZIPs = {cells:,}. The key is not unique."
        )
    report["fill_rate"] = round(report["rows"] / cells, 4)

    log.info(
        "Panel: %s x %s = %s rows (%.1f%% filled), %s..%s, %.1f MB",
        report["periods"], f"{report['zips']:,}", f"{report['rows']:,}",
        report["fill_rate"] * 100, report["period_min"], report["period_max"],
        report["bytes"] / 1e6,
    )
    return report

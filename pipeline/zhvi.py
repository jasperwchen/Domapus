"""Zillow ZHVI ingest. ZHVI is smoothed and seasonally adjusted on calendar months, which
is why `zhvi_mom` ships while no Redfin MoM does."""

import logging
import re
from io import BytesIO
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from .contracts import PipelineError

log = logging.getLogger(__name__)

DATE_COL = re.compile(r"^\d{4}-\d{2}-\d{2}$")

PANEL_SCHEMA = pa.schema([
    ("zip", pa.string()),
    ("month", pa.string()),
    ("zhvi", pa.float64()),
])


def read(content: bytes) -> tuple[pd.DataFrame, list[str]]:
    """Parse once; S2 and S3 share the frame. Returns (frame indexed by ZIP, sorted date columns)."""
    df = pd.read_csv(BytesIO(content), dtype={"RegionName": str})
    if "RegionName" not in df.columns:
        raise PipelineError("Zillow CSV missing 'RegionName' column — schema drift")

    date_cols = sorted(c for c in df.columns if DATE_COL.match(c))
    if not date_cols:
        raise PipelineError("Zillow CSV has no date columns — schema drift")

    zips = df["RegionName"].astype(str).str.zfill(5)
    if zips.duplicated().any():
        raise PipelineError("Zillow CSV: RegionName is not unique — declared grain violated")

    return df[date_cols].set_axis(pd.Index(zips, name="zip"), axis=0), date_cols


def write_panel(frame: pd.DataFrame, date_cols: list[str], panel_path: Path) -> dict:
    """Every ZHVI month per ZIP, long format, non-null only.

    Zillow overwrites history in place, so this is a current-vintage view and any backtest
    on it is optimistic; the vintage is recorded with every result.
    """
    long = frame.stack().rename("zhvi").reset_index()
    long.columns = ["zip", "month", "zhvi"]
    long = long[long["zhvi"].notna()]

    panel_path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(
        pa.Table.from_pandas(long, schema=PANEL_SCHEMA, preserve_index=False),
        panel_path, compression="zstd",
    )

    report = {
        "rows": len(long),
        "months": len(date_cols),
        "zips": int(frame.index.nunique()),
        "month_min": date_cols[0],
        "month_max": date_cols[-1],
        "vintage": date_cols[-1],
        "bytes": panel_path.stat().st_size,
    }
    report["fill_rate"] = round(report["rows"] / (report["months"] * report["zips"]), 4)
    log.info(
        "ZHVI panel: %s x %s = %s rows (%.1f%% filled), %s..%s, %.1f MB",
        report["months"], f"{report['zips']:,}", f"{report['rows']:,}",
        report["fill_rate"] * 100, report["month_min"], report["month_max"],
        report["bytes"] / 1e6,
    )
    return report


def process(frame: pd.DataFrame, date_cols: list[str]) -> tuple[dict, str]:
    """Returns ({zip: {zhvi, zhvi_mom, zhvi_yoy}}, newest month)."""
    if len(date_cols) < 13:
        raise PipelineError(
            f"Zillow CSV has only {len(date_cols)} date columns; need >= 13 for MoM/YoY"
        )

    curr, prev, year_ago = date_cols[-1], date_cols[-2], date_cols[-13]
    three = frame[[curr, prev, year_ago]].astype("float64")
    three = three[three[curr].notna()]

    def pct(base: np.ndarray, val: np.ndarray) -> list:
        """Percent change; a zero or missing base gives None."""
        with np.errstate(divide="ignore", invalid="ignore"):
            out = np.round((val / base - 1.0) * 100.0, 2)
        return [None if not np.isfinite(x) else float(x) for x in out]

    val = three[curr].to_numpy()
    mom = pct(three[prev].to_numpy(), val)
    yoy = pct(three[year_ago].to_numpy(), val)
    level = np.round(val).astype("int64")

    results = {
        zip_code: {"zhvi": int(z), "zhvi_mom": m, "zhvi_yoy": y}
        for zip_code, z, m, y in zip(three.index, level, mom, yoy)
    }

    if not results:
        raise PipelineError("Zillow processing produced no records")
    log.info("Zillow: %s ZIPs (period %s)", f"{len(results):,}", curr)
    return results, curr


def pooled_yoy(panel_path: Path) -> np.ndarray:
    """Every finite lag-12 percent change, pooled across ZIPs and years (the diverging bound sample)."""
    from . import panel

    months, zips, a = panel.zhvi_matrix(panel_path)

    if len(months) <= 12:
        raise PipelineError(f"zhvi panel has {len(months)} months; need > 12 for a lag-12 change")
    with np.errstate(divide="ignore", invalid="ignore"):
        yoy = (a[12:] / a[:-12] - 1.0) * 100.0
    return yoy[np.isfinite(yoy)]

"""Zillow ZHVI ingest.

Semantics are unchanged from the old pipeline, and that is deliberate: ZHVI is
`sm_sa` — smoothed and seasonally adjusted on true calendar months — so its MoM
is the thing MoM is supposed to mean.

`zhvi_mom` therefore ships while no Redfin `*_mom` does. That asymmetry is not an
oversight; Redfin publishes no MoM at ZIP level because its window is a rolling
three months, NSA (spec section 1.5.6). It must be stated on the methodology page
or it reads as one.
"""

import logging
import re
from io import BytesIO
from pathlib import Path

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


def write_panel(content: bytes, panel_path: Path) -> dict:
    """Every ZHVI month for every ZIP, long-format, non-null cells only.

    `process()` below reads all 319 date columns and returns three of them. That
    is the same defect the old Redfin script had — it kept one period per ZIP and
    threw away the other 172 — and it is why nothing that needs ZHVI history could
    be built. Forecasting fits AR(1) on log growth and the backtest walks 82
    origins; both read this file, neither can read a three-column summary.

    Long rather than wide, matching `panel.parquet`: ZHVI is ragged (a ZIP that
    started reporting in 2014 has no 2000 cells) and storing the nulls would cost
    ~17% more rows for nothing.

    ZILLOW OVERWRITES HISTORY IN PLACE. This file is a CURRENT-VINTAGE view, not a
    point-in-time record, so any backtest run against it is optimistic by an
    unknown amount. The newest month is recorded as the vintage with every result,
    and the fix is to start archiving each monthly pull as a release asset now so
    genuine vintages accumulate. Both facts belong on the methodology page.
    """
    df = pd.read_csv(BytesIO(content), dtype={"RegionName": str})
    date_cols = sorted(c for c in df.columns if DATE_COL.match(c))
    if not date_cols:
        raise PipelineError("Zillow CSV has no date columns — schema drift")

    zips = df["RegionName"].astype(str).str.zfill(5)
    if zips.duplicated().any():
        raise PipelineError("Zillow CSV: RegionName is not unique — declared grain violated")

    long = (
        df[date_cols]
        .set_axis(zips, axis=0)
        .stack()
        .rename("zhvi")
        .reset_index()
    )
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
        "zips": int(zips.nunique()),
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


def process(content: bytes) -> tuple[dict, str]:
    """Returns ({zip: {zhvi, zhvi_mom, zhvi_yoy}}, newest month)."""
    df = pd.read_csv(BytesIO(content), dtype={"RegionName": str})

    if "RegionName" not in df.columns:
        raise PipelineError("Zillow CSV missing 'RegionName' column — schema drift")

    date_cols = sorted(c for c in df.columns if DATE_COL.match(c))
    if len(date_cols) < 13:
        raise PipelineError(
            f"Zillow CSV has only {len(date_cols)} date columns; need >= 13 for MoM/YoY"
        )

    curr, prev, year_ago = date_cols[-1], date_cols[-2], date_cols[-13]
    results: dict[str, dict] = {}

    for _, row in df.iterrows():
        zip_code = str(row["RegionName"]).zfill(5)
        val = row[curr]
        if pd.isna(val):
            continue
        val_prev, val_yoy = row[prev], row[year_ago]

        def pct(base):
            if pd.isna(base) or base == 0:
                return None
            # Percent, matching every other change column on the wire.
            return round((float(val) / float(base) - 1.0) * 100, 2)

        results[zip_code] = {
            "zhvi": int(round(float(val))),
            "zhvi_mom": pct(val_prev),
            "zhvi_yoy": pct(val_yoy),
        }

    if not results:
        raise PipelineError("Zillow processing produced no records")
    log.info("Zillow: %s ZIPs (period %s)", f"{len(results):,}", curr)
    return results, curr


def pooled_yoy(panel_path: Path) -> "np.ndarray":
    """Every finite lag-12 percent change in the panel, as one flat array.

    This is the sample the diverging class bound is derived from. Pooled across
    ZIPs *and* across 26 years on purpose: the point of a fixed diverging scale is
    that it describes booms and flat years the same way, so a bound fitted to one
    regime would defeat it.
    """
    import numpy as np
    import pyarrow.compute as pc
    import pyarrow.parquet as pq

    tbl = pq.read_table(panel_path, columns=["zip", "month", "zhvi"])
    months = sorted(pc.unique(tbl["month"]).to_pylist())
    zips = sorted(pc.unique(tbl["zip"]).to_pylist())
    mi = {m: i for i, m in enumerate(months)}
    zi = {z: i for i, z in enumerate(zips)}

    a = np.full((len(months), len(zips)), np.nan)
    a[
        np.fromiter((mi[m] for m in tbl["month"].to_pylist()), np.int32, tbl.num_rows),
        np.fromiter((zi[z] for z in tbl["zip"].to_pylist()), np.int32, tbl.num_rows),
    ] = tbl["zhvi"].to_numpy(zero_copy_only=False)

    if len(months) <= 12:
        raise PipelineError(f"zhvi panel has {len(months)} months; need > 12 for a lag-12 change")
    with np.errstate(divide="ignore", invalid="ignore"):
        yoy = (a[12:] / a[:-12] - 1.0) * 100.0
    return yoy[np.isfinite(yoy)]

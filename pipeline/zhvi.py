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

import pandas as pd

from .contracts import PipelineError

log = logging.getLogger(__name__)

DATE_COL = re.compile(r"^\d{4}-\d{2}-\d{2}$")


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

"""ZCTA dimension table: city / county / state / metro / lat / lng per ZIP.

`public/data/zcta-meta.csv` stays the source. Redfin's own `zip_lookup.csv` is
referenced by its index.json but returns 403 [M].

Note the count: this file has 33,771 rows, but the Census 2020 ZCTA count is
33,791 — confirmed three ways from cb_2020_us_zcta520_500k. zcta-meta.csv is a
*derived* file and is 20 short. Use 33,791 as the denominator for any coverage
percentage; do not take it from here.
"""

import logging
from pathlib import Path

import pandas as pd

from .contracts import PipelineError, assert_zip_format

log = logging.getLogger(__name__)

COLUMNS = ["city", "county", "state", "metro", "lat", "lng"]

# String fields flow from a file we do not control into the DOM. Cap them, strip
# control characters, and let the frontend render them as text nodes only.
MAX_STRING = 128


def _clean(value):
    if value is None or (isinstance(value, float) and value != value):
        return None
    s = str(value)
    s = "".join(ch for ch in s if ch == "\t" or ord(ch) >= 0x20)
    s = s.strip()[:MAX_STRING]
    return s or None


def load(path: Path) -> dict:
    """Returns {zip: {city, county, state, metro, lat, lng}}."""
    try:
        df = pd.read_csv(path, dtype={"zcta": str}, encoding="utf-8")
    except FileNotFoundError as e:
        raise PipelineError(f"ZCTA metadata file missing: {path}") from e

    if "zcta" not in df.columns:
        raise PipelineError(f"{path}: missing 'zcta' column — schema drift")

    zips = df["zcta"].tolist()
    assert_zip_format(zips, "zcta_meta zcta")
    if len(set(zips)) != len(zips):
        raise PipelineError(f"{path}: 'zcta' is not unique — declared grain violated")

    out = {}
    for row in df.to_dict("records"):
        z = row["zcta"]
        rec = {c: _clean(row.get(c)) for c in ("city", "county", "state", "metro")}
        for c in ("lat", "lng"):
            v = row.get(c)
            rec[c] = None if v is None or v != v else round(float(v), 5)
        out[z] = rec

    log.info("ZCTA metadata: %s ZIPs from %s", f"{len(out):,}", path.name)
    return out

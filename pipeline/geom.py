"""Polygon anchor and bbox per ZCTA, from `public/data/zcta-geom.csv`.

  lon, lat      an inner point (mapshaper `-points inner`), inside the polygon unlike a centroid
  bw bs be bn   bounds captured before simplification

Auto-scale needs real bounds: a 0.01 degree box around centroids dropped every large rural
ZCTA out of its own viewport. The wire carries int32 offsets at x1e4; the widest ZCTA (99503,
8.3966 degrees) is 83,966, beyond int16.
"""

import csv
import logging
from pathlib import Path

from .contracts import PipelineError, assert_zip_format

log = logging.getLogger(__name__)

COLUMNS = ("ZCTA5CE20", "lon", "lat", "bw", "bs", "be", "bn")

# US, AK, HI, PR and USVI, matching the sidecar build filter.
LON_RANGE = (-180.0, -64.0)
LAT_RANGE = (17.0, 72.0)


def load(path: Path) -> dict:
    """Returns {zip: {lon, lat, bw, bs, be, bn}}, all floats in degrees."""
    if not path.exists():
        raise PipelineError(
            f"geometry sidecar missing: {path}. Build it with "
            f"`bash scripts/geometry/build_geometry.sh`."
        )

    out: dict[str, dict] = {}
    with path.open(encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh)
        missing = [c for c in COLUMNS if c not in (reader.fieldnames or [])]
        if missing:
            raise PipelineError(
                f"{path.name}: missing column(s) {missing}. Header is "
                f"{reader.fieldnames!r}."
            )
        for row in reader:
            z = row["ZCTA5CE20"]
            try:
                rec = {c: float(row[c]) for c in COLUMNS[1:]}
            except (TypeError, ValueError) as e:
                raise PipelineError(f"{path.name}: ZIP {z!r} has a non-numeric column") from e
            if z in out:
                raise PipelineError(f"{path.name}: ZCTA5CE20 {z!r} appears twice")
            out[z] = rec

    if not out:
        raise PipelineError(f"{path.name} is empty")

    assert_zip_format(list(out), f"{path.name} ZCTA5CE20")
    _assert_boxes(out, path.name)

    log.info("Geometry: %s ZCTA bboxes from %s", f"{len(out):,}", path.name)
    return out


def _assert_boxes(rows: dict, name: str) -> None:
    """Every box is in range, non-degenerate and contains its anchor. The anchor and bounds
    come from separate mapshaper passes, so an anchor outside its box is a join error."""
    bad_range, degenerate, outside = [], [], []
    for z, r in rows.items():
        if not (LON_RANGE[0] <= r["lon"] <= LON_RANGE[1]
                and LAT_RANGE[0] <= r["lat"] <= LAT_RANGE[1]):
            bad_range.append(z)
        if not (r["be"] > r["bw"] and r["bn"] > r["bs"]):
            degenerate.append(z)
        elif not (r["bw"] <= r["lon"] <= r["be"] and r["bs"] <= r["lat"] <= r["bn"]):
            outside.append(z)

    problems = []
    if bad_range:
        problems.append(
            f"  {len(bad_range):,} anchor(s) outside lon {LON_RANGE} / lat {LAT_RANGE}: "
            f"{bad_range[:5]!r}"
        )
    if degenerate:
        problems.append(f"  {len(degenerate):,} degenerate bbox(es): {degenerate[:5]!r}")
    if outside:
        problems.append(
            f"  {len(outside):,} anchor(s) outside their own bbox — the anchor pass and "
            f"the bounds pass disagree about feature identity: {outside[:5]!r}"
        )
    if problems:
        raise PipelineError(f"{name}: geometry contract violated.\n" + "\n".join(problems))


# Widest real ZCTA is 8.3966 degrees; 10 has headroom and is far below any mis-scaling.
MAX_SPAN_DEG = 10.0


def assert_bbox_scale(columns: dict[str, list[int]], scale: float, null: int) -> float:
    """Refuse a build whose decoded boxes exceed `MAX_SPAN_DEG`. The scale was once applied
    twice, every box spanned ~1,500 degrees, and auto-scale silently sampled everything.
    Returns the widest span."""
    bw, bs, be, bn = (columns[k] for k in ("bw", "bs", "be", "bn"))
    widest = 0.0
    for i in range(len(bw)):
        if null in (bw[i], bs[i], be[i], bn[i]):
            continue
        span = max((be[i] - bw[i]) / scale, (bn[i] - bs[i]) / scale)
        if span > widest:
            widest = span
    if widest > MAX_SPAN_DEG:
        raise PipelineError(
            f"bbox scale check failed: widest decoded box is {widest:,.1f} degrees, "
            f"ceiling is {MAX_SPAN_DEG}. The widest real ZCTA is 8.3966 degrees "
            f"(99503, Anchorage), so bw/bs/be/bn are on the wrong scale — check that "
            f"`geom.offsets` returns DEGREES and that `serialize.COLUMNS` applies the "
            f"1e4 exactly once between them."
        )
    return round(widest, 4)


def offsets(rec: dict | None, lon: float | None, lat: float | None) -> tuple:
    """Bbox as four offsets in DEGREES from the shipped anchor, or four Nones. The x1e4 scale
    belongs to `serialize.COLUMNS` only."""
    if rec is None or lon is None or lat is None:
        return None, None, None, None
    return (
        rec["bw"] - lon,
        rec["bs"] - lat,
        rec["be"] - lon,
        rec["bn"] - lat,
    )

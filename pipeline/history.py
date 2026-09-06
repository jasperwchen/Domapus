"""Per-ZIP time series, bucketed by ZIP prefix (spec §4.4).

One ordinary `fetch()` per click, debuggable by pasting the URL into a browser tab, and it
warms the neighbouring ZIPs in the same bucket for free.

**Bucket depth is 4, not the 3 in §4.4.** §4.4's estimate of ~45 KB raw / ~11 KB gz per
bucket was low by roughly 8x: measured, the panel is dense (only 11.9% of Redfin cells are
null, and the median series has no leading or trailing padding to trim), so a ZIP3 bucket is
37 ZIPs x 665 cells and lands at ~124 KB raw / ~43 KB gz. That misses Phase 7's own
"< 200 ms on slow-4G" target by an order of magnitude. ZIP4 is 6,106 buckets of ~6 ZIPs,
~20 KB raw / ~6 KB gz — and ZIP4 neighbours are a tight local cluster where ZIP3 is a whole
region, so the prefetch is worth more and costs less.

**Series are the three §4.4 names.** `msp` and `hs` on the Redfin period axis, `zhvi` on the
monthly one. `sold_above_list` and `median_list_price` are deliberately NOT here — see below.

**On the two redefined series, and why nothing is marked on the chart.** The May 2026 feed
migration redefined `sold_above_list` (now measured against the original list price) and
`median_list_price` (now new listings only). Measured on the panel 2026-09-06, neither shows
a level shift: the cross-sectional median of `sold_above_list` runs 15.01 -> 16.67 across the
2026-05/06 boundary against 16.45 -> 17.33 for the same months a year earlier, and
`median_list_price` is flat at 339,900 straight through. Redfin restated the whole history
under the new definitions rather than switching over going forward, so the series we hold are
internally continuous and an axis break drawn inside them would be inventing a discontinuity.

What IS true is that they no longer agree with what this site published before the migration
— +6.70 pp and -$8,200 for the same period (§1.5.5). That is a restatement, not a break, and
it ships as a per-series note. `at` carries the first period of a genuine in-panel
discontinuity; the chart draws a break marker exactly when it is non-null, which today is
never. A note may name a series that has no history array — the sidebar still shows that
metric's current value, and the restatement still applies to it.
"""

import json
import logging
from pathlib import Path

from .contracts import PipelineError

log = logging.getLogger(__name__)

# Column -> (panel column, wire scale). Integers on the wire: a JSON float costs ~8 bytes per
# cell against ~6 for the integer, over ~22 million cells.
REDFIN_SERIES = {
    "msp": ("median_sale_price", 1),
    "hs": ("homes_sold", 1),
}
ZHVI_SCALE = 1
SIGMA_SCALE = 10000
FORECAST_HORIZONS = (1, 3, 6, 12)
BUCKET_DEPTH = 4

# Keyed by wire series name. `at` = first period of a genuine discontinuity, or None when the
# series was restated backwards and is internally continuous. A note may name a series with
# no history array; it still applies to that metric's current value in the sidebar.
SERIES_NOTES = {
    "abv": {
        "at": None,
        "note": "Measured against the original list price from the May 2026 Redfin "
                "restatement onward; homes that sold above a reduced price no longer count. "
                "Redfin restated the full history, so this series is internally consistent, "
                "but it runs about 6.7 points above what this site published before "
                "2026-06.",
    },
    "mlp": {
        "at": None,
        "note": "Narrowed to new listings only in the May 2026 Redfin restatement. Redfin "
                "restated the full history, so this series is internally consistent, but it "
                "runs about $8,200 below what this site published before 2026-06.",
    },
}


def _encode(value, scale):
    if value is None:
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    if v != v:  # NaN
        return None
    return int(round(v * scale))


def _dense(tbl, id_col, axis_col, value_cols, ids, axis):
    """[len(ids) x len(axis)] float matrix per value column.

    Materialising 4.9M rows as Python lists would cost several GB before any file is
    written. `index_in` is a vectorised lookup, and the dense result is 33,952 x 173 x
    8 B = 47 MB per series — smaller than the objects it replaces by two orders.
    """
    import numpy as np
    import pyarrow as pa
    import pyarrow.compute as pc

    i = pc.index_in(tbl[id_col], value_set=pa.array(ids)).to_numpy(zero_copy_only=False)
    j = pc.index_in(tbl[axis_col], value_set=pa.array(axis)).to_numpy(zero_copy_only=False)
    out = {}
    for short, col in value_cols:
        M = np.full((len(ids), len(axis)), np.nan)
        M[i.astype(np.int64), j.astype(np.int64)] = tbl[col].to_numpy(zero_copy_only=False)
        out[short] = M
    return out


def _row_to_wire(row, scale):
    """One matrix row to a JSON-ready list: ints where finite, null where not."""
    import numpy as np

    finite = np.isfinite(row)
    if not finite.any():
        return None
    scaled = np.where(finite, np.round(row * scale), 0).astype(np.int64)
    return [int(v) if ok else None for v, ok in zip(scaled.tolist(), finite.tolist())]


def write(panel_path: Path, zhvi_panel_path: Path, records: dict, out_dir: Path,
          q_table: dict) -> dict:
    """Emit one `history/<prefix>.json` per BUCKET_DEPTH-digit prefix. Returns the receipt."""
    import pyarrow.compute as pc
    import pyarrow.parquet as pq

    redfin_cols = ["zip", "period_end"] + [c for c, _ in REDFIN_SERIES.values()]
    tbl = pq.read_table(panel_path, columns=redfin_cols)
    periods = sorted(pc.unique(tbl["period_end"]).to_pylist())
    panel_zips = sorted(pc.unique(tbl["zip"]).to_pylist())
    redfin = _dense(tbl, "zip", "period_end",
                    [(s, c) for s, (c, _) in REDFIN_SERIES.items()], panel_zips, periods)
    del tbl

    ztbl = pq.read_table(zhvi_panel_path, columns=["zip", "month", "zhvi"])
    months = sorted(pc.unique(ztbl["month"]).to_pylist())
    zhvi_zips = sorted(pc.unique(ztbl["zip"]).to_pylist())
    zhvi = _dense(ztbl, "zip", "month", [("zhvi", "zhvi")], zhvi_zips, months)["zhvi"]
    del ztbl

    panel_at = {z: i for i, z in enumerate(panel_zips)}
    zhvi_at = {z: i for i, z in enumerate(zhvi_zips)}

    buckets: dict[str, dict[str, dict]] = {}
    for z in sorted(set(panel_zips) | set(zhvi_zips)):
        rec = {}
        pj = panel_at.get(z)
        if pj is not None:
            for short, (_, scale) in REDFIN_SERIES.items():
                wire = _row_to_wire(redfin[short][pj], scale)
                if wire is not None:
                    rec[short] = wire
        zj = zhvi_at.get(z)
        if zj is not None:
            wire = _row_to_wire(zhvi[zj], ZHVI_SCALE)
            if wire is not None:
                rec["zhvi"] = wire
        if rec:
            buckets.setdefault(z[:BUCKET_DEPTH], {})[z] = rec

    # The forecast path and this ZIP's own residual sigma. The client reconstructs any
    # confidence level from `q[h][p] * sig`, so the band is two multiplies and an exp.
    forecast_zips = 0
    for zip_code, rec in records.items():
        f = [rec.get(f"f_h{h}") for h in FORECAST_HORIZONS]
        if all(v is None for v in f):
            continue
        sig = _encode(rec.get("f_sigma"), SIGMA_SCALE)
        if sig is None:
            continue
        target = buckets.get(zip_code[:BUCKET_DEPTH], {}).get(zip_code)
        if target is None:
            continue  # a ZIP with a forecast but no history is not a series; skip it
        target["f"] = f
        target["sig"] = sig
        forecast_zips += 1

    if out_dir.exists():
        for stale in out_dir.glob("*.json"):
            stale.unlink()
    out_dir.mkdir(parents=True, exist_ok=True)

    # The axes, the q table and the notes are identical in every bucket. Inlined they cost
    # ~8.5 KB per file, which across 6,085 buckets is ~52 MB of pure repetition — a third of
    # the payload. They ship once in `index.json`, which the client fetches on the first ZIP
    # click and then holds; every bucket after that is series data and nothing else.
    index = {
        "bucket_depth": BUCKET_DEPTH,
        "periods": periods,
        "zhvi_months": months,
        "scales": {short: scale for short, (_, scale) in REDFIN_SERIES.items()}
        | {"zhvi": ZHVI_SCALE, "sig": SIGMA_SCALE},
        "horizons": list(FORECAST_HORIZONS),
        "q": q_table,
        "notes": SERIES_NOTES,
        "buckets": sorted(buckets),
    }
    index_path = out_dir / "index.json"
    index_path.write_text(json.dumps(index, separators=(",", ":")), encoding="utf-8")

    total_bytes = index_path.stat().st_size
    written = 0
    zips_written = 0
    for bucket, zips in sorted(buckets.items()):
        payload = {"bucket": bucket, "zips": {z: zips[z] for z in sorted(zips)}}
        path = out_dir / f"{bucket}.json"
        path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
        total_bytes += path.stat().st_size
        written += 1
        zips_written += len(zips)

    _assert_contracts(out_dir, periods, months, written, zips_written)

    report = {
        "buckets": written,
        "zips": zips_written,
        "periods": len(periods),
        "zhvi_months": len(months),
        "series": sorted(list(REDFIN_SERIES) + ["zhvi"]),
        "forecast_zips": forecast_zips,
        "bytes_total": total_bytes,
        "bytes_median": _median_size(out_dir),
        "bytes_index": (out_dir / "index.json").stat().st_size,
        "bucket_depth": BUCKET_DEPTH,
        "period_first": periods[0],
        "period_last": periods[-1],
    }
    log.info(
        "History: %s buckets, %s ZIPs, %d periods x %d ZHVI months, %.1f MB total "
        "(median bucket %s B)",
        f"{written:,}", f"{zips_written:,}", len(periods), len(months),
        total_bytes / 1048576, f"{report['bytes_median']:,}",
    )
    return report


def _median_size(out_dir: Path) -> int:
    sizes = sorted(p.stat().st_size for p in out_dir.glob("*.json") if p.stem != "index")
    return sizes[len(sizes) // 2] if sizes else 0


def _assert_contracts(out_dir: Path, periods, months, written, zips_written) -> None:
    """CONTRACT tier. Each has a matching frontend assumption."""
    if written == 0:
        raise PipelineError("history: no buckets written")
    if periods != sorted(set(periods)):
        raise PipelineError("history: periods are not sorted and unique")
    if months != sorted(set(months)):
        raise PipelineError("history: zhvi_months are not sorted and unique")

    # A bucket name of the wrong width means a ZIP lost its leading zero somewhere upstream,
    # and the client's `zip.slice(0, BUCKET_DEPTH)` would fetch a 404 forever.
    bad = [p.stem for p in out_dir.glob("*.json")
           if p.stem != "index" and (len(p.stem) != BUCKET_DEPTH or not p.stem.isdigit())]
    if bad:
        raise PipelineError(f"history: bucket name(s) not {BUCKET_DEPTH} digits: {bad[:5]}")

    # Round-trip one bucket: array lengths are the whole contract with the chart, and a
    # short array renders as a series that silently stops early.
    idx = json.loads((out_dir / "index.json").read_text(encoding="utf-8"))
    if idx["periods"] != periods or idx["zhvi_months"] != months:
        raise PipelineError("history: index.json did not round-trip its axes")
    if len(idx["buckets"]) != written:
        raise PipelineError(
            f"history: index lists {len(idx['buckets'])} buckets, {written} were written"
        )
    sample = sorted(p for p in out_dir.glob("*.json") if p.stem != "index")[0]
    back = json.loads(sample.read_text(encoding="utf-8"))
    for z, rec in back["zips"].items():
        for short in REDFIN_SERIES:
            if short in rec and len(rec[short]) != len(periods):
                raise PipelineError(
                    f"history: {sample.name} {z}.{short} has {len(rec[short])} points "
                    f"for {len(periods)} periods"
                )
        if "zhvi" in rec and len(rec["zhvi"]) != len(months):
            raise PipelineError(
                f"history: {sample.name} {z}.zhvi has {len(rec['zhvi'])} points "
                f"for {len(months)} months"
            )
        if "f" in rec and len(rec["f"]) != len(FORECAST_HORIZONS):
            raise PipelineError(
                f"history: {sample.name} {z}.f has {len(rec['f'])} horizons, "
                f"expected {len(FORECAST_HORIZONS)}"
            )
    for short, meta in SERIES_NOTES.items():
        if meta["at"] is not None and meta["at"] not in periods:
            raise PipelineError(
                f"history: {short} break period {meta['at']!r} is not one of the periods"
            )

"""Per-ZIP time series in `history/<zip4>.json`, fetched on click.

ZIP4 buckets (~6 ZIPs, ~6 KB gz) rather than spec 4.4's ZIP3 (~43 KB gz, measured): the
panel is dense. Series: `msp`, `hs` on the Redfin axis, `zhvi` monthly.

The May 2026 Redfin restatement redefined `sold_above_list` and `median_list_price` across
the whole history, so the series are internally continuous and carry a note, not a break
(`at` stays None).
"""

import itertools
import json
import logging
from pathlib import Path

from .contracts import PipelineError

log = logging.getLogger(__name__)

# series -> (panel column, wire scale). Integers on the wire.
REDFIN_SERIES = {
    "msp": ("median_sale_price", 1),
    "hs": ("homes_sold", 1),
}
ZHVI_SCALE = 1
SIGMA_SCALE = 10000
FORECAST_HORIZONS = (1, 3, 6, 12)
BUCKET_DEPTH = 4

# `at` = first period of a real discontinuity, else None. A note may name a series with no array.
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
    import pyarrow.parquet as pq

    from . import panel

    redfin_cols = ["zip", "period_end"] + [c for c, _ in REDFIN_SERIES.values()]
    tbl = pq.read_table(panel_path, columns=redfin_cols)
    periods, panel_zips = panel.axis(tbl, "period_end"), panel.axis(tbl, "zip")
    redfin = {short: panel.dense(tbl, "zip", "period_end", col, panel_zips, periods)
              for short, (col, _) in REDFIN_SERIES.items()}
    del tbl
    months, zhvi_zips, zhvi = panel.zhvi_matrix(zhvi_panel_path)

    panel_at = {z: i for i, z in enumerate(panel_zips)}
    zhvi_at = {z: i for i, z in enumerate(zhvi_zips)}

    # Forecast path + residual sigma; the client builds any band as q[h][p] * sig.
    forecasts = {}
    for zip_code, rec in records.items():
        f = [rec.get(f"f_h{h}") for h in FORECAST_HORIZONS]
        sig = _encode(rec.get("f_sigma"), SIGMA_SCALE)
        if sig is not None and any(v is not None for v in f):
            forecasts[zip_code] = (f, sig)

    if out_dir.exists():
        for stale in out_dir.glob("*.json"):
            stale.unlink()
    out_dir.mkdir(parents=True, exist_ok=True)

    def series(z):
        rec = {}
        pj = panel_at.get(z)
        if pj is not None:
            for short, (_, scale) in REDFIN_SERIES.items():
                wire = _row_to_wire(redfin[short][pj], scale)
                if wire is not None:
                    rec[short] = wire
        zj = zhvi_at.get(z)
        if zj is not None:
            wire = _row_to_wire(zhvi[:, zj], ZHVI_SCALE)
            if wire is not None:
                rec["zhvi"] = wire
        if rec and z in forecasts:
            rec["f"], rec["sig"] = forecasts[z]
        return rec

    # Sorted ZIPs arrive grouped by prefix, so only one bucket is ever held in memory.
    buckets: list[str] = []
    total_bytes = written = zips_written = forecast_zips = 0
    for bucket, group in itertools.groupby(sorted(set(panel_zips) | set(zhvi_zips)),
                                           key=lambda z: z[:BUCKET_DEPTH]):
        zips = {z: rec for z in group if (rec := series(z))}
        if not zips:
            continue
        path = out_dir / f"{bucket}.json"
        path.write_text(json.dumps({"bucket": bucket, "zips": zips}, separators=(",", ":")),
                        encoding="utf-8")
        buckets.append(bucket)
        total_bytes += path.stat().st_size
        written += 1
        zips_written += len(zips)
        forecast_zips += sum("f" in rec for rec in zips.values())

    # Shared axes, q table and notes go once in index.json (~52 MB saved vs inlining).
    index = {
        "bucket_depth": BUCKET_DEPTH,
        "periods": periods,
        "zhvi_months": months,
        "scales": {short: scale for short, (_, scale) in REDFIN_SERIES.items()}
        | {"zhvi": ZHVI_SCALE, "sig": SIGMA_SCALE},
        "horizons": list(FORECAST_HORIZONS),
        "q": q_table,
        "notes": SERIES_NOTES,
        "buckets": buckets,
    }
    index_path = out_dir / "index.json"
    index_path.write_text(json.dumps(index, separators=(",", ":")), encoding="utf-8")
    total_bytes += index_path.stat().st_size

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

    bad = [p.stem for p in out_dir.glob("*.json")
           if p.stem != "index" and (len(p.stem) != BUCKET_DEPTH or not p.stem.isdigit())]
    if bad:
        raise PipelineError(f"history: bucket name(s) not {BUCKET_DEPTH} digits: {bad[:5]}")

    # Array lengths are the chart contract; a short array silently truncates a series.
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

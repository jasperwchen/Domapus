"""Stage driver.

    python -m pipeline                          # download, build into build/
    python -m pipeline --redfin-csv path.csv    # reuse a local copy, skip the 1.33 GB GET
    python -m pipeline --zhvi-csv path.csv

Nothing here writes `public/data/`. Each stage writes `build/` plus a
`build/<stage>_report.json` receipt; publishing copies a verified build.
"""

import argparse
import json
import logging
import os
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from .contracts import PipelineError
from . import (
    changes, classify, dim, forecast, gate, geom, history, noise, panel, paint, redfin,
    serialize, sources, spatial, units, zhvi,
)

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
LIVE_SNAPSHOT = ROOT / "public" / "data" / "zip-data.json"
LIVE_MANIFEST = ROOT / "public" / "data" / "manifest.json"
ZCTA_META = ROOT / "public" / "data" / "zcta-meta.csv"
ZCTA_GEOM = ROOT / "public" / "data" / "zcta-geom.csv"
GATE_BASELINE = ROOT / "tests" / "baselines" / "diff_gate.json"

log = logging.getLogger("pipeline")


def _report(stage: str, status: str, **fields) -> None:
    """Each stage's receipt. The next stage refuses to start without status ok."""
    BUILD.mkdir(parents=True, exist_ok=True)
    path = BUILD / f"{stage}_report.json"
    path.write_text(
        json.dumps({"stage": stage, "status": status,
                    "at": datetime.now(timezone.utc).isoformat(), **fields},
                   indent=2, default=str),
        encoding="utf-8",
    )


def _require(stage: str) -> dict:
    path = BUILD / f"{stage}_report.json"
    if not path.exists():
        raise PipelineError(f"stage {stage!r} has not run — {path} missing")
    r = json.loads(path.read_text(encoding="utf-8"))
    if r.get("status") != "ok":
        raise PipelineError(f"stage {stage!r} did not succeed: {r.get('status')!r}")
    return r


def _live_manifest() -> dict:
    """The published manifest, or {} if there is none we can read."""
    if not LIVE_MANIFEST.exists():
        return {}
    try:
        return json.loads(LIVE_MANIFEST.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        log.warning("Could not read the live manifest %s: %s", LIVE_MANIFEST, e)
        return {}


def _live_fingerprints() -> dict:
    return _live_manifest().get("fingerprints", {})


def run(redfin_csv: Path | None, zhvi_csv: Path | None, skip_probe: bool,
        override_gate: bool = False, override_reason: str = "",
        force: bool = False) -> int:
    BUILD.mkdir(parents=True, exist_ok=True)
    # Receipts are this run's log. Old ones beside new ones made the uploaded artifact mix runs.
    for old in BUILD.glob("*_report.json"):
        old.unlink()

    # --- S0 PROBE ----------------------------------------------------------
    # HEAD + 1 MB shape probe (~0.2 s). Unchanged fingerprint exits 0 without downloading.
    probes: dict[str, dict] = {}
    fingerprints: dict[str, str] = {}
    if not skip_probe:
        for label, url in (("redfin", sources.REDFIN_URL), ("zhvi", sources.ZHVI_URL)):
            probes[label] = sources.probe(url, label)
            fingerprints[label] = sources.fingerprint(probes[label])

        previous = _live_fingerprints()
        if previous and previous == fingerprints and not force:
            log.info("Upstream unchanged (fingerprint %s) — nothing to do", fingerprints)
            _report("s0_probe", "ok", probes=probes, fingerprints=fingerprints,
                    unchanged=True)
            return 0

        # Bind the Redfin header HERE, off the 1 MB probe, not after the 1.33 GB download.
        # The 2026-09-18 run spent the whole download before failing on a renamed column it
        # had already seen in this probe. Same check, same message, 25 s and 1.33 GB earlier.
        binding = units.resolve(sources.probe_header(probes["redfin"]), PipelineError)
        if binding.aliased or binding.missing_yoy:
            log.warning(
                "Redfin header drift seen at probe: aliased=%s missing_yoy=%s",
                binding.aliased, binding.missing_yoy,
            )
    # A local file is not what upstream serves now. Stamping upstream's fingerprint on it made
    # the next scheduled run believe it already had the current release; none means changed.
    if redfin_csv is not None:
        fingerprints.pop("redfin", None)
    if zhvi_csv is not None:
        fingerprints.pop("zhvi", None)
    _report("s0_probe", "ok", probes=probes, fingerprints=fingerprints)

    tmpdir = None
    try:
        # --- S1 ACQUIRE ----------------------------------------------------
        # Downloads to a temp dir outside the working tree, removed in `finally`.
        if redfin_csv is None:
            tmpdir = Path(tempfile.mkdtemp(dir=os.environ.get("RUNNER_TEMP") or None))
            redfin_csv = tmpdir / "all_zips.csv"
            p = probes.get("redfin", {})
            etag = p.get("etag", "")
            sources.download(
                sources.REDFIN_URL, redfin_csv, "Redfin",
                expect_bytes=p.get("content_length") or None,
                # A single-part ETag is the body MD5; a multipart one is not.
                verify_md5=None if sources.is_multipart_etag(etag) else (etag or None),
            )
        else:
            redfin_csv = Path(redfin_csv)
            if not redfin_csv.exists():
                raise PipelineError(f"--redfin-csv not found: {redfin_csv}")

        zhvi_bytes = (
            Path(zhvi_csv).read_bytes() if zhvi_csv
            else sources.fetch_bytes(sources.ZHVI_URL, "Zillow")
        )
        _report("s1_acquire", "ok",
                redfin_bytes=redfin_csv.stat().st_size, zhvi_bytes=len(zhvi_bytes))

        # --- S2 INGEST + PANELS --------------------------------------------
        # Full panels, not just the latest period: the statistics stages need history.
        _require("s1_acquire")
        panel_path = BUILD / "panel.parquet"
        zhvi_panel_path = BUILD / "zhvi-panel.parquet"
        redfin_report, latest_rows = redfin.ingest(redfin_csv, panel_path)
        panel_report = panel.verify(panel_path, redfin_report["rows"])
        zhvi_frame, zhvi_months = zhvi.read(zhvi_bytes)
        del zhvi_bytes
        zhvi_panel_report = zhvi.write_panel(zhvi_frame, zhvi_months, zhvi_panel_path)
        _report("s2_ingest", "ok", redfin=redfin_report, panel=panel_report,
                zhvi_panel=zhvi_panel_report)
    finally:
        if tmpdir is not None:
            shutil.rmtree(tmpdir, ignore_errors=True)

    # --- S3 ASSEMBLE -------------------------------------------------------
    _require("s2_ingest")
    redfin_records = redfin.latest_records(latest_rows)
    zhvi_records, zhvi_period = zhvi.process(zhvi_frame, zhvi_months)
    zcta = dim.load(ZCTA_META)
    geometry = geom.load(ZCTA_GEOM)

    records, redfin_period, coverage = serialize.assemble(
        zcta, zhvi_records, redfin_records, geometry
    )
    # YoY recomputed from levels, before validation so the range contract sees shipped values.
    changes_report = changes.recompute(panel_path, records, redfin_period)
    validation = serialize.validate(records, redfin_period, zhvi_period)

    now = datetime.now(timezone.utc).isoformat()
    period_begin = next(
        (r.get("period_begin") for r in redfin_records.values() if r.get("period_begin")), None
    )

    _report("s3_assemble", "ok", coverage={k: coverage[k] for k in serialize.COVERAGE},
            validation=validation, changes=changes_report)

    live_payload = serialize.read_live(LIVE_SNAPSHOT)
    # Only what the gate and LISA hysteresis read, not all fifty columns.
    prev_ts, live = serialize.decode_live(
        live_payload, keys={*gate.GATED, "homes_sold", "lisa"},
    )

    # --- S4 GATE ------------------------------------------------------------
    # Runs BEFORE anything is written, so a refused build leaves no artifact a
    # later step could mistake for a good one.
    _require("s3_assemble")
    live_manifest = _live_manifest()
    live_coverage = live_manifest.get("coverage")
    gate_report = gate.gate(
        records, live, gate.load_thresholds(GATE_BASELINE),
        coverage={k: coverage[k] for k in serialize.COVERAGE},
        live_coverage=live_coverage,
        override=override_gate, reason=override_reason,
    )
    _report("s4_gate", "ok", **gate_report)

    # --- S5 NOISE -----------------------------------------------------------
    # `rel` gates the break population (S6) and is half of the paint byte (S7).
    _require("s4_gate")
    noise_report = noise.measure(panel_path, records)
    _report("s5_noise", "ok", **noise_report)

    # --- S5b FORECAST -------------------------------------------------------
    forecast_report = forecast.run(zhvi_panel_path, records)
    _report("s5b_forecast", "ok", **forecast_report)

    # --- S5c SPATIAL --------------------------------------------------------
    # LISA over the rankable set only; needs `rel` from S5. Fills `lisa`.
    _require("s5_noise")
    live_lisa = {z: r["lisa"] for z, r in live.items() if r.get("lisa") is not None}
    # Which of those classes the last run was HOLDING, so the hold expires after one
    # release instead of republishing itself as `previous` forever. Absent key (a manifest
    # older than this rule) is unknown, not empty — `spatial.run` then holds nothing.
    previous_lisa, previously_held = spatial.hysteresis_inputs(
        live_lisa, live_manifest.get("spatial", {}).get("held"),
        live_manifest.get("redfin", {}).get("period_end"), redfin_period,
    )
    spatial_report = spatial.run(records, previous_lisa, previously_held)
    _report("s5c_spatial", "ok", **spatial_report)

    # --- S6 CLASSIFY --------------------------------------------------------
    _require("s5_noise")
    class_report = classify.compute(records)
    classify.assign(records, class_report["breaks"])
    _report("s6_classify", "ok", **class_report)

    # --- S7 PAINT -----------------------------------------------------------
    # The cross-artifact assertion keeps the map and the detail panel in agreement.
    _require("s6_classify")
    paint_dir = BUILD / "paint"
    if paint_dir.exists():
        shutil.rmtree(paint_dir)
    paint_assets = paint.write(records, classify.PAINTED, paint_dir)
    paint.assert_files_match_classes(records, paint_assets, paint_dir)
    _report("s7_paint", "ok", assets=paint_assets)

    # --- S8 HISTORY ---------------------------------------------------------
    # Per-ZIP series bucketed by ZIP4, fetched on click; off the critical path.
    _require("s5b_forecast")
    history_report = history.write(
        panel_path, zhvi_panel_path, records, BUILD / "history",
        forecast_report["backtest"]["q"],
    )
    _report("s8_history", "ok", **history_report)

    # After S5c: earlier, the statistics columns are empty and every ZIP reads as changed.
    encoded = serialize.encode_columns(records)
    change_report = serialize.diff(live_payload, records, encoded)

    out = BUILD / "zip-data.json"
    written = serialize.write_snapshot(records, out, {
        "built_utc": now,
        "period_start": period_begin,
        "period_end": redfin_period,
        "frequency": redfin_report["frequency"],
        "vintage": redfin_report["last_updated"],
        "zhvi_month": zhvi_period,
        "classes": class_report["classes"],
        "breaks": {serialize.PAINTED_SHORT[m]: b for m, b in class_report["breaks"].items()},
        "classing": {serialize.PAINTED_SHORT[m]: c["scheme"]
                     for m, c in class_report["classing"].items()},
    }, encoded)

    # The publish decision: a content digest, not a count. A missing live digest means
    # publish; a redundant deploy is cheap, a skipped one is the original bug.
    digest = serialize.release_digest(written["payload_digest"], paint_assets)
    live_digest = live_manifest.get("content_digest")
    content_changed = live_digest is None or digest != live_digest

    manifest = {
        "generated_utc": now,
        "content_digest": digest,
        "previous_content_digest": live_digest,
        "content_changed": content_changed,
        "redfin": {
            "period_end": redfin_period,
            "period_begin": period_begin,
            "vintage": redfin_report["last_updated"],
            "rows": redfin_report["rows"],
        },
        "zhvi": {"period_end": zhvi_period, "zips": len(zhvi_records),
                 "panel": zhvi_panel_report},
        "fingerprints": fingerprints,
        "upstream": {k: {"last_modified": v.get("last_modified"),
                         "content_length": v.get("content_length")}
                     for k, v in probes.items()},
        "panel": {"periods": panel_report["periods"], "zips": panel_report["zips"],
                  "rows": panel_report["rows"]},
        "coverage": {k: coverage[k] for k in serialize.COVERAGE},
        "orphans": coverage["orphans"],
        "changed": {**change_report, "compared_against_built_utc": prev_ts},
        "validation": validation,
        "changes": changes_report,
        "gate": gate_report,
        "snapshot": written,
        # `assets.paint` is what vite.config.ts inlines into index.html at build time.
        "noise": noise_report,
        "forecast": forecast_report,
        "spatial": spatial_report,
        "classes": class_report["classes"],
        "classing": class_report["classing"],
        "history": history_report,
        "assets": {"paint": paint_assets, "snapshot": "zip-data.json",
                   "history": "history/<zip4>.json"},
    }
    (BUILD / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (BUILD / "orphans.json").write_text(
        json.dumps({"count": coverage["orphans"], "zips": coverage["orphan_zips"]}, indent=2),
        encoding="utf-8",
    )
    # Frontend reads the dates; the workflow gates commit and deploy on `content_changed`.
    (BUILD / "last_updated.json").write_text(
        json.dumps({
            "last_updated_utc": now,
            "period_end": redfin_period,
            "zhvi_period_end": zhvi_period,
            "total_zip_codes": len(records),
            "content_changed": content_changed,
            "content_digest": digest,
            "change_status": change_report["status"],
            "zip_codes_changed": change_report["zips"]["changed"],
            "data_points_changed": change_report["data_points"],
        }, indent=2),
        encoding="utf-8",
    )
    log.info(
        "Build complete: %s ZIPs, %s; content %s (%s); %s",
        f"{len(records):,}", _change_summary(change_report),
        "CHANGED" if content_changed else "unchanged", digest[:12], BUILD,
    )
    return 0


def _change_summary(report: dict) -> str:
    """One line a human can read without opening the manifest."""
    if report["status"] != serialize.DIFF_COMPARED:
        return f"{report['status']} ({report.get('note', '')})"
    z, top = report["zips"], list(report["by_column"])[:3]
    return (
        f"{z['changed']:,} ZIPs moved (+{z['added']:,} new, -{z['removed']:,} gone), "
        f"{report['data_points']:,} cells"
        + (f"; busiest columns {', '.join(top)}" if top else "")
    )


def main() -> int:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    ap = argparse.ArgumentParser(prog="python -m pipeline")
    ap.add_argument("--redfin-csv", help="local all_zips.csv; skips the 1.33 GB download")
    ap.add_argument("--zhvi-csv", help="local ZHVI csv; skips the download")
    ap.add_argument("--skip-probe", action="store_true", help="no network HEAD (offline runs)")
    ap.add_argument("--override-diff-gate", action="store_true",
                    help="publish despite gate failures; requires --override-reason")
    ap.add_argument("--override-reason", default="",
                    help="recorded verbatim in the manifest. An unexplained override is "
                         "indistinguishable from a broken gate.")
    ap.add_argument("--force", action="store_true",
                    help="rebuild even when the upstream fingerprint is unchanged")
    a = ap.parse_args()
    try:
        return run(
            Path(a.redfin_csv) if a.redfin_csv else None,
            Path(a.zhvi_csv) if a.zhvi_csv else None,
            a.skip_probe,
            a.override_diff_gate,
            a.override_reason,
            a.force,
        )
    except PipelineError as e:
        log.error("Pipeline failed: %s", e)
        _report("failure", "failed", error=str(e))
        return 1


if __name__ == "__main__":
    sys.exit(main())

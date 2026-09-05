"""Stage driver.

    python -m pipeline                          # download, build into build/
    python -m pipeline --redfin-csv path.csv    # reuse a local copy, skip the 1.33 GB GET
    python -m pipeline --zhvi-csv path.csv

NOTHING HERE WRITES `public/data/`. That is the rule the property-type bug shipped
under: the old script opened `public/data/zip-data.json` for writing at the end of
main(), so any run that passed the (weak) validators overwrote the last known-good
published data. Every stage writes `build/` plus `build/<stage>_report.json`;
publication is a separate step that copies a verified build.
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
from . import dim, panel, redfin, serialize, sources, zhvi

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
LIVE_SNAPSHOT = ROOT / "public" / "data" / "zip-data.json"
ZCTA_META = ROOT / "public" / "data" / "zcta-meta.csv"

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


def run(redfin_csv: Path | None, zhvi_csv: Path | None, skip_probe: bool) -> int:
    BUILD.mkdir(parents=True, exist_ok=True)

    # --- S0 PROBE ----------------------------------------------------------
    probes = {}
    if not skip_probe:
        probes["redfin"] = sources.probe(sources.REDFIN_URL, "Redfin")
        probes["zhvi"] = sources.probe(sources.ZHVI_URL, "Zillow")
    _report("s0_probe", "ok", probes=probes)

    tmpdir = None
    try:
        # --- S1 ACQUIRE ----------------------------------------------------
        # The 1.33 GB download lands outside the git working tree with a finally
        # that removes it. It used to go into public/data/, so a run killed
        # between download and cleanup left a file `git add -A` would stage.
        if redfin_csv is None:
            tmpdir = Path(tempfile.mkdtemp(dir=os.environ.get("RUNNER_TEMP") or None))
            redfin_csv = tmpdir / "all_zips.csv"
            p = probes.get("redfin", {})
            etag = p.get("etag", "")
            sources.download(
                sources.REDFIN_URL, redfin_csv, "Redfin",
                expect_bytes=p.get("content_length") or None,
                # Single-part ETag is a plain MD5 of the body, so this is a real
                # integrity contract. A multipart ETag is not and is not checked.
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

        # --- S2 INGEST + PANEL ---------------------------------------------
        _require("s1_acquire")
        panel_path = BUILD / "panel.parquet"
        redfin_report, latest_rows = redfin.ingest(redfin_csv, panel_path)
        panel_report = panel.verify(panel_path, redfin_report["rows"])
        _report("s2_ingest", "ok", redfin=redfin_report, panel=panel_report)
    finally:
        if tmpdir is not None:
            shutil.rmtree(tmpdir, ignore_errors=True)

    # --- S3 ASSEMBLE -------------------------------------------------------
    _require("s2_ingest")
    redfin_records = redfin.latest_records(latest_rows)
    zhvi_records, zhvi_period = zhvi.process(zhvi_bytes)
    zcta = dim.load(ZCTA_META)

    records, redfin_period, coverage = serialize.assemble(zcta, zhvi_records, redfin_records)
    validation = serialize.validate(records, redfin_period, zhvi_period)

    prev_ts, zips_changed, points_changed = serialize.compare_against_existing(
        LIVE_SNAPSHOT, records
    )
    changed = zips_changed > 0 or points_changed > 0

    out = BUILD / "zip-data.json"
    written = serialize.write_snapshot(records, out, prev_ts, changed)

    manifest = {
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "redfin": {
            "period_end": redfin_period,
            "period_begin": next(
                (r.get("period_begin") for r in redfin_records.values() if r.get("period_begin")),
                None,
            ),
            "vintage": redfin_report["last_updated"],
            "rows": redfin_report["rows"],
        },
        "zhvi": {"period_end": zhvi_period, "zips": len(zhvi_records)},
        # Measured every run. Never a constant — see panel.py.
        "panel": {"periods": panel_report["periods"], "zips": panel_report["zips"],
                  "rows": panel_report["rows"]},
        "coverage": {k: coverage[k] for k in serialize.COVERAGE},
        "orphans": coverage["orphans"],
        "changed": {"zips": zips_changed, "data_points": points_changed},
        "validation": validation,
        "snapshot": written,
    }
    (BUILD / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (BUILD / "orphans.json").write_text(
        json.dumps({"count": coverage["orphans"], "zips": coverage["orphan_zips"]}, indent=2),
        encoding="utf-8",
    )
    (BUILD / "last_updated.json").write_text(
        json.dumps({
            "last_updated_utc": datetime.now(timezone.utc).isoformat(),
            "period_end": redfin_period,
            "zhvi_period_end": zhvi_period,
            "total_zip_codes": len(records),
            "zip_codes_changed": zips_changed,
            "data_points_changed": points_changed,
        }, indent=2),
        encoding="utf-8",
    )
    _report("s3_assemble", "ok", **manifest)

    log.info(
        "Build complete: %s ZIPs, %s changed, %s data points; %s",
        f"{len(records):,}", f"{zips_changed:,}", f"{points_changed:,}", BUILD,
    )
    return 0


def main() -> int:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    ap = argparse.ArgumentParser(prog="python -m pipeline")
    ap.add_argument("--redfin-csv", help="local all_zips.csv; skips the 1.33 GB download")
    ap.add_argument("--zhvi-csv", help="local ZHVI csv; skips the download")
    ap.add_argument("--skip-probe", action="store_true", help="no network HEAD (offline runs)")
    a = ap.parse_args()
    try:
        return run(
            Path(a.redfin_csv) if a.redfin_csv else None,
            Path(a.zhvi_csv) if a.zhvi_csv else None,
            a.skip_probe,
        )
    except PipelineError as e:
        log.error("Pipeline failed: %s", e)
        _report("failure", "failed", error=str(e))
        return 1


if __name__ == "__main__":
    sys.exit(main())

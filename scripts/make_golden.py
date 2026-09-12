"""Regenerate `tests/golden/*.json` from a real pipeline build.

The goldens are the cross-language contract: Python writes the bytes, TypeScript
reads them, and a wire-format change that breaks the contract fails on both sides
rather than neither. They were checked in by hand with no producer, which made a
class-count change a hand-editing job on 48 ZIPs times 9 metrics.

WHAT THIS PRESERVES. The ZIP selection, the columns and every value come straight
out of the existing fixture — they were chosen to cover the cases that actually
break (leading-zero ZIPs, a real 0, a null, a top-tier ZIP that exercises the
maximum legal byte) and nothing here is clever enough to re-choose them. Only the
class-dependent parts are recomputed: `classes`, `breaks`, and the paint bytes.

WHERE THE BREAKS COME FROM. `build/zip-data.json`, the full snapshot of a real
run, so the boundaries are the national ones a reader would actually see. Cutting
breaks over the 48 fixture ZIPs would produce a scale no release ever used.

    python scripts/make_golden.py            # report the diff, write nothing
    python scripts/make_golden.py --write
"""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from pipeline import classify, paint  # noqa: E402
from pipeline.serialize import PAINTED_SHORT  # noqa: E402

BUILD = ROOT / "build" / "zip-data.json"
GOLDEN = ROOT / "tests" / "golden"

# Wire short name -> the key `classify` and `paint` use internally.
LONG_OF = {short: long for long, short in PAINTED_SHORT.items()}


def load_full_records() -> dict:
    """Every ZIP in the real build, keyed the way the pipeline stages key them."""
    snap = json.loads(BUILD.read_text(encoding="utf8"))
    f, d, scales, null = snap["f"], snap["d"], snap["scales"], snap["null_sentinel"]
    idx = {name: j for j, name in enumerate(f)}

    records = {}
    for i, zip_code in enumerate(snap["z"]):
        rec = {}
        for short in list(PAINTED_SHORT.values()) + ["rel"]:
            raw = d[idx[short]][i]
            if raw == null:
                continue
            v = raw / scales[short]
            # `rel` is a tier index the encoder shifts into the high nibble, so it
            # has to come back an int; dividing by its scale of 1 makes it a float.
            rec[LONG_OF.get(short, short)] = int(v) if short == "rel" else v
        records[zip_code] = rec
    return records


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()

    if not BUILD.exists():
        raise SystemExit(f"{BUILD} is missing — run the pipeline before regenerating goldens")

    records = load_full_records()
    result = classify.compute(records)
    classify.assign(records, result["breaks"])

    snapshot = json.loads((GOLDEN / "snapshot_50.json").read_text(encoding="utf8"))
    old_paint = json.loads((GOLDEN / "paint_50.json").read_text(encoding="utf8"))
    fixture_zips = snapshot["z"]

    snapshot["classes"] = classify.CLASSES
    snapshot["breaks"] = {
        PAINTED_SHORT[long]: edges for long, edges in result["breaks"].items()
    }

    # The encoder, not a reimplementation of it. Slicing a full table keeps the
    # fixture's bytes byte-identical to what a release would publish.
    # Keyed by the LONG metric name, which is what `golden.test.ts` looks up.
    # `snapshot.breaks` is keyed short, because that is what the frontend reads
    # off the wire. The two fixtures genuinely use different naming and swapping
    # one for the other reads as an empty fixture rather than an error.
    bytes_by_metric = {}
    for long in PAINTED_SHORT:
        table = paint.encode(records, long)
        bytes_by_metric[long] = {
            z: table[int(z)] for z in fixture_zips if table[int(z)]
        }

    new_paint = {
        "note": old_paint["note"],
        "classes": classify.CLASSES,
        "zips": old_paint["zips"],
        "bytes": bytes_by_metric,
    }

    print(f"classes {old_paint['classes']} -> {classify.CLASSES}")
    print(f"max byte {max(max(v.values()) for v in bytes_by_metric.values()):#04x} "
          f"(legal maximum {paint.MAX_LEGAL_BYTE:#04x})")
    for long, short in PAINTED_SHORT.items():
        print(f"  {short:<9} {len(bytes_by_metric[long]):>3} of {len(fixture_zips)} ZIPs set"
              f"   breaks {[round(e, 2) for e in result['breaks'][long][:3]]} ...")

    if not a.write:
        print("\nnothing written; pass --write")
        return 0

    (GOLDEN / "snapshot_50.json").write_text(
        json.dumps(snapshot, indent=1) + "\n", encoding="utf8")
    (GOLDEN / "paint_50.json").write_text(
        json.dumps(new_paint, indent=1) + "\n", encoding="utf8")
    print(f"\nwrote {GOLDEN / 'snapshot_50.json'}\nwrote {GOLDEN / 'paint_50.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

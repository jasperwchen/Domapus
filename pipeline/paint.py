"""The first-paint artifact: one byte per ZIP, one file per painted metric.

    byte index = the ZIP as an integer ("00501" -> 501)
    byte value = (reliability_tier << 4) | (class_index + 1)
      bits 0-3  class + 1 (0 = no data)   bits 4-5  tier 0..3   bits 6-7  reserved, 0

100,000 bytes (~24 KB gzipped by Pages) so the ZIP is the index; a dense table would need a
sorted ZIP list plus a search. Never pre-compress: Pages already gzips octet-stream.

The tier nibble is the median-sale-price tier for every metric, which is what makes the
cross-artifact assertion below possible.
"""

import hashlib
import logging
from pathlib import Path

from .classify import CLASSES
from .contracts import PipelineError

log = logging.getLogger(__name__)

ZIP_SPACE = 100_000

# `class + 1` in four bits: class 15 would encode as 0x10 and read back as tier 1.
MAX_CLASSES = 15
if CLASSES > MAX_CLASSES:
    raise PipelineError(
        f"paint: {CLASSES} classes will not fit the byte layout. `class + 1` lives in "
        f"bits 0-3, so class {MAX_CLASSES} encodes to 0x10 and reads back as "
        f"reliability tier 1 with no class. Widen the field or lower CLASSES."
    )
MAX_LEGAL_BYTE = (3 << 4) | CLASSES

# Listing-side metrics the client must not fade by a sales statistic. Mirrors
# paint-table.ts. Months of supply derives from sales, so it is not exempt.
FADE_EXEMPT = ("active_listings",)


def encode(records: dict, metric: str) -> bytes:
    """One 100,000-byte table for `metric`."""
    table = bytearray(ZIP_SPACE)
    key = f"class_{metric}"
    set_count = 0

    for zip_code, rec in records.items():
        cls = rec.get(key)
        if cls is None:
            continue
        idx = int(zip_code)
        if not 0 <= idx < ZIP_SPACE:
            raise PipelineError(
                f"paint[{metric}]: ZIP {zip_code!r} is outside the {ZIP_SPACE:,}-byte "
                f"address space. The direct-index layout assumes 5-digit ZIPs."
            )
        if not 0 <= cls < CLASSES:
            raise PipelineError(
                f"paint[{metric}]: ZIP {zip_code} has class {cls}, expected 0..{CLASSES - 1}"
            )

        tier = rec.get("rel") or 0
        if not 0 <= tier <= 3:
            raise PipelineError(f"paint[{metric}]: ZIP {zip_code} has tier {tier}, expected 0..3")

        byte = (tier << 4) | (cls + 1)
        if byte > MAX_LEGAL_BYTE:
            raise PipelineError(
                f"paint[{metric}]: ZIP {zip_code} encodes to {byte:#04x}, above the "
                f"legal maximum {MAX_LEGAL_BYTE:#04x}. Bits 6-7 are reserved."
            )
        table[idx] = byte
        set_count += 1

    if set_count == 0:
        raise PipelineError(f"paint[{metric}]: every byte is zero — no ZIP was classed")

    return bytes(table)


def write(records: dict, metrics, out_dir: Path) -> dict:
    """Write `paint/<metric>-<hash8>.u8` per metric; the hash in the name busts caches."""
    out_dir.mkdir(parents=True, exist_ok=True)
    assets = {}

    for metric in metrics:
        blob = encode(records, metric)
        digest = hashlib.sha256(blob).hexdigest()
        name = f"{metric}-{digest[:8]}.u8"
        (out_dir / name).write_bytes(blob)

        nonzero = len(blob) - blob.count(0)
        top = max(blob)
        assets[metric] = {
            "file": f"paint/{name}",
            "bytes": len(blob),
            "sha256": digest,
            "zips_set": nonzero,
            "max_byte": top,
            "fade_exempt": metric in FADE_EXEMPT,
        }
        log.info("Paint %s: %s ZIPs set, max byte %#04x -> %s", metric, f"{nonzero:,}", top, name)

    return assets


def assert_agrees_with_snapshot(records: dict, assets: dict, out_dir: Path) -> None:
    """CONTRACT: paint tables and snapshot class every ZIP identically. Catches stale files,
    double writes and filename collisions, all of which would ship wrong colours silently."""
    failures = []

    for metric, asset in assets.items():
        blob = (out_dir / Path(asset["file"]).name).read_bytes()
        if len(blob) != ZIP_SPACE:
            failures.append(f"  {metric}: file is {len(blob):,} bytes, expected {ZIP_SPACE:,}")
            continue
        if hashlib.sha256(blob).hexdigest() != asset["sha256"]:
            failures.append(f"  {metric}: file on disk does not match its declared sha256")
            continue

        key = f"class_{metric}"
        for zip_code, rec in records.items():
            byte = blob[int(zip_code)]
            want_cls = rec.get(key)
            got_cls = (byte & 0x0F) - 1
            if got_cls != (-1 if want_cls is None else want_cls):
                failures.append(
                    f"  {metric} ZIP {zip_code}: paint says class {got_cls}, "
                    f"snapshot says {want_cls}"
                )
                break
            if got_cls >= 0:
                want_tier = rec.get("rel") or 0
                got_tier = (byte >> 4) & 0x03
                if got_tier != want_tier:
                    failures.append(
                        f"  {metric} ZIP {zip_code}: paint says tier {got_tier}, "
                        f"snapshot rel is {want_tier}"
                    )
                    break

    if failures:
        raise PipelineError(
            "paint: cross-artifact contract violated — the map and the detail "
            "panel would disagree about the same ZIP.\n" + "\n".join(failures)
        )
    log.info("Paint: cross-artifact assertion passed for %d metrics", len(assets))

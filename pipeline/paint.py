"""The first-paint artifact: one byte per ZIP, one file per painted metric.

Today the browser cannot colour a single ZIP until an 8.2 MB JSON snapshot has
downloaded, parsed, and been rebuilt into 33,771 objects. Almost none of that
work is needed to decide what colour something is — the colour is one of seven,
and the reliability fade is one of four. Seven times four fits in a byte.

    byte index = the ZIP as a base-10 integer.  "00501" -> 501.  "30309" -> 30309.
    byte value = (reliability_tier << 4) | (class_index + 1)

      bits 0-3   class_index + 1, in 1..7.   0 => no data for this ZIP.
      bits 4-5   reliability tier 0..3 (spec section 6.2).
      bits 6-7   reserved, MUST be 0.

    Maximum legal value = (3 << 4) | 7 = 0x37.

**Why 100,000 bytes and not a dense 33,791-byte array.** ZIP codes are five
digits, so the ZIP *is* the array index — a perfect hash needing no lookup
structure, no parse, no worker, and no build step anyone can forget. Two thirds of
the address space is empty and gzip does not care: the dense alternative gzips to
~15 KB but then needs a sorted ZIP list (~86 KB gz) plus a binary search on top,
which is strictly worse.

**Never pre-compress.** GitHub Pages/Fastly already serves octet-stream with
`Content-Encoding: gzip` — verified live on the 92 MB tileset. A `.u8.gz` name
would make the browser inflate once and any manual `DecompressionStream` inflate
again and fail.

**The reliability nibble is metric-invariant**, and that is not an optimisation.
Bits 4-5 always carry the ZIP's MEDIAN SALE PRICE tier — a property of the
transaction sample in this ZIP-period, not of whichever metric is painted — so
the nibble is byte-identical across every table and equals `snapshot.rel`. That
is what makes the cross-artifact assertion at the bottom of this file writable at
all. A per-metric tier would have no defined value for 13 of the 15 metrics, since
K is fitted for MEDIAN_SALE_PRICE only, and would fail that assertion on its first
run.
"""

import hashlib
import logging
from pathlib import Path

from .contracts import PipelineError

log = logging.getLogger(__name__)

ZIP_SPACE = 100_000
MAX_LEGAL_BYTE = (3 << 4) | 7  # 0x37

# ACTIVE LISTINGS is a listing-side series that does not depend on sales at all,
# and 3,393 latest-period ZIPs carry one with HOMES SOLD null — for those,
# `rse = K / sqrt(0)` is undefined. Those ZIPs already encode as tier 0, since 0
# means "low" and is not given a second meaning.
#
# The other half of that decision lives on the client and is declared here so the
# two cannot drift: the frontend MUST NOT apply the reliability fade when the
# painted metric is in this set. Dimming a listings map by a sales statistic — and
# dimming it hardest exactly where there were no sales — is a lie this byte layout
# would otherwise make easy.
#
# MONTHS OF SUPPLY is deliberately NOT in here. It is inventory divided by the
# sales rate, so it does derive from HOMES SOLD, and measured, every ZIP carrying
# a MONTHS OF SUPPLY value also carries HOMES SOLD. The fade is correct there.
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
        if not 0 <= cls <= 6:
            raise PipelineError(f"paint[{metric}]: ZIP {zip_code} has class {cls}, expected 0..6")

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
    """Write `paint/<metric>-<hash8>.u8` for each metric. Returns the asset map.

    The filename carries the first 8 hex of the file's own SHA-256, so a changed
    table is a changed URL and a cache can never serve last month's colours.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    assets = {}

    for metric in metrics:
        blob = encode(records, metric)
        digest = hashlib.sha256(blob).hexdigest()
        name = f"{metric}-{digest[:8]}.u8"
        (out_dir / name).write_bytes(blob)

        nonzero = sum(1 for b in blob if b)
        assets[metric] = {
            "file": f"paint/{name}",
            "bytes": len(blob),
            "sha256": digest,
            "zips_set": nonzero,
            "max_byte": max(blob),
            "fade_exempt": metric in FADE_EXEMPT,
        }
        log.info(
            "Paint %s: %s ZIPs set, max byte %#04x -> %s",
            metric, f"{nonzero:,}", max(blob), name,
        )

    return assets


def assert_agrees_with_snapshot(records: dict, assets: dict, out_dir: Path) -> None:
    """CONTRACT: the paint table and the snapshot must class every ZIP identically.

    This is the fix for the two-class-authorities flaw. Both artifacts are
    produced from the same dict by the same function in the same run, so this
    assertion cannot fail for an interesting reason — which is exactly why it is
    worth running: the boring reasons it could fail (a stale file left in the
    output directory, a metric written twice, a hash collision in the filename)
    are all silent otherwise, and all of them ship wrong colours.

    The tier half is only checkable because the nibble is metric-invariant. Where
    a ZIP has a class but no sale sample the encoder writes tier 0 and `rel` is 0,
    so the two agree there too.
    """
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

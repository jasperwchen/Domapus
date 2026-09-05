"""Assemble the latest-period snapshot and write the columnar envelope.

`KEY_ORDER` goes 43 -> 38: the 11 Redfin `*_mom` columns are dropped (Redfin
publishes none at ZIP level — measured 0 non-null cells in 4,930,000 x 14) and
three new metrics arrive (`active_listings`, `months_of_supply`,
`median_list_ppsf`). `zhvi_mom` stays; see zhvi.py for why the asymmetry is
deliberate.

THE ORDER OF THIS LIST IS THE WIRE CONTRACT. The frontend reads `f` and zips it
against each row, so appending in the middle silently shifts every column after
it. Add at the end, or change both sides in one commit.
"""

import json
import logging
from datetime import date, datetime, timezone
from pathlib import Path

from .contracts import PipelineError, assert_ranges
from .units import LEVELS, coerce

log = logging.getLogger(__name__)

METADATA_KEYS = ["city", "county", "state", "metro", "lat", "lng", "period_end"]
ZHVI_KEYS = ["zhvi", "zhvi_mom", "zhvi_yoy"]

# 14 Redfin metrics x (value, yoy), in the order of units.LEVELS.
REDFIN_KEYS: list[str] = []
for _key in LEVELS.values():
    REDFIN_KEYS += [_key, f"{_key}_yoy"]

KEY_ORDER = METADATA_KEYS + ZHVI_KEYS + REDFIN_KEYS
assert len(KEY_ORDER) == 38, f"KEY_ORDER is {len(KEY_ORDER)}, spec section 1.5.7 says 38"

# Coverage classes, so "no data" can be told apart from "zero" downstream.
COVERAGE = ("both", "redfin_only", "zhvi_only", "no_data")


def assemble(zcta_meta: dict, zhvi: dict, redfin: dict) -> tuple[dict, str | None, dict]:
    """Returns (records, newest period_end, coverage counts).

    One row per ZCTA in the metadata file. Redfin ZIPs with no ZCTA polygon are
    NOT dropped silently — they are counted and reported as orphans, because they
    are real ZIPs (PO boxes, non-residential) that simply cannot be drawn.
    """
    out: dict[str, dict] = {}
    max_period = None
    coverage = dict.fromkeys(COVERAGE, 0)

    for zip_code, meta in zcta_meta.items():
        r = redfin.get(zip_code)
        z = zhvi.get(zip_code)

        if r and z:
            coverage["both"] += 1
        elif r:
            coverage["redfin_only"] += 1
        elif z:
            coverage["zhvi_only"] += 1
        else:
            coverage["no_data"] += 1

        raw = dict(meta)
        if r:
            raw.update(r)
        if z:
            raw.update(z)

        record = {}
        for key in KEY_ORDER:
            v = raw.get(key)
            if key in ("city", "county", "state", "metro", "period_end"):
                record[key] = v
            elif key in ("lat", "lng"):
                record[key] = None if v is None else round(float(v), 5)
            else:
                record[key] = coerce(key, v)

        pe = record.get("period_end")
        if pe and (max_period is None or pe > max_period):
            max_period = pe
        out[zip_code] = record

    orphans = sorted(set(redfin) - set(zcta_meta))
    coverage["orphans"] = len(orphans)
    coverage["orphan_zips"] = orphans
    return out, max_period, coverage


# The old pipeline hard-failed at 120 days on `period_end`. That clock is wrong
# for two independent reasons and both were shipped bugs:
#
#   1. `period_end` is inherently ~35 days behind even on a perfectly healthy
#      feed — a rolling window ending Jul 31 cannot be published before August —
#      and it ages to ~65 days before the next publication. A 45-day threshold on
#      it false-trips every single month.
#   2. A hard fail refuses to publish, so the manifest that carries the outage
#      banner is never written and the banner can never render. The hard fail and
#      the banner cancelled each other out.
#
# Publication silence is measured by HTTP Last-Modified (see sources.py), it
# WARNS rather than failing, and stale data still publishes — stale data is the
# best data available and refusing to ship it makes the site more wrong, not less.
STALE_WARN_DAYS = 45
# A ceiling that means something is genuinely broken, not merely late. Two
# missed publications plus a month of slack.
MAX_PERIOD_AGE_DAYS = 120


def validate(records: dict, redfin_period: str | None, zhvi_period: str | None) -> dict:
    """Reject empty, broken or impossibly stale assemblies. Returns a report."""
    if not records:
        raise PipelineError("Output is empty — no ZIPs assembled")

    # An all-null column almost always means an input column was renamed and
    # silently dropped. It will not catch a 100x units error, which is why the
    # range contract exists separately.
    null_columns = [k for k in KEY_ORDER if all(r.get(k) is None for r in records.values())]
    if null_columns:
        raise PipelineError(
            f"All-null output columns (likely input schema drift): {null_columns}"
        )

    assert_ranges(records, "snapshot")

    ages = {}
    for label, period in (("redfin", redfin_period), ("zhvi", zhvi_period)):
        if period is None:
            raise PipelineError(f"{label} data has no period — cannot verify freshness")
        try:
            age = (datetime.now(timezone.utc).date() - date.fromisoformat(period[:10])).days
        except ValueError as e:
            raise PipelineError(f"{label} period is not a valid date: {period!r}") from e
        if age > MAX_PERIOD_AGE_DAYS:
            raise PipelineError(
                f"{label}: newest period {period} is {age} days old (limit "
                f"{MAX_PERIOD_AGE_DAYS}). That is two missed publications; the feed "
                f"has stopped, not merely slipped."
            )
        if age > STALE_WARN_DAYS:
            log.warning(
                "%s period %s is %d days old — publishing anyway, with the banner",
                label, period, age,
            )
        ages[label] = age

    log.info("Validation passed: %s ZIPs, %s columns", f"{len(records):,}", len(KEY_ORDER))
    return {"period_age_days": ages, "columns": len(KEY_ORDER), "zips": len(records)}


def compare_against_existing(live_path: Path, records: dict) -> tuple[str | None, int, int]:
    """(previous timestamp, ZIPs changed, data points changed).

    On the first run after the feed migration the field list changes, so every ZIP
    reads as changed. That is expected once and is the change REPORT, not the diff
    gate — the gate never looks at the field list.
    """
    if not live_path.exists():
        return None, 0, 0
    try:
        payload = json.loads(live_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        log.warning("Could not read existing snapshot %s: %s", live_path, e)
        return None, 0, 0

    ts = payload.get("last_updated_utc")
    if not all(k in payload for k in ("f", "z", "d")):
        return ts, 0, 0

    fields = payload["f"]
    old = {z: dict(zip(fields, payload["d"][i])) for i, z in enumerate(payload["z"])}

    changed = set(records) ^ set(old)
    points = 0
    for z in set(records) & set(old):
        if records[z] != old[z]:
            changed.add(z)
            points += sum(1 for k, v in records[z].items() if v != old[z].get(k))
    return ts, len(changed), points


def write_snapshot(records: dict, out_path: Path, previous_timestamp: str | None,
                   changed: bool) -> dict:
    """Write `{last_updated_utc, f, z, d}`. Row-major, one row per ZIP."""
    zips = sorted(records)
    rows = [[records[z][f] for f in KEY_ORDER] for z in zips]

    now = datetime.now(timezone.utc).isoformat()
    payload = {
        "last_updated_utc": now if (previous_timestamp is None or changed) else previous_timestamp,
        "f": KEY_ORDER,
        "z": zips,
        "d": rows,
    }

    # Encoder contracts. Every one of these has a matching frontend assumption.
    if len(payload["f"]) != 38:
        raise PipelineError(f"f has {len(payload['f'])} names, expected 38")
    if any(len(z) != 5 or not z.isdigit() for z in zips):
        raise PipelineError("z contains a ZIP that is not 5 digits — leading zeros lost")
    if any(len(r) != len(KEY_ORDER) for r in rows):
        raise PipelineError("a row's width does not match f")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")

    # Round-trip: reload and compare, so a JSON encoding surprise fails here and
    # not in the browser.
    back = json.loads(out_path.read_text(encoding="utf-8"))
    if back["f"] != payload["f"] or back["z"] != payload["z"] or back["d"] != payload["d"]:
        raise PipelineError("snapshot did not round-trip through JSON")

    return {"zips": len(zips), "columns": len(KEY_ORDER), "bytes": out_path.stat().st_size}

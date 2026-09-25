"""Assemble the latest-period snapshot and write the column-major envelope.

`d[j]` is column j for every ZIP, so the frontend converts each column to an Int32Array in
one pass and transfers it (measured: removes a 173 ms object rebuild and 238 ms clone).

Wire contract:
- `SNAPSHOT_COLUMNS` order is positional. Append, or change `FIELD_OF` in zip-table.ts in
  the same commit.
- Every column declares a scale; a missing one decodes silently wrong (4.6% RSE as 46).
- Null is `NULL_SENTINEL`, never 0: several columns carry real zeros.
"""

import hashlib
import itertools
import json
import logging
from datetime import date, datetime, timezone
from pathlib import Path

from .contracts import PipelineError, assert_ranges
from .units import METRICS, coerce

log = logging.getLogger(__name__)

FORMAT = "domapus-snapshot"
VERSION = 3

NULL_SENTINEL = -2147483648

METADATA_KEYS = ["city", "county", "state", "metro", "lat", "lng", "period_end"]
ZHVI_KEYS = ["zhvi", "zhvi_mom", "zhvi_yoy"]

# 14 Redfin metrics x (value, yoy), in the order of units.METRICS.
REDFIN_KEYS: list[str] = []
for _key in METRICS:
    REDFIN_KEYS += [_key, f"{_key}_yoy"]

SOURCE_KEYS = METADATA_KEYS + ZHVI_KEYS + REDFIN_KEYS

# Statistics written by noise.py / classify.py / forecast.py / spatial.py.
STAT_KEYS = ["msp_rse", "dom_rse", "rel", "f_h12", "f_sigma", "f_tier", "lisa"]

# Coverage classes, so "no data" can be told apart from "zero" downstream.
COVERAGE = ("both", "redfin_only", "zhvi_only", "no_data")
COVERAGE_CODE = {"no_data": 0, "zhvi_only": 1, "redfin_only": 2, "both": 3}

DICT_COLUMNS = ("st", "ci", "co", "me")

# (short name, source key, scale). `dom_yoy_d` and `mos_yoy_m` are whole-day and month
# differences, not percents; the suffix is there so nobody formats them with %.
COLUMNS: list[tuple[str, str, float]] = [
    ("st", "state", 1), ("ci", "city", 1), ("co", "county", 1), ("me", "metro", 1),
    ("lat", "lat", 1e5), ("lng", "lng", 1e5),
    ("bw", "bw", 1e4), ("bs", "bs", 1e4), ("be", "be", 1e4), ("bn", "bn", 1e4),
    ("cov", "cov", 1),

    ("msp", "median_sale_price", 1), ("ppsf", "median_ppsf", 100),
    ("hs", "homes_sold", 1), ("al", "active_listings", 1),
    ("dom", "median_dom", 1), ("abv", "sold_above_list", 100),
    ("mos", "months_of_supply", 100), ("zhvi", "zhvi", 1),

    ("mlp", "median_list_price", 1), ("lppsf", "median_list_ppsf", 100),
    ("ps", "pending_sales", 1), ("nl", "new_listings", 1), ("inv", "inventory", 1),
    ("s2l", "avg_sale_to_list_ratio", 100), ("om2", "off_market_in_two_weeks", 100),

    ("msp_yoy", "median_sale_price_yoy", 100), ("ppsf_yoy", "median_ppsf_yoy", 100),
    ("hs_yoy", "homes_sold_yoy", 100), ("al_yoy", "active_listings_yoy", 100),
    ("dom_yoy_d", "median_dom_yoy", 100), ("abv_yoy", "sold_above_list_yoy", 100),
    ("mos_yoy_m", "months_of_supply_yoy", 100), ("zhvi_yoy", "zhvi_yoy", 100),

    ("mlp_yoy", "median_list_price_yoy", 100), ("lppsf_yoy", "median_list_ppsf_yoy", 100),
    ("ps_yoy", "pending_sales_yoy", 100), ("nl_yoy", "new_listings_yoy", 100),
    ("inv_yoy", "inventory_yoy", 100),
    ("s2l_yoy", "avg_sale_to_list_ratio_yoy", 100),
    ("om2_yoy", "off_market_in_two_weeks_yoy", 100),

    ("zhvi_mom", "zhvi_mom", 100),

    ("msp_rse", "msp_rse", 1e4), ("dom_rse", "dom_rse", 1e4), ("rel", "rel", 1),
    ("f_h12", "f_h12", 1), ("f_sigma", "f_sigma", 1e4), ("f_tier", "f_tier", 1),
    ("lisa", "lisa", 1),
]

SNAPSHOT_COLUMNS = [short for short, _, _ in COLUMNS]
SCALES = {short: scale for short, _, scale in COLUMNS}
SOURCE_OF = {short: src for short, src, _ in COLUMNS}

assert len(SNAPSHOT_COLUMNS) == 49, f"f is {len(SNAPSHOT_COLUMNS)} names, the wire format has 49"
assert len(set(SNAPSHOT_COLUMNS)) == 49, "duplicate short name in SNAPSHOT_COLUMNS"

# Long painted name -> wire name. Only these may carry `breaks`.
PAINTED_SHORT = {
    "zhvi": "zhvi", "median_sale_price": "msp", "median_ppsf": "ppsf",
    "homes_sold": "hs", "active_listings": "al", "median_dom": "dom",
    "sold_above_list": "abv", "months_of_supply": "mos",
}


def assemble(zcta_meta: dict, zhvi: dict, redfin: dict, geometry: dict | None = None,
             ) -> tuple[dict, str | None, dict]:
    """Returns (records, newest period_end, coverage counts).

    One row per ZCTA. Redfin ZIPs with no ZCTA are counted as orphans, not dropped silently.
    The anchor is the geometry sidecar's inner point where available (a centroid can fall
    outside a C-shaped ZCTA), else the metadata centroid.
    """
    from .geom import offsets

    geometry = geometry or {}
    out: dict[str, dict] = {}
    max_period = None
    coverage = dict.fromkeys(COVERAGE, 0)
    anchored = 0

    for zip_code, meta in zcta_meta.items():
        r = redfin.get(zip_code)
        z = zhvi.get(zip_code)

        if r and z:
            state = "both"
        elif r:
            state = "redfin_only"
        elif z:
            state = "zhvi_only"
        else:
            state = "no_data"
        coverage[state] += 1

        raw = dict(meta)
        if r:
            raw.update(r)
        if z:
            raw.update(z)

        record = {}
        for key in SOURCE_KEYS:
            v = raw.get(key)
            if key in ("city", "county", "state", "metro", "period_end"):
                record[key] = v
            elif key in ("lat", "lng"):
                record[key] = None if v is None else round(float(v), 5)
            else:
                record[key] = coerce(key, v)

        g = geometry.get(zip_code)
        if g is not None:
            record["lat"] = round(g["lat"], 5)
            record["lng"] = round(g["lon"], 5)
            anchored += 1
        record["bw"], record["bs"], record["be"], record["bn"] = offsets(
            g, record["lng"], record["lat"]
        )
        record["cov"] = COVERAGE_CODE[state]
        for key in STAT_KEYS:
            record.setdefault(key, None)

        pe = record.get("period_end")
        if pe and (max_period is None or pe > max_period):
            max_period = pe
        out[zip_code] = record

    orphans = sorted(set(redfin) - set(zcta_meta))
    coverage["orphans"] = len(orphans)
    coverage["orphan_zips"] = orphans
    coverage["polygon_anchored"] = anchored
    log.info(
        "Assembled %s ZIPs; %s carry a real polygon anchor and bbox, %s fall back "
        "to the metadata centroid",
        f"{len(out):,}", f"{anchored:,}", f"{len(out) - anchored:,}",
    )
    return out, max_period, coverage


# `period_end` lags ~35-65 days on a healthy feed, so staleness WARNS at 45 and still
# publishes: refusing to ship stale data also suppresses the banner that explains it.
# 120 days (two missed publications) is a broken feed and fails.
STALE_WARN_DAYS = 45
MAX_PERIOD_AGE_DAYS = 120

# Redfin publishes before ZHVI (16th); a run between the two ships half a release. One
# month apart warns and publishes, two fails.
MAX_PERIOD_GAP_MONTHS = 1


def _month_index(period: str) -> int:
    """Months since year zero, so two period ends can be subtracted."""
    d = date.fromisoformat(period[:10])
    return d.year * 12 + d.month


def validate(records: dict, redfin_period: str | None, zhvi_period: str | None) -> dict:
    """Reject empty, broken or impossibly stale assemblies. Returns a report."""
    if not records:
        raise PipelineError("Output is empty — no ZIPs assembled")

    # All-null source column = renamed upstream header. Statistics columns are filled later.
    null_columns = [k for k in SOURCE_KEYS if all(r.get(k) is None for r in records.values())]
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

    gap = _month_index(redfin_period) - _month_index(zhvi_period)
    if abs(gap) > MAX_PERIOD_GAP_MONTHS:
        behind, ahead = ("zhvi", "redfin") if gap > 0 else ("redfin", "zhvi")
        raise PipelineError(
            f"redfin is at {redfin_period} and zhvi at {zhvi_period}, {abs(gap)} "
            f"months apart (limit {MAX_PERIOD_GAP_MONTHS}). {behind} has missed a "
            f"publication that {ahead} made; this is a broken feed, not a late one."
        )
    if gap:
        behind = "zhvi" if gap > 0 else "redfin"
        log.warning(
            "redfin %s and zhvi %s are a month apart — %s has not published yet. "
            "Publishing anyway; move the cron later if this repeats.",
            redfin_period, zhvi_period, behind,
        )

    log.info("Validation passed: %s ZIPs, %s columns", f"{len(records):,}", len(SNAPSHOT_COLUMNS))
    return {"period_age_days": ages, "period_gap_months": gap,
            "columns": len(SNAPSHOT_COLUMNS), "zips": len(records)}


def read_live(path: Path) -> dict | None:
    """The published snapshot, parsed once per run, or None if unusable."""
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        log.warning("Could not read the live snapshot %s: %s", path, e)
        return None
    if not all(k in payload for k in ("f", "z", "d")):
        log.warning("Live snapshot %s carries no f/z/d — treating it as absent", path)
        return None
    return payload


def decode_live(payload: dict | None, keys=None) -> tuple[str | None, dict]:
    """The live snapshot as (timestamp, {zip: {source_key: value}}), native scales.

    `keys` limits decoding to those source keys. Lossy by design (published quantisation),
    which is fine for the gate's "moved 25%" and wrong for `diff`'s "moved at all".
    """
    if payload is None:
        return None, {}

    ts = payload.get("last_updated_utc") or payload.get("built_utc")
    if payload.get("format") != FORMAT or payload.get("version") != VERSION:
        # An older shape would decode to garbage; give the gate no baseline instead.
        log.warning("Live snapshot is %s v%s, not %s v%s — no baseline for the gate",
                    payload.get("format"), payload.get("version"), FORMAT, VERSION)
        return ts, {}

    fields, zips, data = payload["f"], payload["z"], payload["d"]
    sentinel = payload.get("null_sentinel", NULL_SENTINEL)
    scales = payload.get("scales", {})
    dicts = payload.get("dicts", {})

    out: dict[str, dict] = {z: {} for z in zips}
    for j, short in enumerate(fields):
        col = data[j]
        key = SOURCE_OF.get(short, short)
        if keys is not None and key not in keys:
            continue
        if short in dicts:
            table = dicts[short]
            for i, z in enumerate(zips):
                out[z][key] = _dict_at(col[i], table)
            continue
        scale = scales.get(short, 1) or 1
        for i, z in enumerate(zips):
            v = col[i]
            out[z][key] = None if v == sentinel else (v if scale == 1 else v / scale)
    return ts, out


# --- The change report ---------------------------------------------------------------
# Both sides go through `encode_columns`, so quantisation cannot read as movement. Status
# distinguishes no baseline and a format change from a real count; the publish decision
# reads the release digest, not this.
DIFF_COMPARED = "compared"
DIFF_NO_BASELINE = "no_baseline"
DIFF_FORMAT_CHANGE = "format_change"


def _dict_at(code: int, table: list):
    """One dictionary-coded cell to its string. Codes index a PER-RELEASE table."""
    return table[code] if 0 <= code < len(table) else None


def diff(live: dict | None, records: dict, encoded=None) -> dict:
    """What moved between the live snapshot and this build, on the wire columns.

    Must run after S5c: before it, seven statistics columns are empty and every ZIP reads
    as changed. The assertion below enforces that.
    """
    if records and all(r.get("rel") is None for r in records.values()):
        raise PipelineError(
            "changes: every record has a null `rel`, so the statistics stages have "
            "not run yet. Diffing here would report seven columns as moved for "
            "every ZIP. Call diff() after S5c, next to the snapshot write."
        )

    zips, dicts, columns = encoded or encode_columns(records)
    empty = {"total": len(zips), "added": 0, "removed": 0, "changed": 0}

    if live is None:
        return {
            "status": DIFF_NO_BASELINE,
            "zips": {**empty, "added": len(zips), "changed": len(zips)},
            "data_points": None,
            "by_column": {},
            "note": "no readable live snapshot to compare against",
        }

    if live.get("f") != SNAPSHOT_COLUMNS or live.get("version") != VERSION:
        return {
            "status": DIFF_FORMAT_CHANGE,
            "zips": {**empty, "changed": len(zips)},
            "data_points": None,
            "by_column": {},
            "live_version": live.get("version"),
            "live_columns": len(live.get("f") or []),
            "note": "the wire format changed; every ZIP reads as changed for a "
                    "structural reason, so a movement count would be a lie",
        }

    live_at = {z: i for i, z in enumerate(live["z"])}
    pairs = [(i, live_at[z]) for i, z in enumerate(zips) if z in live_at]
    live_dicts = live.get("dicts", {})

    moved = bytearray(len(zips))
    by_column: dict[str, int] = {}
    points = 0

    for j, short in enumerate(SNAPSHOT_COLUMNS):
        new_col, old_col = columns[j], live["d"][j]
        n = 0
        if short in DICT_COLUMNS:
            new_table, old_table = dicts[short], live_dicts.get(short, [])
            for i, k in pairs:
                if _dict_at(new_col[i], new_table) != _dict_at(old_col[k], old_table):
                    moved[i] = 1
                    n += 1
        else:
            for i, k in pairs:
                if new_col[i] != old_col[k]:
                    moved[i] = 1
                    n += 1
        if n:
            by_column[short] = n
            points += n

    added = len(zips) - len(pairs)
    removed = len(live["z"]) - len(pairs)
    return {
        "status": DIFF_COMPARED,
        "zips": {"total": len(zips), "added": added, "removed": removed,
                 "changed": sum(moved) + added + removed},
        "data_points": points,
        # One column moving for every ZIP is a renamed column or lost scale, not a market.
        "by_column": dict(sorted(by_column.items(), key=lambda kv: (-kv[1], kv[0]))),
    }


def _encode(value, scale: float) -> int:
    """One cell to int32. `None` becomes the declared sentinel, never 0."""
    if value is None:
        return NULL_SENTINEL
    v = int(round(float(value) * scale)) if scale != 1 else int(round(float(value)))
    if not -2147483647 <= v <= 2147483647:
        raise PipelineError(
            f"snapshot: {value!r} at scale {scale} encodes to {v}, which does not "
            f"fit int32 (or collides with the null sentinel)."
        )
    return v


def _build_dicts(records: dict) -> dict[str, list[str]]:
    """Sorted value lists for the four string columns. Codes index into these."""
    out = {}
    for short in DICT_COLUMNS:
        key = SOURCE_OF[short]
        seen = {r[key] for r in records.values() if r.get(key)}
        out[short] = sorted(seen)
    return out


def encode_columns(records: dict) -> tuple[list[str], dict[str, list[str]], list[list[int]]]:
    """(zips, dicts, columns): exactly the ints `write_snapshot` ships."""
    zips = sorted(records)
    dicts = _build_dicts(records)
    code_of = {short: {v: i for i, v in enumerate(vals)} for short, vals in dicts.items()}

    columns: list[list[int]] = []
    for short, key, scale in COLUMNS:
        if short in DICT_COLUMNS:
            table = code_of[short]
            columns.append([table.get(records[z].get(key), NULL_SENTINEL) for z in zips])
        else:
            columns.append([_encode(records[z].get(key), scale) for z in zips])

    # Decoded bbox span check: the 1e4 scale was once applied twice.
    from .geom import assert_bbox_scale

    by_name = dict(zip(SNAPSHOT_COLUMNS, columns))
    assert_bbox_scale(by_name, SCALES["bw"], NULL_SENTINEL)

    return zips, dicts, columns


# --- Release identity -------------------------------------------------------------------
# The publish decision: identity of the bytes served. Timestamps are excluded so a rebuild
# over unchanged input reproduces it.
DIGEST_KEYS = (
    "version", "null_sentinel", "f", "z", "d", "dicts", "scales",
    "classes", "breaks", "classing",
    "period_start", "period_end", "frequency", "vintage", "zhvi_month",
)


def payload_digest(payload: dict) -> str:
    """sha256 over the snapshot's content keys, canonically serialised."""
    blob = json.dumps({k: payload[k] for k in DIGEST_KEYS if k in payload},
                      sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def release_digest(snapshot_digest: str, paint_assets: dict) -> str:
    """Snapshot digest plus every paint table hash; colours can move with the snapshot unchanged."""
    h = hashlib.sha256(snapshot_digest.encode("utf-8"))
    for metric in sorted(paint_assets):
        h.update(f"|{metric}={paint_assets[metric]['sha256']}".encode("utf-8"))
    return h.hexdigest()


def write_snapshot(records: dict, out_path: Path, envelope: dict, encoded=None) -> dict:
    """Write the column-major envelope. `encoded` reuses an `encode_columns` result."""
    zips, dicts, columns = encoded or encode_columns(records)

    payload = {
        "format": FORMAT,
        "version": VERSION,
        "null_sentinel": NULL_SENTINEL,
        **envelope,
        "dicts": dicts,
        "scales": SCALES,
        "f": SNAPSHOT_COLUMNS,
        "z": zips,
        "d": columns,
    }

    _assert_encoder_contracts(payload, records, zips)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    # allow_nan=False refuses the only value JSON would not round-trip, so the file equals
    # the payload and the 11 MB re-parse is unnecessary.
    out_path.write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False),
                        encoding="utf-8")
    _assert_payload_matches_records(payload, records)

    return {"zips": len(zips), "columns": len(SNAPSHOT_COLUMNS),
            "bytes": out_path.stat().st_size,
            "payload_digest": payload_digest(payload)}


def _assert_encoder_contracts(payload: dict, records: dict, zips: list[str]) -> None:
    """CONTRACT tier. Each of these has a matching frontend assumption."""
    f, d = payload["f"], payload["d"]

    if f != SNAPSHOT_COLUMNS:
        raise PipelineError("snapshot: f does not match SNAPSHOT_COLUMNS")
    if len(f) != 49:
        raise PipelineError(f"snapshot: f has {len(f)} names, expected 49")
    if len(d) != len(f):
        raise PipelineError(f"snapshot: {len(d)} columns for {len(f)} names")
    bad = [f[j] for j, col in enumerate(d) if len(col) != len(zips)]
    if bad:
        raise PipelineError(f"snapshot: column(s) {bad} are not len(z) = {len(zips):,}")

    missing = [n for n in f if n not in payload["scales"]]
    if missing:
        raise PipelineError(f"snapshot: no scale declared for {missing}")

    if any(len(z) != 5 or not z.isdigit() for z in zips):
        raise PipelineError("snapshot: z contains a ZIP that is not 5 digits — leading zeros lost")
    if zips != sorted(set(zips)):
        raise PipelineError("snapshot: z is not sorted and unique")

    for short, table in payload["dicts"].items():
        j = f.index(short)
        over = [c for c in d[j] if c != NULL_SENTINEL and not 0 <= c < len(table)]
        if over:
            raise PipelineError(
                f"snapshot: {short} has {len(over)} code(s) outside its dictionary "
                f"of {len(table)}"
            )

    breaks = payload.get("breaks", {})
    classes = payload.get("classes")
    for short, edges in breaks.items():
        if short not in f:
            raise PipelineError(f"snapshot: breaks names {short!r}, which is not a column")
        if len(edges) != classes - 1:
            raise PipelineError(
                f"snapshot: breaks[{short}] has {len(edges)} edges, expected {classes - 1}"
            )
    unpainted = set(breaks) - set(PAINTED_SHORT.values())
    if unpainted:
        raise PipelineError(
            f"snapshot: breaks carries unpainted column(s) {sorted(unpainted)} — a "
            f"legend that does not exist"
        )

    # Upstream clamps s2l to [50, 200]; abv reaches 100.04.
    for short, lo, hi in (("s2l", 50.0, 200.0), ("abv", 0.0, 101.0)):
        j, scale = f.index(short), payload["scales"][short]
        off = [v for v in d[j] if v != NULL_SENTINEL and not lo <= v / scale <= hi]
        if off:
            raise PipelineError(
                f"snapshot: {short} has {len(off)} value(s) outside [{lo}, {hi}]: "
                f"{[v / scale for v in off[:3]]}"
            )


def _assert_payload_matches_records(payload: dict, records: dict, sample: int = 200) -> None:
    """Compare the encoded payload against the in-memory records, on encoded ints. The file
    is `json.dumps(payload)` with allow_nan=False, so it equals the payload; this checks the
    encoder (scales, sentinel, dictionaries), not the write.

    Integer comparison, not a float tolerance: any tolerance loose enough for legitimate
    quantisation hides real errors. The sample is padded with ZIPs holding a real 0 and a
    null in the same column (found by scan, since `homes_sold` is never 0), because that
    is the pair a broken sentinel conflates.
    """
    f, z, d = payload["f"], payload["z"], payload["d"]
    sentinel = payload["null_sentinel"]
    scales, dicts = payload["scales"], payload["dicts"]
    row_of = {zip_code: i for i, zip_code in enumerate(z)}

    zeros: list[str] = []
    nulls: list[str] = []
    probe = None
    for short in f:
        if short in dicts:
            continue
        key = SOURCE_OF[short]
        z0 = list(itertools.islice((zc for zc in z if records[zc].get(key) == 0), 20))
        zn = list(itertools.islice((zc for zc in z if records[zc].get(key) is None), 20))
        if z0 and zn:
            probe, zeros, nulls = short, z0, zn
            break
    if probe is None:
        # `cov` alone has both over a real release; only tiny fixtures lack one.
        if len(z) >= 1000:
            raise PipelineError(
                "snapshot round-trip: no column carries both a real 0 and a null "
                "across {:,} ZIPs, so the null-vs-zero distinction is untestable. "
                "The encoder is probably collapsing them.".format(len(z))
            )
        log.warning(
            "round-trip: only %d ZIPs and no column with both a real 0 and a null; "
            "the null/zero distinction is untested on this input", len(z),
        )
        zeros, nulls = [], []

    picks = list(dict.fromkeys(zeros + nulls + z[:: max(1, len(z) // sample)]))
    for zip_code in picks:
        i = row_of[zip_code]
        rec = records[zip_code]
        for j, short in enumerate(f):
            raw = d[j][i]
            want = rec.get(SOURCE_OF[short])
            if short in dicts:
                got = dicts[short][raw] if raw != sentinel else None
                if want != got:
                    raise PipelineError(
                        f"snapshot round-trip: {zip_code} {short}: {want!r} != {got!r}"
                    )
                continue
            if want is None:
                if raw != sentinel:
                    raise PipelineError(
                        f"snapshot round-trip: {zip_code} {short} is null in memory "
                        f"but encoded as {raw}, not the sentinel"
                    )
                continue
            if raw == sentinel:
                raise PipelineError(
                    f"snapshot round-trip: {zip_code} {short} is {want!r} in memory "
                    f"but encoded as the null sentinel"
                )
            if raw != _encode(want, scales[short]):
                raise PipelineError(
                    f"snapshot round-trip: {zip_code} {short}: {want!r} at scale "
                    f"{scales[short]} should encode to {_encode(want, scales[short])}, "
                    f"file has {raw}"
                )

    log.info(
        "Round-trip: %s ZIPs x %d columns, null/zero probed on %r",
        f"{len(picks):,}", len(f), probe,
    )

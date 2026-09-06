"""Assemble the latest-period snapshot and write the columnar envelope.

**The wire format changed shape in Phase 4, not just width.** The shipped
snapshot was row-major — one array per ZIP, 38 values each — and this writes one
array per COLUMN, 50 of them, each as long as `z`. That transposition is the whole
point: a column of 33,771 numbers converts to an `Int32Array` in one pass and is
*transferred* to the main thread rather than cloned, which deletes the measured
173.0 ms object rebuild and the 237.8 ms structured clone. Row-major cannot do
that, because every row is a separate small object.

THE ORDER OF `SNAPSHOT_COLUMNS` IS THE WIRE CONTRACT. The frontend reads `f` and
indexes `d` by position, so inserting a name in the middle silently shifts every
column after it. Add at the end, or change both sides in one commit.

Three things the format has to get right, each of which was a real bug:

**Every column declares its scale.** A missing scale is silent — the column
decodes unscaled and a 4.6% relative standard error reaches the popup as the
number 46. So `scales` is asserted to cover every name in `f`.

**Null is not zero.** `0` is a legal value for `hs`, `dom`, `abv`, `om2`, `cov`,
`rel` and `lisa`, so a one-pass Int32Array conversion mapping null to 0 destroys
real zeros. `NULL_SENTINEL` is declared in the envelope and asserted to round-trip.

**Four statistics columns ship all-null but declared.** `f` is 50 names from the
first snapshot this emits, because a column added later shifts everything after
it. `dom_rse`, `msp_yoy_se`, `f_h12`, `f_sigma`, `f_tier` and `lisa` have no
producer until Phase 5 and ship as `null`, which is a legal value the sentinel
already has to carry. What they must NOT have is an entry in `breaks` — none of
them is painted.
"""

import json
import logging
from datetime import date, datetime, timezone
from pathlib import Path

from .contracts import PipelineError, assert_ranges
from .units import LEVELS, coerce

log = logging.getLogger(__name__)

FORMAT = "domapus-snapshot"
VERSION = 3

# Int32 minimum. Chosen over a companion presence bitmap because it costs no
# second structure and the frontend's decode stays one comparison per cell.
NULL_SENTINEL = -2147483648

METADATA_KEYS = ["city", "county", "state", "metro", "lat", "lng", "period_end"]
ZHVI_KEYS = ["zhvi", "zhvi_mom", "zhvi_yoy"]

# 14 Redfin metrics x (value, yoy), in the order of units.LEVELS.
REDFIN_KEYS: list[str] = []
for _key in LEVELS.values():
    REDFIN_KEYS += [_key, f"{_key}_yoy"]

# The keys `assemble()` produces. Internal, long, unambiguous. `SNAPSHOT_COLUMNS`
# below is the wire projection of these plus geometry and statistics.
SOURCE_KEYS = METADATA_KEYS + ZHVI_KEYS + REDFIN_KEYS

# Statistics written by noise.py / classify.py / forecast.py / spatial.py.
STAT_KEYS = ["msp_rse", "dom_rse", "rel", "msp_yoy_se", "f_h12", "f_sigma", "f_tier", "lisa"]

# Coverage classes, so "no data" can be told apart from "zero" downstream.
COVERAGE = ("both", "redfin_only", "zhvi_only", "no_data")
COVERAGE_CODE = {"no_data": 0, "zhvi_only": 1, "redfin_only": 2, "both": 3}

# --- The wire projection ---------------------------------------------------
# (short name, source key, scale). `short` is chosen to be unambiguous: an
# earlier draft used `stl` and `sal` side by side, which read as "sale-to-list"
# and "sold-to-list" and could not be told apart.
#
# `dom_yoy_d` and `mos_yoy_m` carry their unit in the NAME. They are a change in
# whole days and in months, not percents — Redfin ships both as (now - year_ago)
# x 100 under a "(%)" suffix that is a lie, `units.py` divides by 100, and the
# suffix here is what stops a future reader from formatting them with a % sign.
DICT_COLUMNS = ("st", "ci", "co", "me")

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
    ("msp_yoy_se", "msp_yoy_se", 1e4),
    ("f_h12", "f_h12", 1), ("f_sigma", "f_sigma", 1e4), ("f_tier", "f_tier", 1),
    ("lisa", "lisa", 1),
]

SNAPSHOT_COLUMNS = [short for short, _, _ in COLUMNS]
SCALES = {short: scale for short, _, scale in COLUMNS}
SOURCE_OF = {short: src for short, src, _ in COLUMNS}

# 11 metadata + 8 painted + 7 panel-only + 8 painted YoY + 7 panel-only YoY +
# zhvi_mom + 8 statistics.
assert len(SNAPSHOT_COLUMNS) == 50, f"f is {len(SNAPSHOT_COLUMNS)} names, spec section 4.3 says 50"
assert len(set(SNAPSHOT_COLUMNS)) == 50, "duplicate short name in SNAPSHOT_COLUMNS"

# Painted columns get their class breaks shipped; nothing else may. Short names,
# because that is what the frontend looks them up by.
PAINTED_SHORT = {
    "zhvi": "zhvi", "median_sale_price": "msp", "median_ppsf": "ppsf",
    "homes_sold": "hs", "active_listings": "al", "median_dom": "dom",
    "sold_above_list": "abv", "months_of_supply": "mos", "zhvi_yoy": "zhvi_yoy",
}


def assemble(zcta_meta: dict, zhvi: dict, redfin: dict, geometry: dict | None = None,
             ) -> tuple[dict, str | None, dict]:
    """Returns (records, newest period_end, coverage counts).

    One row per ZCTA in the metadata file. Redfin ZIPs with no ZCTA polygon are
    NOT dropped silently — they are counted and reported as orphans, because they
    are real ZIPs (PO boxes, non-residential) that simply cannot be drawn.

    The anchor comes from the geometry sidecar where one exists, because that
    point is guaranteed to lie INSIDE the polygon; `zcta-meta.csv`'s lat/lng is a
    centroid and can land outside a C-shaped or multi-part ZCTA. Falling back to
    the centroid keeps the 20 ZCTAs the sidecar does not cover on the map.
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
    #
    # SOURCE columns only. This runs immediately after assembly, before noise.py
    # and classify.py have written anything, so the statistics columns are all
    # null here by construction — and four of them stay null until Phase 5 fills
    # them. They are not exposed to upstream schema drift, which is the only thing
    # this guard is for; their own producers assert their own outputs.
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

    log.info("Validation passed: %s ZIPs, %s columns", f"{len(records):,}", len(SNAPSHOT_COLUMNS))
    return {"period_age_days": ages, "columns": len(SNAPSHOT_COLUMNS), "zips": len(records)}


def load_live(path: Path) -> tuple[str | None, dict]:
    """The published snapshot as (timestamp, {zip: {source_key: value}}).

    Decoded back to LONG keys on native scales, so the diff gate and the change
    report keep comparing like with like across the format change. Loaded ONCE per
    run and passed to both.

    Both shapes are read, and that is temporary. On the first run after this phase
    the live file is still the 38-column row-major one, so refusing to read it
    would blind the diff gate for exactly the release most likely to need it. The
    row-major branch can be deleted once a v3 snapshot has been published.
    """
    if not path.exists():
        return None, {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        log.warning("Could not read existing snapshot %s: %s", path, e)
        return None, {}

    ts = payload.get("last_updated_utc") or payload.get("built_utc")
    if not all(k in payload for k in ("f", "z", "d")):
        return ts, {}

    fields, zips, data = payload["f"], payload["z"], payload["d"]

    if payload.get("format") != FORMAT:
        # Row-major legacy: d[i] is ZIP i's row, keyed by long names already.
        return ts, {z: dict(zip(fields, data[i])) for i, z in enumerate(zips)}

    sentinel = payload.get("null_sentinel", NULL_SENTINEL)
    scales = payload.get("scales", {})
    dicts = payload.get("dicts", {})
    out: dict[str, dict] = {z: {} for z in zips}
    for j, short in enumerate(fields):
        col = data[j]
        key = SOURCE_OF.get(short, short)
        if short in dicts:
            table = dicts[short]
            for i, z in enumerate(zips):
                code = col[i]
                out[z][key] = table[code] if 0 <= code < len(table) else None
            continue
        scale = scales.get(short, 1) or 1
        for i, z in enumerate(zips):
            v = col[i]
            out[z][key] = None if v == sentinel else (v if scale == 1 else v / scale)
    return ts, out


def count_changes(live: dict, records: dict) -> tuple[int, int]:
    """(ZIPs changed, data points changed).

    On the first run after a format change the field list changes, so every ZIP
    reads as changed. That is expected once and is the change REPORT, not the diff
    gate — the gate never looks at the field list.
    """
    if not live:
        return 0, 0
    changed = set(records) ^ set(live)
    points = 0
    for z in set(records) & set(live):
        for k in SOURCE_KEYS:
            if records[z].get(k) != live[z].get(k):
                changed.add(z)
                points += 1
    return len(changed), points


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


def _build_dicts(records: dict, zips: list[str]) -> dict[str, list[str]]:
    """Sorted value lists for the four string columns. Codes index into these."""
    out = {}
    for short in DICT_COLUMNS:
        key = SOURCE_OF[short]
        seen = {r[key] for r in records.values() if r.get(key)}
        out[short] = sorted(seen)
    return out


def write_snapshot(records: dict, out_path: Path, envelope: dict) -> dict:
    """Write the column-major envelope. `envelope` supplies the period metadata."""
    zips = sorted(records)
    dicts = _build_dicts(records, zips)
    code_of = {short: {v: i for i, v in enumerate(vals)} for short, vals in dicts.items()}

    columns: list[list[int]] = []
    for short, key, scale in COLUMNS:
        if short in DICT_COLUMNS:
            table = code_of[short]
            columns.append([table.get(records[z].get(key), NULL_SENTINEL) for z in zips])
        else:
            columns.append([_encode(records[z].get(key), scale) for z in zips])

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
    out_path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")

    back = json.loads(out_path.read_text(encoding="utf-8"))
    if back["f"] != payload["f"] or back["z"] != payload["z"] or back["d"] != payload["d"]:
        raise PipelineError("snapshot did not round-trip through JSON")
    _assert_value_round_trip(back, records)

    return {"zips": len(zips), "columns": len(SNAPSHOT_COLUMNS),
            "bytes": out_path.stat().st_size}


def _assert_encoder_contracts(payload: dict, records: dict, zips: list[str]) -> None:
    """CONTRACT tier. Each of these has a matching frontend assumption."""
    f, d = payload["f"], payload["d"]

    if f != SNAPSHOT_COLUMNS:
        raise PipelineError("snapshot: f does not match SNAPSHOT_COLUMNS")
    if len(f) != 50:
        raise PipelineError(f"snapshot: f has {len(f)} names, expected 50")
    if len(d) != len(f):
        raise PipelineError(f"snapshot: {len(d)} columns for {len(f)} names")
    bad = [f[j] for j, col in enumerate(d) if len(col) != len(zips)]
    if bad:
        raise PipelineError(f"snapshot: column(s) {bad} are not len(z) = {len(zips):,}")

    # A missing scale is silent: the column decodes unscaled and a 4.6% relative
    # standard error reaches the popup as the number 46.
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

    # Percent-scale bounds, per the feed's own measured ceilings. `s2l` is
    # clamped upstream at [50, 200] and `abv` reaches 100.04 across 694 ZIPs.
    for short, lo, hi in (("s2l", 50.0, 200.0), ("abv", 0.0, 101.0)):
        j, scale = f.index(short), payload["scales"][short]
        off = [v for v in d[j] if v != NULL_SENTINEL and not lo <= v / scale <= hi]
        if off:
            raise PipelineError(
                f"snapshot: {short} has {len(off)} value(s) outside [{lo}, {hi}]: "
                f"{[v / scale for v in off[:3]]}"
            )


def _assert_value_round_trip(payload: dict, records: dict, sample: int = 200) -> None:
    """Decode the emitted JSON back and compare against the in-memory records.

    The comparison is on the ENCODED integer, not on the decoded float. Decoding
    and re-comparing with a tolerance sounds stricter and is actually weaker: at
    scale 1e4 a relative standard error of 0.13995 legitimately encodes to 1400
    and decodes to 0.14, which is the quantisation working as designed, and any
    tolerance loose enough to accept it is loose enough to hide a real error.

    The sample is deliberately not random. It is padded with ZIPs carrying a real
    `0` and ZIPs carrying `null` in the same column, because those are the two
    values a one-pass conversion conflates; everything else round-trips whether or
    not the sentinel works. The probe column is CHOSEN by scanning for a column
    that actually has both, rather than named in advance — `homes_sold` looks like
    the obvious candidate and turns out never to be 0 in this feed, so a hardcoded
    probe would have quietly tested nothing.
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
        z0 = [zc for zc in z if records[zc].get(key) == 0][:20]
        zn = [zc for zc in z if records[zc].get(key) is None][:20]
        if z0 and zn:
            probe, zeros, nulls = short, z0, zn
            break
    if probe is None:
        # Size-dependent on purpose. Over a real release this is a genuine alarm:
        # `cov` alone carries both a 0 (no data from either source) and a null, so
        # finding neither means the encoder is collapsing them and the probe below
        # would silently test nothing. Over a handful of fixture ZIPs it just means
        # the fixture is small, and failing there would be noise.
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

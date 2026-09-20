"""Redfin header -> our key, the accepted spellings of each header, and each column's
wire precision.

The feed already ships percent (101.34, not 1.0134): nothing is multiplied by 100.

Headers are matched through a list of accepted spellings, newest first, because Redfin
renames columns without warning and did so between the 2026-07 and 2026-08 releases:
`MEDIAN DAYS ON MARKET YOY` was "(%)" holding (now - before) * 100, and became "(DAYS)"
holding a plain whole-day difference. The 2026-09-18 run died on the missing "(%)" header
alone — a column whose value `changes.recompute` throws away before anything is published.

So criticality is declared per column and enforced by `resolve`:

    REQUIRED  the 8 identifiers and the 14 levels. The levels ARE the wire.
    OPTIONAL  the 14 YoY columns. Every one is overwritten by `changes.recompute`; they
              survive only as evidence for `changes._reconcile`, which is a check on our
              own arithmetic. Losing one costs a check, not a release, so a missing YoY
              column becomes an all-null panel column and is reported.

Keeping the panel's schema fixed across releases is the point of that null column: a
column that vanishes is a crash three stages downstream, where nothing remembers why.
"""

import difflib

# --- Header spellings, newest first ------------------------------------------------------
# Order defines the wire and the panel schema (`redfin.PANEL_COLUMNS`). Do not reorder.
LEVEL_HEADERS = {
    "homes_sold": ("HOMES SOLD",),
    "median_sale_price": ("MEDIAN SALE PRICE NSA ($)",),
    "median_dom": ("MEDIAN DAYS ON MARKET (DAYS)",),
    "avg_sale_to_list_ratio": ("AVERAGE SALE TO LIST RATIO (%)",),
    "sold_above_list": ("SHARE SOLD ABOVE ORIGINAL LIST (%)",),
    "new_listings": ("NEW LISTINGS",),
    "active_listings": ("ACTIVE LISTINGS",),
    "inventory": ("INVENTORY",),
    "pending_sales": ("PENDING SALES",),
    "median_list_price": ("MEDIAN NEW LISTING PRICE ($)",),
    "median_list_ppsf": ("MEDIAN NEW LISTING PRICE PER SQ.FT. ($)",),
    "median_ppsf": ("MEDIAN SALE PRICE PER SQ.FT. ($)",),
    "months_of_supply": ("MONTHS OF SUPPLY",),
    "off_market_in_two_weeks": ("PERCENT OFF MARKET IN TWO WEEKS (%)",),
}

# `median_dom`'s two spellings are the same quantity on two different scales, which is why
# `changes` derives the scale from the data instead of trusting the header text.
YOY_HEADERS = {
    "homes_sold": ("HOMES SOLD YOY (%)",),
    "median_sale_price": ("MEDIAN SALE PRICE NSA YOY (%)",),
    "median_dom": ("MEDIAN DAYS ON MARKET YOY (DAYS)", "MEDIAN DAYS ON MARKET YOY (%)"),
    "avg_sale_to_list_ratio": ("AVERAGE SALE TO LIST RATIO YOY (PPTS)",),
    "sold_above_list": ("SHARE SOLD ABOVE ORIGINAL LIST YOY (PPTS)",),
    "new_listings": ("NEW LISTINGS YOY (%)",),
    "active_listings": ("ACTIVE LISTINGS YOY (%)",),
    "inventory": ("INVENTORY YOY (%)",),
    "pending_sales": ("PENDING SALES YOY (%)",),
    "median_list_price": ("MEDIAN NEW LISTING PRICE YOY (%)",),
    "median_list_ppsf": ("MEDIAN NEW LISTING PRICE PER SQ.FT. YOY (%)",),
    "median_ppsf": ("MEDIAN SALE PRICE PER SQ.FT. YOY (%)",),
    "months_of_supply": ("MONTHS OF SUPPLY YOY (%)",),
    "off_market_in_two_weeks": ("PERCENT OFF MARKET IN TWO WEEKS YOY (PPTS)",),
}

assert tuple(LEVEL_HEADERS) == tuple(YOY_HEADERS), \
    "level and YoY tables must declare the same metrics in the same order"

# The 14 metric keys, in wire order. This is what the rest of the pipeline means by
# "the Redfin metrics".
METRICS = tuple(LEVEL_HEADERS)

IDENTIFIERS = [
    "LAST UPDATED", "FREQUENCY", "PERIOD BEGIN", "PERIOD END",
    "REGION ID", "REGION TYPE", "REGION NAME", "METRO",
]

# The newest spelling of everything we read: 8 identifiers + 14 levels + 14 YoY of the
# file's 50 columns. A run binds against the file it was handed, not against this list.
READ_COLUMNS = (
    IDENTIFIERS
    + [h[0] for h in LEVEL_HEADERS.values()]
    + [h[0] for h in YOY_HEADERS.values()]
)

# Integer on the wire. Everything else keeps decimals.
INTEGER_KEYS = {
    "homes_sold", "new_listings", "active_listings", "inventory", "pending_sales",
    "median_dom", "median_sale_price", "median_list_price", "zhvi",
}

# Decimal places for the non-integer columns.
DECIMALS = {
    "median_ppsf": 2, "median_list_ppsf": 2,
    "avg_sale_to_list_ratio": 2, "sold_above_list": 2, "off_market_in_two_weeks": 2,
    "months_of_supply": 2,
    "median_dom_yoy": 2, "months_of_supply_yoy": 2,
}
DEFAULT_DECIMALS = 2


class Binding:
    """Which header in THIS file carries each of our keys.

    `level[key]` and `yoy[key]` are the header strings to read; `yoy[key]` is None where the
    feed no longer publishes that column. `read_columns` is what to hand pyarrow.
    """

    __slots__ = ("level", "yoy", "read_columns", "aliased", "missing_yoy")

    def __init__(self, level, yoy, aliased, missing_yoy):
        self.level = level
        self.yoy = yoy
        self.aliased = aliased
        self.missing_yoy = missing_yoy
        self.read_columns = (
            IDENTIFIERS
            + [level[k] for k in METRICS]
            + [yoy[k] for k in METRICS if yoy[k] is not None]
        )

    def report(self) -> dict:
        """What the run bound, for the stage receipt. Empty dicts on a clean release."""
        return {
            "aliased": dict(self.aliased),
            "missing_yoy": list(self.missing_yoy),
            "read_columns": len(self.read_columns),
        }


def _suggest(want: str, header) -> str:
    """Near-misses from the file's own header, so a rename reads as a rename."""
    close = difflib.get_close_matches(want, header, n=3, cutoff=0.6)
    return f" Closest in file: {close}." if close else ""


def resolve(header, error) -> Binding:
    """Bind our keys to this file's header spellings.

    `error` is the exception class to raise, passed in so `units` stays import-free of
    `contracts` (which imports pyarrow). Raises on a missing identifier or level; a missing
    YoY column is recorded and carried as null.
    """
    present = set(header)

    missing_ids = [c for c in IDENTIFIERS if c not in present]
    if missing_ids:
        raise error(
            f"redfin_raw: {len(missing_ids)} identifier column(s) missing: {missing_ids}."
            + "".join(_suggest(c, header) for c in missing_ids)
            + f"\nFile has {len(header)} columns: {list(header)}"
        )

    level, yoy, aliased, missing_yoy = {}, {}, {}, []

    unmatched = []
    for key, spellings in LEVEL_HEADERS.items():
        found = next((h for h in spellings if h in present), None)
        if found is None:
            unmatched.append((key, spellings))
            continue
        level[key] = found
        if found != spellings[0]:
            aliased[key] = found
    if unmatched:
        lines = [
            f"  {key}: none of {list(spellings)} present." + _suggest(spellings[0], header)
            for key, spellings in unmatched
        ]
        raise error(
            f"redfin_raw: {len(unmatched)} LEVEL column(s) missing (schema drift). The "
            f"levels are the published wire, so this stops the run:\n" + "\n".join(lines)
            + f"\nFile has {len(header)} columns: {list(header)}"
            + "\nIf the column was renamed, add the new spelling FIRST in "
            "units.LEVEL_HEADERS and check whether its scale moved too."
        )

    for key, spellings in YOY_HEADERS.items():
        found = next((h for h in spellings if h in present), None)
        yoy[key] = found
        if found is None:
            missing_yoy.append(key)
        elif found != spellings[0]:
            aliased[f"{key}_yoy"] = found

    return Binding(level, yoy, aliased, missing_yoy)


def coerce(key: str, val):
    """One cell to its wire value, or None.

    No scale correction happens here. The two YoY columns Redfin ships on a x100 scale are
    read for `changes._reconcile` only and never published: `changes.recompute` overwrites
    every `<metric>_yoy` from the levels before validation. That divisor used to live here
    and was dead in the production path, which is how it survived being wrong about
    `median_dom_yoy` for a release.
    """
    if val is None:
        return None
    if isinstance(val, str):
        v = val.strip()
        if v == "" or v == "NA":
            return None
        val = v
    try:
        f = float(val)
    except (TypeError, ValueError):
        return None
    if f != f:  # NaN
        return None

    if key in INTEGER_KEYS:
        return int(round(f))
    return round(f, DECIMALS.get(key, DEFAULT_DECIMALS))

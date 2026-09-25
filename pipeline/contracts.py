"""Declared invariants, asserted every run. Everything here raises (CONTRACT tier)."""

import re

import pyarrow as pa
import pyarrow.compute as pc


class PipelineError(RuntimeError):
    """Raised on any condition that should fail the workflow loudly."""


# --- Declared grains ---------------------------------------------------------------------
# Asserted before any reduction. The Redfin file is the all-residential aggregate: one row
# per (period, ZIP); a property-type breakout would break this key.
GRAINS = {
    "panel": ["zip", "period_end"],
}

# --- Column constants ------------------------------------------------------
# Uniform across all 4.93M rows [M]. The window is 89-92 days, so FREQUENCY is the contract.
CONSTANTS = {
    "FREQUENCY": {"Rolling 3 Months"},
    "REGION TYPE": {"Zip"},
}

# Their return means a breakout dimension is back and the key above is no longer unique.
CONSTANTS_ABSENT = ["PROPERTY TYPE", "IS SEASONALLY ADJUSTED"]

ZIP_RE = re.compile(r"^\d{5}$")

# --- Ranges ----------------------------------------------------------------
# (lo, hi) inclusive, on non-null latest-period values, in PERCENT scale (the feed ships
# 101.34, not 1.0134). Measured on the real file 2026-09-04; a units change trips these.
RANGES = {
    # latest 3,499..13,247,058 · full file min 1.00 (a real $1 sale, history only)
    "median_sale_price": (1e3, 1e8),
    # latest 6,536..24,261,383 · full file max 999,999,999 — an upstream sentinel,
    # 0 occurrences in the latest period
    "median_list_price": (1e3, 1e9),
    "median_ppsf": (1.0, 1e6),          # latest 3.67..22,497 · full file max 2,175,007
    "median_list_ppsf": (1.0, 1e9),     # latest 4.58..8,063 · full file max 999,999,998
    # Redfin clamps this at exactly [50, 200] — measured min 50.00 and max 200.00
    # over the whole file. The contract is upstream's own clamp, inclusive.
    "avg_sale_to_list_ratio": (50.0, 200.0),
    "sold_above_list": (0.0, 101.0),    # max 100.04; bounded upstream nonsense
    "off_market_in_two_weeks": (0.0, 101.0),   # max 98.88
    "homes_sold": (0, 1e5),             # max 959
    "active_listings": (0, 1e6),        # max 2,458
    "new_listings": (0, 1e6),           # max 1,317
    "pending_sales": (0, 1e6),          # max 3,524
    "inventory": (0, 1e6),              # max 1,948
    "median_dom": (0, 2e4),             # latest max 5,304 · full file max 18,504
    "months_of_supply": (0, 1e4),       # max 1,327.9
    # The two difference-family YoY columns, as WE compute them in `changes.recompute`:
    # a change in days and in months. These bounds are what catches the feed's own
    # column reaching the wire instead of ours — on the x100 scale it still uses for
    # months of supply, the same columns reach +-654,499 and +-35,608 (measured
    # 2026-07-31), far outside either bound.
    "median_dom_yoy": (-2e4, 2e4),          # divided range -18,413..18,466
    "months_of_supply_yoy": (-1e4, 1e4),    # divided range -1,715.7..702.7
}

def assert_unique_key(tbl: pa.Table, keys, name: str, sample: int = 5) -> None:
    """Run before any reduction: an unproven key made `drop_duplicates` pick arbitrary rows."""
    g = tbl.select(list(keys)).group_by(list(keys)).aggregate([([], "count_all")])
    dup = g.filter(pc.greater(g["count_all"], 1))
    if dup.num_rows:
        raise PipelineError(
            f"{name}: declared key {keys} is NOT unique — {dup.num_rows:,} colliding "
            f"keys across {tbl.num_rows:,} rows.\n"
            f"Sample: {dup.slice(0, sample).to_pylist()}\n"
            f"A reduction on this key would select an ARBITRARY row. Add the missing "
            f"key column(s), or write down an explicit tie-break rule."
        )


def assert_constants(tbl: pa.Table, name: str) -> None:
    """Every CONSTANTS column holds exactly one of its allowed values."""
    for col, allowed in CONSTANTS.items():
        if col not in tbl.column_names:
            raise PipelineError(f"{name}: constant column {col!r} is missing — schema drift")
        seen = set(pc.unique(tbl[col]).to_pylist())
        unexpected = {v for v in seen if v not in allowed}
        if unexpected:
            raise PipelineError(
                f"{name}: {col!r} holds unexpected value(s) {sorted(unexpected)!r}; "
                f"expected only {sorted(allowed)!r}. The file's semantics have changed."
            )


def assert_columns_absent(header, name: str) -> None:
    """The breakout dimensions must stay gone."""
    present = [c for c in CONSTANTS_ABSENT if c in header]
    if present:
        raise PipelineError(
            f"{name}: column(s) {present} have REAPPEARED. This file used to be the "
            f"all-residential aggregate with one row per (period, ZIP). A breakout "
            f"dimension means the declared key is no longer unique and every reduction "
            f"in this pipeline would silently pick an arbitrary row. Stop and check the "
            f"feed's row grain before changing the key."
        )


def assert_zip_format(zips, name: str, sample: int = 5) -> None:
    """Every value is a bare 5-digit string (leading zeros intact)."""
    bad = [z for z in zips if z is None or not ZIP_RE.match(str(z))]
    if bad:
        raise PipelineError(
            f"{name}: {len(bad):,} of {len(zips):,} ZIP values are not 5 digits. "
            f"Sample: {bad[:sample]!r}"
        )


def assert_ranges(records: dict, name: str, sample: int = 3) -> None:
    """Non-null values of every ranged column lie inside their declared bounds."""
    failures = []
    for col, (lo, hi) in RANGES.items():
        offenders = [
            (z, r[col]) for z, r in records.items()
            if r.get(col) is not None and not (lo <= r[col] <= hi)
        ]
        if offenders:
            failures.append(
                f"  {col}: {len(offenders):,} value(s) outside [{lo}, {hi}] — "
                f"sample {offenders[:sample]!r}"
            )
    if failures:
        raise PipelineError(
            f"{name}: range contract violated. A units change upstream looks exactly "
            f"like this.\n" + "\n".join(failures)
        )

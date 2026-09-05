"""Declared invariants, and the assertions that prove them every run.

Two tiers, and the difference matters (spec section 2.2):

  CONTRACT — a value the pipeline *asserts*. Violation raises and the run stops.
             These are things that, if they changed, mean the upstream file no
             longer means what our code thinks it means.
  DRIFT    — a value the pipeline *observes*. Violation is reported, not fatal.

Everything in this module is CONTRACT tier.
"""

import re

import pyarrow as pa
import pyarrow.compute as pc


class PipelineError(RuntimeError):
    """Raised on any condition that should fail the workflow loudly."""


# --- Declared grains -------------------------------------------------------
# The key of each table, asserted with assert_unique_key BEFORE any reduction.
#
# `redfin_raw` is (PERIOD END, REGION NAME) and NOT (…, PROPERTY_TYPE_ID). The
# old feed carried five property-type rows per (ZIP, period); this file is the
# all-residential aggregate and carries one. See CONSTANTS_ABSENT below — the
# reappearance of a breakout dimension is exactly what this key guards against.
GRAINS = {
    "redfin_raw": ["PERIOD END", "REGION NAME"],
    "zhvi": ["RegionName"],
    "zcta_meta": ["zcta"],
    "panel": ["zip", "period_end"],
    "snapshot": ["zip"],
}

# --- Column constants ------------------------------------------------------
# Uniform across all 4,930,000 rows of the 2026-08-03 vintage [M].
# `PERIOD_DURATION == 90` has no successor: the real window is 89-92 days
# (spec section 1.5.10 Defect 4), so FREQUENCY is the contract instead.
CONSTANTS = {
    "FREQUENCY": {"Rolling 3 Months"},
    "REGION TYPE": {"Zip"},
}

# Columns that must STAY ABSENT. Their return means Redfin re-introduced a
# breakout dimension, which would make (PERIOD END, REGION NAME) non-unique and
# resurrect the arbitrary-row-selection bug this pipeline exists to kill.
CONSTANTS_ABSENT = ["PROPERTY TYPE", "IS SEASONALLY ADJUSTED"]

ZIP_RE = re.compile(r"^\d{5}$")

# --- Ranges ----------------------------------------------------------------
# (lo, hi) inclusive, checked against non-null values only. A units change
# upstream trips these.
#
# PERCENT SCALE, not fraction scale. The new feed ships 101.34, not 1.0134, so
# the old fraction-scale bounds rejected every row (spec section 1.5.10 Defect 3).
# The 101 ceiling on sold_above_list is deliberate: a share above 100 is upstream
# nonsense, but it is BOUNDED nonsense (measured max 100.04 across 694 ZIPs), and
# a contract that fires every month is a contract that gets switched off.
# Bounds are MEASURED on the real file, not carried over from the old feed, and
# they apply to the LATEST-PERIOD SNAPSHOT. Full-file extremes are noted where
# they differ, because a historical rebuild sees them.
#
# The spec's inherited bounds rejected real rows: `median_dom (0, 3650)` is a
# 10-year cap and the feed reaches 18,504 days; `avg_sale_to_list (0.5, 2.0)` and
# `sold_above_list (0.0, 1.0)` are fraction-scale and this feed ships percent.
#
# Measured 2026-09-04 on all 4,930,000 rows and on the 29,738-ZIP latest period.
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
    # The two mislabelled YoY columns, AFTER the /100 in units.DIVIDE_BY_100.
    # These bounds are what catches a forgotten division: undivided, the same
    # columns reach +-1,846,550 and +-171,574, far outside either bound.
    "median_dom_yoy": (-2e4, 2e4),          # divided range -18,413..18,466
    "months_of_supply_yoy": (-1e4, 1e4),    # divided range -1,715.7..702.7
}

def assert_unique_key(tbl: pa.Table, keys, name: str, sample: int = 5) -> None:
    """Run BEFORE any reduction. Measured 0 duplicates in 4,930,000 rows.

    This is the assertion whose absence caused the headline bug: `drop_duplicates`
    was used as a filter on a key nobody had proved was a key, so the surviving
    row was whichever one an unstable sort happened to leave last.
    """
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
            f"in this pipeline would silently pick an arbitrary row. Stop and re-read "
            f"spec section 1.5.5 before changing the key."
        )


def assert_zip_format(zips, name: str, sample: int = 5) -> None:
    """`REGION NAME` is a bare 5-digit ZIP in this feed.

    The old `extract_zip_code()` parsed a "Zip Code: NNNNN" pattern out of a `REGION`
    string. That regex matches nothing here and would produce an all-null ZIP
    column — which the all-null column guard catches only after a full run.
    """
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


def assert_descending(values, name: str) -> None:
    """`PERIOD END` is strictly non-increasing over the whole file.

    Verified over all 4,930,000 rows [M]. Nothing downstream depends on it today,
    but the moment something reads a prefix of this file instead of all of it, the
    prefix is only the newest periods if this holds.
    """
    for i in range(1, len(values)):
        if values[i] > values[i - 1]:
            raise PipelineError(
                f"{name}: PERIOD END is not descending at row {i:,} "
                f"({values[i - 1]!r} then {values[i]!r}). Row order has changed upstream."
            )

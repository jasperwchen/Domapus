"""Redfin header -> our key, and the scale each column arrives on.

THE ONE THING TO GET RIGHT HERE is that the new feed already ships percent.
`101.34`, not `1.0134`. The old pipeline multiplied ratios and shares by 100 on
the way out; doing that here is a silent 100x error, and the all-null column
guard does not catch it because the column is not null, only wrong.

There are exactly TWO exceptions and they run the OTHER way. See DIVIDE_BY_100.
"""

# Redfin header -> our key. Level columns only; YoY is derived from these
# by suffixing the header with " YOY (%)" or " YOY (PPTS)" — see YOY_HEADER.
#
# The 14 MoM columns are never read: measured 0 non-null cells in 4,930,000 x 14
# (spec section 1.5.9). Redfin does not publish MoM at ZIP level, deliberately —
# the windows overlap by two thirds and the data is not seasonally adjusted.
LEVELS = {
    "HOMES SOLD": "homes_sold",
    "MEDIAN SALE PRICE NSA ($)": "median_sale_price",
    "MEDIAN DAYS ON MARKET (DAYS)": "median_dom",
    "AVERAGE SALE TO LIST RATIO (%)": "avg_sale_to_list_ratio",
    "SHARE SOLD ABOVE ORIGINAL LIST (%)": "sold_above_list",
    "NEW LISTINGS": "new_listings",
    "ACTIVE LISTINGS": "active_listings",
    "INVENTORY": "inventory",
    "PENDING SALES": "pending_sales",
    "MEDIAN NEW LISTING PRICE ($)": "median_list_price",
    "MEDIAN NEW LISTING PRICE PER SQ.FT. ($)": "median_list_ppsf",
    "MEDIAN SALE PRICE PER SQ.FT. ($)": "median_ppsf",
    "MONTHS OF SUPPLY": "months_of_supply",
    "PERCENT OFF MARKET IN TWO WEEKS (%)": "off_market_in_two_weeks",
}

# The trend suffix is "(%)" for counts and prices and "(PPTS)" for rates and
# shares. Both arrive already scaled; neither is multiplied here.
YOY_HEADER = {
    "HOMES SOLD": "HOMES SOLD YOY (%)",
    "MEDIAN SALE PRICE NSA ($)": "MEDIAN SALE PRICE NSA YOY (%)",
    "MEDIAN DAYS ON MARKET (DAYS)": "MEDIAN DAYS ON MARKET YOY (%)",
    "AVERAGE SALE TO LIST RATIO (%)": "AVERAGE SALE TO LIST RATIO YOY (PPTS)",
    "SHARE SOLD ABOVE ORIGINAL LIST (%)": "SHARE SOLD ABOVE ORIGINAL LIST YOY (PPTS)",
    "NEW LISTINGS": "NEW LISTINGS YOY (%)",
    "ACTIVE LISTINGS": "ACTIVE LISTINGS YOY (%)",
    "INVENTORY": "INVENTORY YOY (%)",
    "PENDING SALES": "PENDING SALES YOY (%)",
    "MEDIAN NEW LISTING PRICE ($)": "MEDIAN NEW LISTING PRICE YOY (%)",
    "MEDIAN NEW LISTING PRICE PER SQ.FT. ($)": "MEDIAN NEW LISTING PRICE PER SQ.FT. YOY (%)",
    "MEDIAN SALE PRICE PER SQ.FT. ($)": "MEDIAN SALE PRICE PER SQ.FT. YOY (%)",
    "MONTHS OF SUPPLY": "MONTHS OF SUPPLY YOY (%)",
    "PERCENT OFF MARKET IN TWO WEEKS (%)": "PERCENT OFF MARKET IN TWO WEEKS YOY (PPTS)",
}

IDENTIFIERS = [
    "LAST UPDATED", "FREQUENCY", "PERIOD BEGIN", "PERIOD END",
    "REGION ID", "REGION TYPE", "REGION NAME", "METRO",
]

# 8 identifiers + 14 levels + 14 YoY = 36 of the file's 50 columns.
READ_COLUMNS = IDENTIFIERS + list(LEVELS) + list(YOY_HEADER.values())

# --- The two mislabelled columns -------------------------------------------
# `MEDIAN DAYS ON MARKET YOY (%)` and `MONTHS OF SUPPLY YOY (%)` are NOT percents.
# They are (value[t] - value[t-12]) * 100, carrying a "(%)" suffix that is a lie.
#
# Proof it cannot be a percent change: 43.2% of median_dom YoY and 27.7% of
# months_of_supply YoY values in the latest period are below -100, and
# (new - old)/old cannot be. Worked row: ZIP 29709 median_dom 50 vs 75 prior,
# published YoY -2496.42, and (50 - 75) * 100 = -2500.
#
# THE TRAP, stated so nobody re-walks into it: the general rule for this feed is
# "delete the * 100". The OLD pipeline's `_coerce_value` already skipped the * 100
# for any key containing 'dom', because the old feed shipped that column in days.
# Deleting a multiplication that is not there is a no-op, and the column then
# ships 100x too large. These two need a DIVISION, not a removed multiplication.
#
# They are shipped as a change in DAYS and in MONTHS and are never labelled a
# percent in any UI surface. See src/lib/metrics.ts, format "days_delta" /
# "months_delta".
DIVIDE_BY_100 = {"median_dom_yoy", "months_of_supply_yoy"}

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


def coerce(key: str, val):
    """Coerce one cell to its wire representation. Returns None for missing.

    No column is multiplied by 100. Two are divided by it. That asymmetry is the
    whole content of this function and it is documented at DIVIDE_BY_100.
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

    if key in DIVIDE_BY_100:
        f = f / 100.0
    if key in INTEGER_KEYS:
        return int(round(f))
    return round(f, DECIMALS.get(key, DEFAULT_DECIMALS))

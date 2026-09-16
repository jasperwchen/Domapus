"""Redfin header -> our key, and each column's scale on arrival.

The feed already ships percent (101.34, not 1.0134): nothing is multiplied by 100. Two
columns are divided by 100 instead; see DIVIDE_BY_100.
"""

# Level columns. The 14 MoM columns are never read: 0 non-null cells at ZIP level.
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

# `MEDIAN DAYS ON MARKET YOY (%)` and `MONTHS OF SUPPLY YOY (%)` are (now - year_ago) * 100,
# not percents (43.2% of DOM values are below -100). They need a division, not a removed
# multiplication. Shipped as days / months, never labelled %.
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
    """One cell to its wire value, or None."""
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

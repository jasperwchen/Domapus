// Field names must match `KEY_ORDER` in pipeline/serialize.py exactly. The wire
// format is positional, so a name that disagrees silently reads a neighbouring
// column rather than failing.
//
// No Redfin `*_mom` field exists. Redfin publishes none at ZIP level — measured
// 0 non-null cells in 4,930,000 x 14 — because the ZIP window is a rolling three
// months, NSA. `zhvi_mom` stays because ZHVI is smoothed and seasonally adjusted
// on true calendar months. See spec section 1.5.6.
export interface ZipData {
  // Location, from public/data/zcta-meta.csv
  zipCode: string;
  city: string | null;
  county: string | null;
  state: string | null;
  metro: string | null;
  latitude: number | null;
  longitude: number | null;
  /** End of Redfin's rolling three-month window. The window is 89-92 days, not 90. */
  period_end: string | null;

  // Zillow ZHVI. Percent, both changes.
  zhvi: number | null;
  zhvi_mom: number | null;
  zhvi_yoy: number | null;

  // Prices. All YoY are percent changes.
  median_sale_price: number | null;
  median_sale_price_yoy: number | null;
  /** New listings only since the 2026-05 rebuild — not comparable to older history. */
  median_list_price: number | null;
  median_list_price_yoy: number | null;
  median_ppsf: number | null;
  median_ppsf_yoy: number | null;
  median_list_ppsf: number | null;
  median_list_ppsf_yoy: number | null;

  // Counts. All YoY are percent changes.
  homes_sold: number | null;
  homes_sold_yoy: number | null;
  pending_sales: number | null;
  pending_sales_yoy: number | null;
  new_listings: number | null;
  new_listings_yoy: number | null;
  /** Homes available at any point in the window — a different question from
   *  `inventory`, which is an end-of-period snapshot. */
  active_listings: number | null;
  active_listings_yoy: number | null;
  inventory: number | null;
  inventory_yoy: number | null;

  // Speed and ratios.
  median_dom: number | null;
  /** A change in DAYS, not a percent. Redfin ships (now - year_ago) x 100 under
   *  a "(%)" suffix; the pipeline divides by 100 and this is the honest unit. */
  median_dom_yoy: number | null;
  months_of_supply: number | null;
  /** A change in MONTHS, not a percent. Same correction as median_dom_yoy. */
  months_of_supply_yoy: number | null;
  /** Percent, 50..200 — Redfin clamps it there. */
  avg_sale_to_list_ratio: number | null;
  avg_sale_to_list_ratio_yoy: number | null;
  /** Percent. Measured against the ORIGINAL list price since the 2026-05
   *  rebuild — not comparable to older history. */
  sold_above_list: number | null;
  sold_above_list_yoy: number | null;
  off_market_in_two_weeks: number | null;
  off_market_in_two_weeks_yoy: number | null;
}

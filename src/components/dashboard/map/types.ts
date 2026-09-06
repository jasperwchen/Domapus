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

  // --- Statistics, computed by the pipeline ---------------------------------
  /** Relative standard error of the median sale price: K / sqrt(homes_sold),
   *  as a FRACTION (0.046 = 4.6%). See pipeline/noise.py. */
  msp_rse: number | null;
  /** The same, for median days on market, with its own fitted K. */
  dom_rse: number | null;
  /** Reliability tier 0..3 of the SALE SAMPLE — a property of the transaction
   *  count, not of the painted metric. This is what the paint byte's high nibble
   *  carries, which is why it is metric-invariant. */
  rel: number | null;
  /** Standard error of the year-over-year change, propagated. */
  msp_yoy_se: number | null;
  /** 12-month-ahead ZHVI forecast, in dollars. */
  f_h12: number | null;
  /** One-step residual sd. The client reconstructs any confidence band as
   *  `exp(log(f_h12) + q[h][p] * f_sigma)` — two multiplies and an exp. */
  f_sigma: number | null;
  /** 3 full AR(1) fit · 2 short history · 1 metro path · 0 no forecast. */
  f_tier: number | null;
  /** Local Moran's I class: 0 ns · 1 HH · 2 LL · 3 LH · 4 HL. Computed only over
   *  the rankable set — ungated it is a low-sample detector, not a statistic. */
  lisa: number | null;

  /** Bbox offsets from the anchor, x1e4 degrees. Real polygon bounds. */
  bw: number | null;
  bs: number | null;
  be: number | null;
  bn: number | null;
  /** Coverage: 0 none · 1 zhvi only · 2 redfin only · 3 both. */
  cov: number | null;
}

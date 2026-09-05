// Single source of truth for metric metadata. Used by:
//   - MetricSelector dropdown (the `painted` subset only)
//   - Legend (display name + value formatting)
//   - Sidebar (label, change key, format)
//   - ZipComparison (label + format)
//   - PrintStage (display name, buckets)
//   - data-processor worker (via getMetricValue)
//
// Keys here must match `KEY_ORDER` in pipeline/serialize.py exactly. The wire
// format is positional — the worker zips `f` against each row — so a name that
// disagrees silently reads a neighbouring column.
//
// WHY THERE IS NO `momKey` EXCEPT ON ZHVI. Redfin publishes no month-over-month
// at ZIP level: measured 0 non-null cells in 4,930,000 x 14. That is deliberate
// on their side — the ZIP window is a rolling three months, NSA, so consecutive
// windows overlap by two thirds and a raw MoM would be dominated by season.
// ZHVI is `sm_sa`, smoothed and seasonally adjusted on true calendar months, so
// its MoM is the thing MoM is supposed to mean. See spec section 1.5.6.

import type { ZipData } from "@/components/dashboard/map/types";

/** How a level is rendered. */
export type FormatType = "price" | "number" | "days" | "percent" | "months";

/**
 * How a change is rendered. NOT all changes are percents, and treating them as
 * one is a correctness bug, not a formatting nit:
 *   percent — a ratio change, "+4.2%"
 *   ppt     — a percentage-point difference on an already-percent level, "+2.3 pts"
 *   days    — a level difference in whole days, "+17 days"
 *   months  — a level difference in months, "-1.4 months"
 *
 * `days` and `months` exist because Redfin ships `MEDIAN DAYS ON MARKET YOY (%)`
 * and `MONTHS OF SUPPLY YOY (%)` as (now - year_ago) x 100 under a "(%)" suffix
 * that is a lie. The pipeline divides them by 100 and ships the honest unit;
 * these two must never be labelled a percent anywhere in the UI.
 */
export type ChangeFormat = "percent" | "ppt" | "days" | "months";

export interface MetricInfo {
  key: keyof ZipData;
  label: string;
  format: FormatType;
  /** Year-over-year companion, if the metric has one. */
  yoyKey?: keyof ZipData;
  yoyFormat?: ChangeFormat;
  /** Month-over-month. ZHVI only — see the header comment. */
  momKey?: keyof ZipData;
  momFormat?: ChangeFormat;
  /** Offered in the map's metric dropdown. The rest are detail-panel only. */
  painted?: boolean;
}

export const METRICS: Record<string, MetricInfo> = {
  // --- Painted: offered in the dropdown -------------------------------------
  zhvi: {
    key: "zhvi", label: "Zillow Home Value Index", format: "price",
    momKey: "zhvi_mom", momFormat: "percent",
    yoyKey: "zhvi_yoy", yoyFormat: "percent", painted: true,
  },
  median_sale_price: {
    key: "median_sale_price", label: "Median Sale Price", format: "price",
    yoyKey: "median_sale_price_yoy", yoyFormat: "percent", painted: true,
  },
  median_ppsf: {
    key: "median_ppsf", label: "Median Price per Sq Ft", format: "price",
    yoyKey: "median_ppsf_yoy", yoyFormat: "percent", painted: true,
  },
  homes_sold: {
    key: "homes_sold", label: "Homes Sold", format: "number",
    yoyKey: "homes_sold_yoy", yoyFormat: "percent", painted: true,
  },
  active_listings: {
    key: "active_listings", label: "Active Listings", format: "number",
    yoyKey: "active_listings_yoy", yoyFormat: "percent", painted: true,
  },
  median_dom: {
    key: "median_dom", label: "Median Days on Market", format: "days",
    yoyKey: "median_dom_yoy", yoyFormat: "days", painted: true,
  },
  sold_above_list: {
    key: "sold_above_list", label: "% Sold Above List", format: "percent",
    yoyKey: "sold_above_list_yoy", yoyFormat: "ppt", painted: true,
  },
  months_of_supply: {
    key: "months_of_supply", label: "Months of Supply", format: "months",
    yoyKey: "months_of_supply_yoy", yoyFormat: "months", painted: true,
  },

  // --- Detail panel only ----------------------------------------------------
  median_list_price: {
    key: "median_list_price", label: "Median New Listing Price", format: "price",
    yoyKey: "median_list_price_yoy", yoyFormat: "percent",
  },
  median_list_ppsf: {
    key: "median_list_ppsf", label: "Median Listing Price per Sq Ft", format: "price",
    yoyKey: "median_list_ppsf_yoy", yoyFormat: "percent",
  },
  new_listings: {
    key: "new_listings", label: "New Listings", format: "number",
    yoyKey: "new_listings_yoy", yoyFormat: "percent",
  },
  pending_sales: {
    key: "pending_sales", label: "Pending Sales", format: "number",
    yoyKey: "pending_sales_yoy", yoyFormat: "percent",
  },
  inventory: {
    key: "inventory", label: "Inventory", format: "number",
    yoyKey: "inventory_yoy", yoyFormat: "percent",
  },
  avg_sale_to_list_ratio: {
    key: "avg_sale_to_list_ratio", label: "Sale-to-List Ratio", format: "percent",
    yoyKey: "avg_sale_to_list_ratio_yoy", yoyFormat: "ppt",
  },
  off_market_in_two_weeks: {
    key: "off_market_in_two_weeks", label: "% Off Market in 2 Weeks", format: "percent",
    yoyKey: "off_market_in_two_weeks_yoy", yoyFormat: "ppt",
  },
};

export type MetricKey = keyof typeof METRICS;

/** The dropdown's contents. Eight of fifteen; the rest are detail-panel only. */
export const PAINTED_METRICS: Record<string, MetricInfo> = Object.fromEntries(
  Object.entries(METRICS).filter(([, m]) => m.painted),
);

/** Two of these — `median_list_price` and `sold_above_list` — were REDEFINED by
 *  Redfin in the 2026-05 rebuild and are not comparable to our pre-2026-06
 *  history. `sold_above_list` is now measured against the ORIGINAL list price;
 *  `median_list_price` narrowed to new listings only and runs ~$8k below the
 *  old series. Surface this wherever a time series is drawn (Phase 7). */
export const SERIES_BREAK_2026_06: ReadonlySet<string> = new Set([
  "median_list_price",
  "sold_above_list",
]);

/** Human-readable label for a metric key, or a title-cased fallback. */
export function getMetricLabel(metric: string): string {
  const info = METRICS[metric];
  if (info) return info.label;
  return metric
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

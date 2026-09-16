// Metric metadata. Keys are `ZipData` field names. Only ZHVI has `momKey`: Redfin publishes
// no ZIP-level MoM (rolling three-month windows, NSA).

import type { ZipData } from "@/components/dashboard/map/types";

/** How a level is rendered. */
export type FormatType = "price" | "number" | "days" | "percent" | "months";

/**
 * How a change is rendered:
 *   percent  ratio change, "+4.2%"
 *   ppt      percentage-point change on a percent level, "+2.3 pts"
 *   days     difference in days, "+17 days"
 *   months   difference in months, "-1.4 months"
 * DOM and months-of-supply YoY are never percents.
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

/**
 * Detail panel groups: cost, pace, supply. Most-asked-for metric first in each.
 */
export const METRIC_GROUPS: { id: string; label: string; keys: string[] }[] = [
  {
    id: "prices",
    label: "Prices",
    keys: [
      "median_sale_price", "zhvi", "median_ppsf",
      "median_list_price", "median_list_ppsf", "avg_sale_to_list_ratio",
    ],
  },
  {
    id: "activity",
    label: "Sales activity",
    keys: [
      "homes_sold", "median_dom", "sold_above_list",
      "pending_sales", "new_listings", "off_market_in_two_weeks",
    ],
  },
  {
    id: "supply",
    label: "Supply",
    keys: ["active_listings", "inventory", "months_of_supply"],
  },
];

// Every metric belongs to exactly one group, or the panel silently drops it.
// This runs at module load, which is the only time it can fail usefully.
if (import.meta.env.DEV) {
  const grouped = METRIC_GROUPS.flatMap((g) => g.keys);
  const missing = Object.keys(METRICS).filter((k) => !grouped.includes(k));
  const unknown = grouped.filter((k) => !(k in METRICS));
  if (missing.length || unknown.length) {
    console.error(
      "[metrics] METRIC_GROUPS is out of sync with METRICS.",
      { notGrouped: missing, noSuchMetric: unknown },
    );
  }
}

/** The dropdown's contents. Eight of fifteen; the rest are detail-panel only. */
export const PAINTED_METRICS: Record<string, MetricInfo> = Object.fromEntries(
  Object.entries(METRICS).filter(([, m]) => m.painted),
);

/** Human-readable label for a metric key, or a title-cased fallback. */
export function getMetricLabel(metric: string): string {
  const info = METRICS[metric];
  if (info) return info.label;
  return metric
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

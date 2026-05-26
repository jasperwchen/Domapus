// Single source of truth for metric metadata. Used by:
//   - MetricSelector dropdown
//   - Legend (display name + value formatting)
//   - Sidebar (label, mom/yoy keys, format)
//   - ZipComparison (label + format)
//   - PrintStage (display name, buckets)
//   - data-processor worker (via getMetricValue)
//
// Adding a new metric: append to METRICS in the desired dropdown position;
// the worker and Python pipeline must also know the column name.

import type { ZipData } from "@/components/dashboard/map/types";

export type FormatType =
  | "currency" | "number" | "percent" | "ratio" | "price" | "days" | "percentage";

export interface MetricInfo {
  key: keyof ZipData;
  label: string;
  format: FormatType;
  momKey?: keyof ZipData;
  yoyKey?: keyof ZipData;
}

export const METRICS: Record<string, MetricInfo> = {
  zhvi: { key: "zhvi", label: "Zillow Home Value Index", format: "price", momKey: "zhvi_mom", yoyKey: "zhvi_yoy" },
  median_sale_price: { key: "median_sale_price", label: "Median Sale Price", format: "price", momKey: "median_sale_price_mom", yoyKey: "median_sale_price_yoy" },
  median_list_price: { key: "median_list_price", label: "Median List Price", format: "price", momKey: "median_list_price_mom", yoyKey: "median_list_price_yoy" },
  median_ppsf: { key: "median_ppsf", label: "Median Price per Sq Ft", format: "price", momKey: "median_ppsf_mom", yoyKey: "median_ppsf_yoy" },
  homes_sold: { key: "homes_sold", label: "Homes Sold", format: "number", momKey: "homes_sold_mom", yoyKey: "homes_sold_yoy" },
  pending_sales: { key: "pending_sales", label: "Pending Sales", format: "number", momKey: "pending_sales_mom", yoyKey: "pending_sales_yoy" },
  new_listings: { key: "new_listings", label: "New Listings", format: "number", momKey: "new_listings_mom", yoyKey: "new_listings_yoy" },
  inventory: { key: "inventory", label: "Inventory", format: "number", momKey: "inventory_mom", yoyKey: "inventory_yoy" },
  avg_sale_to_list_ratio: { key: "avg_sale_to_list_ratio", label: "Sale-to-List Ratio", format: "ratio", momKey: "avg_sale_to_list_mom", yoyKey: "avg_sale_to_list_ratio_yoy" },
  median_dom: { key: "median_dom", label: "Median Days on Market", format: "number", momKey: "median_dom_mom", yoyKey: "median_dom_yoy" },
  sold_above_list: { key: "sold_above_list", label: "% Sold Above List", format: "percent", momKey: "sold_above_list_mom", yoyKey: "sold_above_list_yoy" },
  off_market_in_two_weeks: { key: "off_market_in_two_weeks", label: "% Off Market in 2 Weeks", format: "percent", momKey: "off_market_in_two_weeks_mom", yoyKey: "off_market_in_two_weeks_yoy" },
};

export type MetricKey = keyof typeof METRICS;

// Metrics present in zip-data-lite.json (fast initial render).
export const LITE_METRICS = new Set<string>(["zhvi"]);

/** Returns the human-readable label for a metric key, or a title-cased fallback. */
export function getMetricLabel(metric: string): string {
  const info = METRICS[metric];
  if (info) return info.label;
  return metric
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

import { ZipData } from "./types";
import {
  METRICS, PAINTED_METRICS, getMetricLabel,
  type ChangeFormat, type FormatType, type MetricInfo,
} from "@/lib/metrics";
import { getMetricValue } from "@/lib/metric-value";
import { computeQuantileBuckets } from "@/lib/quantiles";

// Re-exports so existing call sites continue to work without churn.
export {
  METRICS as METRIC_DEFINITIONS, PAINTED_METRICS,
  getMetricLabel, getMetricValue, computeQuantileBuckets,
};
export type { ChangeFormat, FormatType, MetricInfo };

// State code → full name
const STATE_MAP: Record<string, string> = {
  'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas', 'CA': 'California',
  'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware', 'FL': 'Florida', 'GA': 'Georgia',
  'HI': 'Hawaii', 'ID': 'Idaho', 'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa',
  'KS': 'Kansas', 'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
  'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi', 'MO': 'Missouri',
  'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada', 'NH': 'New Hampshire', 'NJ': 'New Jersey',
  'NM': 'New Mexico', 'NY': 'New York', 'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio',
  'OK': 'Oklahoma', 'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
  'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah', 'VT': 'Vermont',
  'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia', 'WI': 'Wisconsin', 'WY': 'Wyoming',
  'DC': 'District of Columbia', 'PR': 'Puerto Rico', 'VI': 'Virgin Islands', 'GU': 'Guam',
  'AS': 'American Samoa', 'MP': 'Northern Mariana Islands'
};

export function getStateName(stateCode: string | null | undefined): string {
  if (!stateCode) return "N/A";
  const code = stateCode.trim().toUpperCase();
  return STATE_MAP[code] || stateCode;
}

// Format a level for display.
export function formatMetricValue(value: number | null | undefined, format: FormatType): string {
  if (value === null || value === undefined || isNaN(value)) return "N/A";

  switch (format) {
    case "price":
      return `$${value.toLocaleString()}`;
    case "percent":
      return `${value.toFixed(1)}%`;
    case "days":
      return `${Math.round(value).toLocaleString()} days`;
    case "months":
      return `${value.toFixed(1)} months`;
    case "number":
    default:
      return value.toLocaleString();
  }
}

/**
 * Format a change. NOT every change is a percent.
 *
 * `median_dom_yoy` and `months_of_supply_yoy` are level differences in days and
 * months. Redfin ships them as (now - year_ago) x 100 under a "(%)" suffix that
 * is a lie; the pipeline divides by 100 and ships the honest unit. Rendering
 * either with a "%" here would put the lie back.
 *
 * `ppt` is for changes on an already-percent level: a share going 48.5% -> 50.8%
 * moved 2.3 percentage POINTS, not 2.3 percent.
 */
export function formatChange(
  value: number | null | undefined,
  format: ChangeFormat = "percent",
): { formatted: string; isPositive: boolean; isZero: boolean } {
  const n = Number(value);
  if (value === null || value === undefined || isNaN(n)) {
    return { formatted: "N/A", isPositive: false, isZero: true };
  }
  const sign = n > 0 ? "+" : "";
  let formatted: string;
  switch (format) {
    case "days": {
      const d = Math.round(n);
      formatted = `${d > 0 ? "+" : ""}${d.toLocaleString()} ${Math.abs(d) === 1 ? "day" : "days"}`;
      break;
    }
    case "months":
      formatted = `${sign}${n.toFixed(1)} ${Math.abs(n) === 1 ? "month" : "months"}`;
      break;
    case "ppt":
      formatted = `${sign}${n.toFixed(1)} pts`;
      break;
    case "percent":
    default:
      formatted = `${sign}${n.toFixed(1)}%`;
  }
  return { formatted, isPositive: n > 0, isZero: n === 0 };
}

// Compare two values for comparison views
export function getComparison(current: number | null | undefined, compare: number | null | undefined): 'higher' | 'lower' | 'same' {
  const currentNum = Number(current);
  const compareNum = Number(compare);
  if (isNaN(currentNum) || isNaN(compareNum)) return 'same';

  const diff = currentNum - compareNum;
  if (Math.abs(diff) < 0.01) return 'same';
  return diff > 0 ? 'higher' : 'lower';
}

export function createMetricPopupContent(data: ZipData, selectedMetric: string): HTMLElement {
  const root = document.createElement("div");

  if (!data || !data.zipCode) {
    root.className = "p-2";
    root.textContent = "No data available";
    return root;
  }

  const metricInfo = METRICS[selectedMetric];
  const value = metricInfo ? data[metricInfo.key] : null;
  const formattedValue = typeof value === "number" && isFinite(value)
    ? formatMetricValue(value, metricInfo?.format || "number")
    : "N/A";

  const add = (className: string, text: string) => {
    const el = document.createElement("div");
    el.className = className;
    el.textContent = text;
    root.appendChild(el);
    return el;
  };

  add("font-bold text-base", data.zipCode);
  add("text-sm text-gray-600", `${data.city || "Unknown City"}, ${getStateName(data.state)}`);

  const metricRow = document.createElement("div");
  metricRow.className = "text-sm mt-2";
  const label = document.createElement("span");
  label.className = "font-semibold";
  label.textContent = `${metricInfo?.label || selectedMetric}:`;
  const val = document.createElement("span");
  val.className = "font-normal";
  val.textContent = ` ${formattedValue}`;
  metricRow.append(label, val);
  root.appendChild(metricRow);

  add("text-[10px] text-gray-400 mt-1 flex items-center", "Click ZIP code to view details");

  return root;
}

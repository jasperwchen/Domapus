import { ZipData } from "./types";
import { METRICS, getMetricLabel, type FormatType, type MetricInfo } from "@/lib/metrics";
import { getMetricValue } from "@/lib/metric-value";
import { computeQuantileBuckets } from "@/lib/quantiles";

// Re-exports so existing call sites continue to work without churn.
export { METRICS as METRIC_DEFINITIONS, getMetricLabel, getMetricValue, computeQuantileBuckets };
export type { FormatType, MetricInfo };

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

// Format any numeric value based on format type
export function formatMetricValue(value: number | null | undefined, format: FormatType): string {
  if (value === null || value === undefined || isNaN(value)) return "N/A";

  switch (format) {
    case 'currency':
    case 'price':
      return `$${value.toLocaleString()}`;
    case 'percent':
    case 'percentage':
      return `${value.toFixed(1)}%`;
    case 'ratio':
      return `${value.toFixed(1)}%`;
    case 'days':
      return `${value} days`;
    case 'number':
    default:
      return value.toLocaleString();
  }
}

// Format change values (MoM, YoY) with sign indicator
export function formatChange(value: number | null | undefined): { formatted: string; isPositive: boolean; isZero: boolean } {
  if (value === null || value === undefined) return { formatted: "N/A", isPositive: false, isZero: true };
  const numValue = Number(value);
  if (isNaN(numValue)) return { formatted: "N/A", isPositive: false, isZero: true };
  const isPositive = numValue > 0;
  const isZero = numValue === 0;
  return { formatted: `${isPositive ? "+" : ""}${numValue.toFixed(1)}%`, isPositive, isZero };
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

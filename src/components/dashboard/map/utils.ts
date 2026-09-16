import { ZipData } from "./types";
import { METRICS, type ChangeFormat, type FormatType } from "@/lib/metrics";

export { METRICS as METRIC_DEFINITIONS };
export type { FormatType };

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
      // Whole dollars. `toLocaleString()` with no options keeps up to three
      // fraction digits, so the per-square-foot metrics printed whatever their
      // value happened to carry — $1,744.3 sat directly above $1,786.29 in the
      // same column. Cents are below the noise floor of a median anyway.
      return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
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
 * Format a change. DOM and months-of-supply YoY are day/month differences, never %; `ppt` is
 * a percentage-point change on a percent level.
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

  // Uncertainty line: `msp_rse` for median sale price, `dom_rse` for DOM, nothing otherwise.
  const rse = uncertaintyFor(data, selectedMetric);
  if (rse !== null && typeof data.homes_sold === "number") {
    const sales = data.homes_sold;
    add(
      "text-xs text-gray-500 mt-1",
      `±${(rse * 100).toFixed(1)}% (${sales.toLocaleString()} ${sales === 1 ? "sale" : "sales"})`,
    );
  }

  if (data.lisa) {
    const label = LISA_LABELS[data.lisa];
    if (label) add("text-xs text-gray-500", label);
  }

  add("text-[10px] text-gray-400 mt-1 flex items-center", "Click ZIP code to view details");

  return root;
}

/** The RSE that describes this metric, if any. A whitelist, never a fallback. */
function uncertaintyFor(data: ZipData, metric: string): number | null {
  const key = metric === "median_sale_price" ? "msp_rse"
    : metric === "median_dom" ? "dom_rse"
    : null;
  if (!key) return null;
  const v = data[key as keyof ZipData];
  return typeof v === "number" && isFinite(v) ? v : null;
}

/** Popup text for the outlier classes only (HH/LL restate the map). Descriptive wording, no
 *  "significant": this is a permutation screen, not a hypothesis test. */
export const LISA_LABELS: Record<number, string> = {
  3: "Cheaper than the ZIPs around it",
  4: "More expensive than the ZIPs around it",
};

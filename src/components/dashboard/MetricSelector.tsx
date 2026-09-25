import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PAINTED_METRICS, type MetricKey } from "@/lib/metrics";

export type MetricType = MetricKey;

// The painted 8 of 15 metrics. Spearman on the latest period collapses the 14 Redfin metrics
// to ~5 axes (counts rho 0.91-0.99), so the rest would repeat the same map.
// Key -> label for the painted metrics.
export const PAINTED_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(PAINTED_METRICS).map(([key, info]) => [key, info.label])
);

interface MetricSelectorProps {
  selectedMetric: MetricType;
  onMetricChange: (metric: MetricType) => void;
}

export function MetricSelector({ selectedMetric, onMetricChange }: MetricSelectorProps) {
  const handleMetricChange = (metric: string) => {
    onMetricChange(metric as MetricType);
  };

  return (
    <div className="flex items-center gap-1 min-w-0">
      <label className="text-xs font-medium text-dashboard-text-secondary whitespace-nowrap hidden 2xl:block">
        Metric:
      </label>
      <Select value={selectedMetric} onValueChange={handleMetricChange}>
        <SelectTrigger
          // Full width on the mobile row; fixed in the desktop header, which is crowded.
          className="w-full md:w-36 lg:w-48 h-9 text-sm px-3 justify-between shrink-0"
          aria-label="Select visualization metric"
        >
          <div className="flex-1 text-left truncate pr-2">
            <SelectValue placeholder="Select a metric" />
          </div>
        </SelectTrigger>
        <SelectContent className="z-[9999]">
          {Object.entries(PAINTED_LABELS).map(([key, label]) => (
            <SelectItem key={key} value={key}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PAINTED_METRICS, type MetricKey } from "@/lib/metrics";

export type MetricType = MetricKey;

// The dropdown offers the PAINTED subset only — 8 of 15. The other 7 are carried
// on the wire and shown in the ZIP detail panel, but never colour the map.
//
// The cut is measured, not taste: pairwise Spearman on the latest period
// collapses the 14 Redfin metrics to ~5 independent axes. The five count metrics
// are effectively one variable (rho 0.91-0.99; new_listings vs active_listings
// is 0.986) and the four price metrics another (0.81-0.89). Offering all 15
// would be offering the same map several times over.
//
// Tests and a couple of legacy callers import `METRICS` from this file as a flat
// key -> label record. Keep that shape.
export const METRICS: Record<string, string> = Object.fromEntries(
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
    <div className="flex items-center gap-1">
      <label className="text-xs font-medium text-dashboard-text-secondary whitespace-nowrap hidden lg:block">
        Metric:
      </label>
      <Select value={selectedMetric} onValueChange={handleMetricChange}>
        <SelectTrigger className="w-48 h-9 text-sm px-3 justify-between" aria-label="Select visualization metric">
          <div className="flex-1 text-left truncate pr-2">
            <SelectValue placeholder="Select a metric" />
          </div>
        </SelectTrigger>
        <SelectContent className="z-[9999]">
          {Object.entries(METRICS).map(([key, label]) => (
            <SelectItem key={key} value={key}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

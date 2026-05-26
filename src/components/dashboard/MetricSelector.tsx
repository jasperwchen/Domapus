import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { METRICS as METRIC_INFO, LITE_METRICS, type MetricKey } from "@/lib/metrics";

export type MetricType = MetricKey;

// Tests and a couple of legacy callers import `METRICS` from this file
// as a flat key → label record. Keep that shape, sourced from the
// authoritative METRICS in lib/metrics.ts.
export const METRICS: Record<string, string> = Object.fromEntries(
  Object.entries(METRIC_INFO).map(([key, info]) => [key, info.label])
);

interface MetricSelectorProps {
  selectedMetric: MetricType;
  onMetricChange: (metric: MetricType) => void;
  isFullDataLoaded?: boolean;
}

export function MetricSelector({ selectedMetric, onMetricChange, isFullDataLoaded = false }: MetricSelectorProps) {
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
          {Object.entries(METRICS).map(([key, label]) => {
            const isLoading = !isFullDataLoaded && !LITE_METRICS.has(key);
            return (
              <SelectItem key={key} value={key} disabled={isLoading}>
                <span className="flex items-center gap-1.5">
                  {label}
                  {isLoading && (
                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                  )}
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}

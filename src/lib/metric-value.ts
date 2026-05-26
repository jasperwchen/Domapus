// Pure helper extracted so the worker and the main thread share one implementation.

import type { ZipData } from "@/components/dashboard/map/types";

export function getMetricValue(data: ZipData | undefined, metric: string): number {
  if (!data) return 0;
  const value = data[metric as keyof ZipData];
  return typeof value === "number" && isFinite(value) ? value : 0;
}

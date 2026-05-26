// Quantile helpers. Previously three slightly different implementations lived
// in map/utils, PrintStage, and the worker (under similar names).

import * as d3 from "d3-scale";

/**
 * Computes quantile bucket thresholds (numBuckets - 1 boundaries) from positive values.
 * Returns the thresholds used to step a choropleth color ramp.
 */
export function computeQuantileBuckets(values: number[], numBuckets = 8): number[] {
  const validValues = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (validValues.length === 0) return [];

  const scale = d3
    .scaleQuantile<number>()
    .domain(validValues)
    .range(Array.from({ length: numBuckets }, (_, i) => i));

  return scale.quantiles();
}

/** Linear-interpolated quantiles at the given percentiles. */
export function computeQuantiles(values: number[], percentiles: number[]): number[] {
  if (!values || values.length === 0) return percentiles.map(() => 0);
  const sorted = [...values].sort((a, b) => a - b);
  return percentiles.map((p) => {
    const idx = (sorted.length - 1) * p;
    const lower = Math.floor(idx);
    const upper = Math.ceil(idx);
    const weight = idx - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  });
}

/** Returns the 5th and 95th percentile values from a positive-only sample. */
export function computeQuantileBounds5_95(values: number[]): { min: number; max: number } {
  const sorted = [...values].filter((v) => v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return { min: 0, max: 1 };
  const q = (p: number) => sorted[Math.floor(p * (sorted.length - 1))];
  return { min: q(0.05), max: q(0.95) };
}

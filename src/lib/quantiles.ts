// Quantile helpers for READING a distribution — legend ticks and axis bounds.
//
// Nothing here cuts class boundaries. `computeQuantileBuckets` used to, and was
// deleted 2026-09-12: it cut plain equal-count quantiles for every metric, which
// is the scheme mismatch `class-source.ts` documents at length. Auto-scale asks
// `fitBreaks` in `classing.ts` instead, because that reads the scheme and the
// break gate out of the manifest and so reproduces the pipeline's own cuts.
// Reach for `fitBreaks`, never for a quantile helper, when the question is
// "which class is this ZIP in".

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

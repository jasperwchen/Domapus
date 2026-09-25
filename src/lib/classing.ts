// Class boundaries, ported from pipeline/classify.py, for auto-scale re-cuts. The scheme
// comes from the manifest; given the pipeline's own sample this reproduces its breaks
// exactly (classing.test.ts). The only place allowed to cut classes on the client.

import type { ZipData } from "@/components/dashboard/map/types";
import { CLASSES } from "./choropleth";

/** Linear-interpolated percentile on an ASCENDING array, matching numpy's default. */
function percentile(sorted: number[], p: number): number {
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] * (1 - (idx - lo)) + sorted[hi] * (idx - lo);
}

/** `CLASSES - 1` equally spaced quantiles. */
function quantileBreaks(sorted: number[]): number[] {
  return Array.from({ length: CLASSES - 1 }, (_, i) =>
    percentile(sorted, (i + 1) / CLASSES));
}

/** Equal intervals on log10 between the p1 and p99 anchors. Ratio-preserving. */
function logEqualBreaks(sorted: number[]): number[] | null {
  const pos = sorted[0] > 0 ? sorted : sorted.filter((v) => v > 0);
  if (pos.length < CLASSES) return null;
  const lo = Math.log10(percentile(pos, 0.01));
  const hi = Math.log10(percentile(pos, 0.99));
  if (!(hi > lo)) return null;
  const step = (hi - lo) / CLASSES;
  return Array.from({ length: CLASSES - 1 }, (_, i) => 10 ** (lo + step * (i + 1)));
}

/** Equal intervals over [0, 100]; viewport-independent by design. */
function equalInterval0100Breaks(): number[] {
  return Array.from({ length: CLASSES - 1 }, (_, i) => (100 * (i + 1)) / CLASSES);
}

/**
 * `CLASSES - 1` boundaries for `sample` under `scheme`, or null meaning "use the shipped
 * breaks": too small or degenerate a sample, or an unknown scheme from a newer pipeline.
 */
export function fitBreaks(scheme: string | undefined, sample: number[]): number[] | null {
  if (!scheme || sample.length < CLASSES) return null;

  const sorted = [...sample].sort((a, b) => a - b);
  let edges: number[] | null;
  switch (scheme) {
    case "quantile": edges = quantileBreaks(sorted); break;
    case "log_equal_p1_p99": edges = logEqualBreaks(sorted); break;
    case "equal_interval_0_100": edges = equalInterval0100Breaks(); break;
    default: return null;
  }
  if (!edges) return null;

  // Match the pipeline's 4 dp rounding so identical samples compare equal.
  edges = edges.map((e) => Math.round(e * 1e4) / 1e4);
  // Quantile edges may tie (an empty class, as in the pipeline); other schemes stay strict.
  const tiesOk = scheme === "quantile";
  for (let i = 1; i < edges.length; i++) {
    if (edges[i] < edges[i - 1] || (!tiesOk && edges[i] === edges[i - 1])) return null;
  }
  if (edges[0] === edges[edges.length - 1]) return null;
  return edges;
}

/**
 * Breaks cut on one exported area's ZIPs under the pipeline's own scheme and break gate, or
 * null when the area is too small to cut or the scheme ignores the sample (equal intervals
 * over 0-100 would be the national scale under another name).
 */
export function areaBreaks(
  rows: readonly ZipData[],
  metric: string,
  spec: { scheme?: string; break_gate?: string | null },
): number[] | null {
  if (spec.scheme === "equal_interval_0_100") return null;
  const gated = spec.break_gate !== "all_reporting";
  const sample: number[] = [];
  for (const row of rows) {
    const v = row[metric as keyof ZipData];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    if (gated && (row.rel ?? 0) < 1) continue;
    sample.push(v);
  }
  return fitBreaks(spec.scheme, sample);
}

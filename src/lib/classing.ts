// How class boundaries are cut, ported from `pipeline/classify.py`.
//
// This exists so that AUTO-SCALE CHANGES THE SAMPLE AND NOTHING ELSE. The
// viewport source used to cut plain quantiles for every metric no matter what
// scheme the pipeline had used, so flipping the toggle swapped the classing
// method as well as the sample. On the full national extent, where the sample is
// the same data the pipeline classed, the two still disagreed violently:
// `zhvi` is classed log-equal between its p1 and p99 anchors, which puts 6.0% of
// ZIPs in the two darkest classes, while quantiles put 14.3% in every class by
// construction — 28.6% in the darkest two, a 4.8x jump [M, 2026-09 release].
// The map went dark on a toggle whose label promises only a change of sample.
//
// The pipeline stays the authority on WHICH scheme a metric gets: the scheme
// name and the break gate are read from the manifest, never decided here. This
// module only re-runs the named scheme over a smaller sample. Feeding it the
// pipeline's own break population reproduces the pipeline's own breaks exactly,
// which is what `classing.test.ts` asserts.

import { CLASSES } from "./choropleth";

/** Linear-interpolated percentile on an ASCENDING array, matching numpy's default. */
function percentile(sorted: number[], p: number): number {
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] * (1 - (idx - lo)) + sorted[hi] * (idx - lo);
}

/** Six equally-spaced quantiles. Ties collapse classes; that is real. */
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

/** Equal intervals over the definitional [0, 100] domain. Reads no sample, so an
 *  auto-scaled view of a bounded share shows the same boundaries as the national
 *  map — which is the point: the domain does not change with the viewport. */
function equalInterval0100Breaks(): number[] {
  return Array.from({ length: CLASSES - 1 }, (_, i) => (100 * (i + 1)) / CLASSES);
}

/** Equal-width classes whose grid is pinned to 100%, width from the p1..p99 span.
 *  For series that PIVOT at 100% (the sale-to-list ratio), not for shares bounded
 *  by it — see `equalInterval0100Breaks`. */
function equalAnchored100Breaks(sorted: number[]): number[] | null {
  const width = (percentile(sorted, 0.99) - percentile(sorted, 0.01)) / CLASSES;
  if (!(width > 0)) return null;
  const out: number[] = [];
  for (let k = CLASSES - 1; k >= 1; k--) out.push(100 - width * k);
  return out;
}

/**
 * `CLASSES - 1` boundaries for `sample` under the pipeline's named `scheme`, or
 * null when the scheme cannot honestly be re-cut on this sample.
 *
 * Null means FALL BACK TO THE SHIPPED BREAKS, not "invent something". Three
 * cases produce it, and all three are real:
 *   - `diverging`, which the pipeline fixes rather than recomputing, because a
 *     rescaled YoY map renders a flat year and a boom identically;
 *   - a sample too small or too degenerate to cut, where the pipeline raises;
 *   - a scheme name this build does not know, which means the manifest is from a
 *     newer pipeline and guessing would be worse than not moving.
 */
export function fitBreaks(scheme: string | undefined, sample: number[]): number[] | null {
  if (!scheme || sample.length < CLASSES) return null;

  const sorted = [...sample].sort((a, b) => a - b);
  let edges: number[] | null;
  switch (scheme) {
    case "quantile": edges = quantileBreaks(sorted); break;
    case "log_equal_p1_p99": edges = logEqualBreaks(sorted); break;
    case "equal_anchored_100": edges = equalAnchored100Breaks(sorted); break;
    case "equal_interval_0_100": edges = equalInterval0100Breaks(); break;
    default: return null;
  }
  if (!edges) return null;

  // The pipeline rounds to 4 dp before shipping, so rounding here is what makes
  // a re-cut over the same sample compare equal rather than merely close.
  edges = edges.map((e) => Math.round(e * 1e4) / 1e4);
  for (let i = 1; i < edges.length; i++) {
    if (edges[i] <= edges[i - 1]) return null;
  }
  return edges;
}

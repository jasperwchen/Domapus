// Who decides which class a ZIP is in. Exactly one authority is live at a time.
//
// | Mode                    | Authority            | Available |
// |-------------------------|----------------------|-----------|
// | Fixed scale (default)   | `PaintTable`         | Phase 4 onward |
// | Fixed scale, Phase 3    | `LegacyClassSource`  | now; deleted when PaintTable lands |
// | Auto scale (opt-in)     | `ViewportClassSource`| now, over the loaded rows |
//
// WHY `LegacyClassSource` HAS TO EXIST. Phase 3 ships a CONSTANT paint expression
// that reads `["feature-state", "k"]`, but the artifact that supplies `k` — the
// pipeline's precomputed paint table — does not ship until Phase 4. With no
// interim authority the map would read a feature-state key nothing writes and
// render entirely as NO_DATA_COLOR.
//
// It is deliberately throwaway, and that is the point: `ChoroplethPainter` never
// learns where classes come from, so swapping the authority in Phase 4 is a
// one-line change and the Phase 3 benchmark measures the same painter that ships.

import type { ZipData } from "@/components/dashboard/map/types";
import { CLASSES } from "./choropleth";
import { getMetricValue } from "./metric-value";
import { span } from "./perf";
import { computeQuantileBuckets } from "./quantiles";

export interface ClassSource {
  /** 0..K-1, or -1 for no data. */
  classOf(zip: string): number;
  /** 0..3, or -1. Drives fill-opacity via feature-state, never a paint rewrite. */
  reliabilityOf(zip: string): number;
  /** Bumped whenever `classOf` would answer differently. */
  readonly epoch: number;
  /** Every ZIP this source can answer for. Stable identity per epoch. */
  readonly zips: readonly string[];
  /** Class boundaries, low to high. `CLASSES - 1` of them. For the legend. */
  readonly breaks: readonly number[];
}

// One counter for the whole module, so two sources can never claim the same
// epoch. A repeated epoch would make the painter skip a redraw it needed.
let nextEpoch = 1;

/** Class index for `value` given ascending `breaks`. Values below the first
 *  break are class 0; values at or above the last are class CLASSES-1. */
export function classify(value: number, breaks: readonly number[]): number {
  let k = 0;
  while (k < breaks.length && value >= breaks[k]) k++;
  return k;
}

function valuesFor(rows: Iterable<ZipData>, metric: string): number[] {
  const out: number[] = [];
  for (const row of rows) {
    const v = getMetricValue(row, metric);
    if (v > 0) out.push(v);
  }
  return out;
}

/**
 * Interim national authority: computes the same 7 quantile breaks the pipeline
 * will later precompute, from the already-loaded row-major snapshot.
 *
 * `reliabilityOf` always returns 3 (full opacity). The relative standard error
 * it would need does not exist until Phase 5, and inventing a tier here would
 * fade ZIPs on no evidence.
 */
export class LegacyClassSource implements ClassSource {
  readonly epoch = nextEpoch++;
  readonly zips: readonly string[];
  readonly breaks: readonly number[];
  private readonly classes = new Map<string, number>();

  constructor(data: Record<string, ZipData>, metric: string) {
    this.zips = Object.keys(data);
    this.breaks = span(
      "class:breaks",
      () => computeQuantileBuckets(valuesFor(Object.values(data), metric), CLASSES),
      { metric, n: this.zips.length },
    );
    if (this.breaks.length === 0) return;
    span("class:assign", () => {
      for (const zip of this.zips) {
        const v = getMetricValue(data[zip], metric);
        this.classes.set(zip, v > 0 ? classify(v, this.breaks) : -1);
      }
    }, { metric });
  }

  classOf(zip: string): number {
    return this.classes.get(zip) ?? -1;
  }

  reliabilityOf(): number {
    return 3;
  }
}

/**
 * Auto-scale authority: the same classing, over the ZIPs currently in view.
 *
 * It answers -1 for every ZIP outside the sample. That is correct rather than a
 * gap: a ZIP outside the viewport has no place on a viewport-derived scale, and
 * the painter still writes the full set, so nothing keeps a stale colour.
 */
export class ViewportClassSource implements ClassSource {
  readonly epoch = nextEpoch++;
  readonly zips: readonly string[];
  readonly breaks: readonly number[];
  private readonly classes = new Map<string, number>();

  constructor(data: Record<string, ZipData>, metric: string, visible: readonly string[]) {
    this.zips = Object.keys(data);
    const rows: ZipData[] = [];
    for (const zip of visible) {
      const row = data[zip];
      if (row) rows.push(row);
    }
    this.breaks = computeQuantileBuckets(valuesFor(rows, metric), CLASSES);
    if (this.breaks.length === 0) return;
    for (const zip of visible) {
      const row = data[zip];
      if (!row) continue;
      const v = getMetricValue(row, metric);
      if (v > 0) this.classes.set(zip, classify(v, this.breaks));
    }
  }

  classOf(zip: string): number {
    return this.classes.get(zip) ?? -1;
  }

  reliabilityOf(): number {
    return 3;
  }
}

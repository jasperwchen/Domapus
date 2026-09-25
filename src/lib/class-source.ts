// Who decides a ZIP's class. Exactly one source is live: `PaintTableSource` (fixed scale,
// default) or `ViewportClassSource` (auto-scale). Each new source bumps the epoch, and the
// painter rewrites the full ZIP set, so modes never leave stale colours.

import type * as maplibregl from "maplibre-gl";
import { FADE_EXEMPT, type PaintTable } from "./paint-table";
import { span } from "./perf";
import { fitBreaks } from "./classing";
import { WIRE_OF, type ZipTable } from "./zip-table";

export interface ClassSource {
  /** 0..K-1, or -1 for no data. */
  classOf(zip: string): number;
  /** 0..3, or -1. Written to feature-state as `rel`. */
  reliabilityOf(zip: string): number;
  /** Bumped whenever `classOf` would answer differently. */
  readonly epoch: number;
  /** Every ZIP this source can answer for. Stable identity per epoch. */
  readonly zips: readonly string[];
  /** Class boundaries, low to high. `CLASSES - 1` of them. For the legend. */
  readonly breaks: readonly number[];
}

// Module-wide so two sources never share an epoch (the painter would skip a redraw).
let nextEpoch = 1;

/** Class index for `value` given ascending `breaks`. Values below the first
 *  break are class 0; values at or above the last are class CLASSES-1. */
export function classify(value: number, breaks: readonly number[]): number {
  let k = 0;
  while (k < breaks.length && value >= breaks[k]) k++;
  return k;
}

/** The pipeline's byte-per-ZIP table. The pipeline asserts it agrees with the snapshot. */
export class PaintTableSource implements ClassSource {
  readonly epoch = nextEpoch++;
  readonly zips: readonly string[];
  readonly breaks: readonly number[];

  private readonly faded: boolean;

  constructor(
    private readonly table: PaintTable,
    breaks: readonly number[] | undefined,
    zips: readonly string[],
    metric?: string,
  ) {
    this.breaks = breaks ?? [];
    this.zips = zips;
    this.faded = !metric || !FADE_EXEMPT.has(metric);
  }

  classOf(zip: string): number {
    return this.table.classOf(zip);
  }

  reliabilityOf(zip: string): number {
    // Fade exemption lives here, not in the paint expression, which must stay constant.
    return this.faded ? this.table.reliabilityOf(zip) : 3;
  }
}

/** One metric's classing, from the manifest. The frontend never picks a scheme itself. */
export interface ClassingSpec {
  /** `quantile`, `log_equal_p1_p99` or `equal_interval_0_100`. */
  scheme?: string;
  /** `rankable` for an estimated statistic, `all_reporting` for an exact count. */
  break_gate?: string | null;
  /** The national boundaries, used when a viewport cut is not honest. */
  breaks?: readonly number[];
}

/**
 * Auto-scale: the pipeline's own scheme and break gate, re-cut over the ZIPs in view.
 *
 * Both must match the pipeline or the toggle changes more than the sample: plain quantiles
 * moved 28.6% of ZIPs into the two darkest zhvi classes vs 6.0% fixed, and an ungated sample
 * gave zhvi 26,262 voters vs the pipeline's 9,452. ZIPs outside the view answer -1. When no
 * honest cut exists it defers to the national table. Reliability always comes from the table.
 */
export class ViewportClassSource implements ClassSource {
  readonly epoch = nextEpoch++;
  readonly zips: readonly string[];
  readonly breaks: readonly number[];
  private readonly classes = new Map<string, number>();
  private readonly deferred: boolean;

  constructor(
    store: ZipTable,
    private readonly table: PaintTable,
    private readonly metric: string,
    visibleRows: Int32Array,
    spec: ClassingSpec = {},
  ) {
    this.zips = store.zips;
    const wire = WIRE_OF[metric] ?? metric;
    const gated = spec.break_gate !== "all_reporting";

    const sample: number[] = [];
    for (let i = 0; i < visibleRows.length; i++) {
      const row = visibleRows[i];
      const v = store.valueAt(wire, row);
      if (v === null) continue;
      if (gated && (store.valueAt("rel", row) ?? 0) < 1) continue;
      sample.push(v);
    }

    const fitted = span(
      "class:breaks",
      () => fitBreaks(spec.scheme, sample),
      { metric, n: sample.length },
    );
    this.deferred = fitted === null;
    this.breaks = fitted ?? spec.breaks ?? [];
    if (this.deferred) return;

    span("class:assign", () => {
      for (let i = 0; i < visibleRows.length; i++) {
        const row = visibleRows[i];
        const v = store.valueAt(wire, row);
        if (v !== null) this.classes.set(store.zips[row], classify(v, this.breaks));
      }
    }, { metric });
  }

  classOf(zip: string): number {
    if (this.deferred) return this.table.classOf(zip);
    return this.classes.get(zip) ?? -1;
  }

  reliabilityOf(zip: string): number {
    return FADE_EXEMPT.has(this.metric) ? 3 : this.table.reliabilityOf(zip);
  }
}

/**
 * Rows whose real polygon bbox intersects the viewport: the auto-scale sample. Kept separate
 * from `loadedZips` (the painting scope); conflating them was the original auto-scale bug.
 * A flat scan over ~33k rows is ~0.1 ms, so no spatial index.
 */
export function visibleZipRows(
  loaded: readonly string[],
  store: ZipTable,
  b: maplibregl.LngLatBounds,
): Int32Array {
  const west = b.getWest();
  const south = b.getSouth();
  const east = b.getEast();
  const north = b.getNorth();

  const out = new Int32Array(loaded.length);
  let k = 0;
  for (const zip of loaded) {
    const row = store.rowOf(zip);
    if (row < 0) continue;
    const bounds = store.boundsOf(row);
    if (!bounds) continue;
    if (bounds.east < west || bounds.west > east) continue;
    if (bounds.north < south || bounds.south > north) continue;
    out[k++] = row;
  }
  return out.subarray(0, k);
}

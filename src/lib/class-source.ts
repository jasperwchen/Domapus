// Who decides which class a ZIP is in. Exactly one authority is live at a time.
//
// | Mode                  | Authority             |
// |-----------------------|-----------------------|
// | Fixed scale (default) | `PaintTableSource`    |
// | Auto scale (opt-in)   | `ViewportClassSource` |
//
// `LegacyClassSource` is gone. It existed for one phase only, to supply `k` while
// the paint expression already read `["feature-state","k"]` but the pipeline did
// not yet emit a paint table; with the table shipping, a second in-process
// classing implementation is exactly the "two class authorities" flaw the design
// exists to avoid. `ChoroplethPainter` never learned where classes come from, so
// swapping the authority was the one-line change it was meant to be.
//
// Switching modes bumps the epoch and rewrites the full ZIP set, so the two can
// never overlap or leave stale colours behind.

import type * as maplibregl from "maplibre-gl";
import { FADE_EXEMPT, type PaintTable } from "./paint-table";
import { span } from "./perf";
import { fitBreaks } from "./classing";
import { WIRE_OF, type ZipTable } from "./zip-table";

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

/**
 * The national authority: the pipeline's precomputed byte-per-ZIP table.
 *
 * Nothing is computed here. The breaks came from the same run that encoded the
 * table, over the ZIPs whose median is rankable, and the pipeline asserts the two
 * artifacts agree for every ZIP and every metric before either is published.
 */
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
    // The fade carve-out, applied HERE rather than in the paint expression: a
    // second expression would have to be swapped in on a metric change, and
    // rewriting a data-driven paint value reloads every tile. Reporting full
    // reliability makes the constant expression evaluate to full opacity.
    return this.faded ? this.table.reliabilityOf(zip) : 3;
  }
}

/** What the pipeline decided about one metric's classing, straight from the
 *  manifest. The frontend obeys these; it does not pick a scheme of its own. */
export interface ClassingSpec {
  /** `quantile`, `log_equal_p1_p99`, `equal_anchored_100` or `diverging`. */
  scheme?: string;
  /** `rankable` for an estimated statistic, `all_reporting` for an exact count. */
  break_gate?: string | null;
  /** The national boundaries, used when a viewport cut is not honest. */
  breaks?: readonly number[];
}

/**
 * Auto-scale authority: the same 7 classes and the SAME SCHEME, re-cut over the
 * ZIPs in view.
 *
 * It answers -1 for every ZIP outside the sample. That is correct rather than a
 * gap: a ZIP outside the viewport has no place on a viewport-derived scale, and
 * the painter still writes the full set, so nothing keeps a stale colour.
 *
 * TWO THINGS MUST MATCH THE PIPELINE OR THE TOGGLE LIES, and both used to differ.
 *
 * The SCHEME. This cut plain quantiles for every metric. Prices are classed
 * log-equal between p1 and p99, so on the full national extent — same ZIPs the
 * pipeline classed — the toggle still moved 28.6% of ZIPs into the two darkest
 * classes against the fixed scale's 6.0%. See `classing.ts`.
 *
 * The BREAK POPULATION. Boundaries for an estimated statistic are cut on the
 * rankable set only, so that a four-sale ZIP cannot move the scale for everyone
 * else; exact counts are exempt. Sampling every visible ZIP re-admitted the ZIPs
 * the gate exists to exclude — for `zhvi` that is 26,262 voters against the
 * pipeline's 9,452. Which gate applies is the manifest's call, not ours.
 *
 * Every ZIP in view is still CLASSED either way. The gate decides who votes on
 * where the cuts go, never who gets a colour.
 *
 * Reliability still comes from the paint table. The viewport changes which values
 * set the scale; it does not change how many sales a ZIP had.
 */
export class ViewportClassSource implements ClassSource {
  readonly epoch = nextEpoch++;
  readonly zips: readonly string[];
  readonly breaks: readonly number[];
  private readonly classes = new Map<string, number>();
  /** True when no honest viewport cut was possible and this is answering with
   *  the national table instead. */
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
      // `rel` is the reliability tier the pipeline gated on. Rows missing it
      // fail the gate, the same way a record with no `rel` is not rankable.
      if (gated && (store.valueAt("rel", row) ?? 0) < 1) continue;
      sample.push(v);
    }

    const fitted = span(
      "class:breaks",
      () => fitBreaks(spec.scheme, sample),
      { metric, n: sample.length },
    );
    // No honest viewport cut means the national scale, not a blank map: the
    // source defers wholesale to the table rather than painting -1 everywhere.
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
 * Correct scope for AUTO-SCALE QUANTILES: loaded features whose REAL polygon bbox
 * intersects the viewport.
 *
 * This is the Bug 3 fix. The old spatial index put a 0.01-degree box around each
 * centroid — about 1.1 km, against a measured median ZCTA span of 7.45 km — so
 * every large rural ZCTA fell out of its own viewport and auto-scaling over a view
 * containing one big rural ZIP returned an empty set.
 *
 * DELIBERATELY NOT the same function as `loadedZips`, which is the correct scope
 * for PAINTING (whole loaded tiles, because scoping tighter leaves tile edges
 * unpainted). Conflating the two is what produced the original auto-scale bug, so
 * they stay two named functions rather than one parameterised one.
 *
 * A flat scan of four comparisons over 33k rows is ~0.1 ms. An R-tree of 33k JS
 * objects earns nothing here on either time or memory, which is why `rbush` is
 * gone rather than rebuilt against the new bounds.
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

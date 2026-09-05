import type maplibregl from "maplibre-gl";
import { CHOROPLETH_COLORS, NO_DATA_COLOR } from "./choropleth";
import type { ClassSource } from "./class-source";
import { count, mark, measure } from "./perf";

const SOURCE = "zips";
const SOURCE_LAYER = "us_zip_codes";
const FILL = "zips-fill";
// Writes per animation frame.
//
// MEASURED, not guessed: `map.setFeatureState` costs **0.14 us** per call
// (10,000 calls in 1.4 ms, in-page, unthrottled). The whole 33,771-ZIP set is
// therefore ~5 ms of work — a third of one 16 ms frame.
//
// This was 8,000, which spread the set over five frames. That did not cost five
// frames of writing; it cost five frames of WAITING, because every chunk dirties
// the source and MapLibre does a full map render between them. Measured
// `map:applyChoropleth` fell 579 ms -> 8 ms just by not yielding.
//
// Keep the chunking mechanism: it is the safety valve if the ZIP set ever grows
// far past 100k, where one pass would exceed a frame budget at 0.14 us each.
export const CHUNK = 50_000;

/**
 * Set ONCE at layer creation and NEVER again.
 *
 * maplibre-gl's `style_layer.ts` returns `isDataDriven || wasDataDriven` as
 * `requiresRelayout`, so ANY `setPaintProperty` of a data-driven value makes
 * `style.ts` mark the source `'reload'` — every loaded tile is re-sent to the
 * MapLibre worker, re-parsed from its cached PBF, its fill bucket rebuilt and
 * its GPU buffers re-uploaded, with a visible flash.
 *
 * The previous implementation called `setPaintProperty("zips-fill",
 * "fill-color", <step expression>)` on every metric change AND on every
 * `moveend` in auto-scale mode. Measured user-visible cost of one metric switch:
 * 3375 ms at 4x CPU throttle on slow 4G.
 *
 * The fix is to move the only thing that varies — which class a ZIP is in — out
 * of the expression and into feature-state, which does NOT trigger a relayout.
 * `match` is O(1) per feature: `Match.parse` compiles the branch labels into a
 * hash at parse time and `evaluate()` is a single lookup.
 */
export function classPaintExpression(): unknown[] {
  return [
    "match",
    ["coalesce", ["feature-state", "k"], -1],
    ...CHOROPLETH_COLORS.flatMap((c, i) => [i, c]),
    NO_DATA_COLOR,
  ];
}

/**
 * Constant too. Reliability drives opacity, so uncertainty needs no second ramp
 * and no second paint property write.
 *
 * Everything is tier 3 until Phase 5 computes a real relative standard error,
 * so today this evaluates to a uniform 0.8.
 */
export function classOpacityExpression(): unknown[] {
  return [
    "case",
    ["<", ["coalesce", ["feature-state", "rel"], 3], 1], 0.38, // tier 0 = low
    0.8,
  ];
}

/**
 * Writes the full ZIP set's class into feature-state, chunked across frames.
 *
 * WHY THE FULL SET AND NOT JUST WHAT IS VISIBLE. Scoping the writes to
 * `querySourceFeatures` was proposed as a "100x reduction", costed against the
 * debunked premise that z3 renders ~1% of ZCTAs. Measured: z3 contains 31,828
 * distinct ZCTAs and `querySourceFeatures` returns 38,077 feature INSTANCES,
 * because ZCTAs are duplicated across tile boundaries — more work than the
 * unscoped write, not less.
 *
 * The correctness argument is stronger. MapLibre re-applies the full accumulated
 * feature-state to every tile that loads AND to every tile revived from the
 * out-of-view cache. Under scoping, a metric change leaves stale state for every
 * ZIP not currently on screen, so panning back silently shows the previous
 * metric's colours with no cue. Writing the full set once per epoch makes that
 * failure mode structurally impossible.
 *
 * Cost: ~5 ms of main-thread work for the full 33,771-ZIP set, zoom-independent.
 */
export class ChoroplethPainter {
  private epochApplied = -1;
  private cursor = 0;
  private frame: number | null = null;
  private src: ClassSource | null = null;
  private writes = 0;
  private skipped = 0;
  /**
   * Last class written per ZIP, so an epoch that leaves a ZIP in the same class
   * costs nothing. This does NOT weaken the full-set guarantee: every ZIP is
   * still visited every epoch, and MapLibre's own feature-state store already
   * holds the value we would have re-written, so a skipped write and a redundant
   * write leave the map in the identical state.
   *
   * The invariant it depends on: nothing else clears feature state. Nothing
   * calls removeFeatureState, and the cache is dropped in dispose() alongside
   * the map. If a future change adds a style reload, clear this too or ZIPs
   * will keep whatever colour survived the reload.
   */
  private lastWritten = new Map<string, number>();

  constructor(private readonly map: maplibregl.Map) {}

  schedule(src: ClassSource): void {
    // Already fully applied, and nothing has changed.
    if (this.src === src && src.epoch === this.epochApplied && this.cursor >= src.zips.length) {
      return;
    }
    this.src = src;
    if (src.epoch !== this.epochApplied) {
      this.epochApplied = src.epoch;
      this.cursor = 0;
      this.writes = 0;
      this.skipped = 0;
      mark("map:applyChoropleth:start");
    }
    if (this.frame === null) this.frame = requestAnimationFrame(() => this.pump());
  }

  dispose(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.src = null;
    this.lastWritten.clear();
  }

  private pump(): void {
    this.frame = null;
    const map = this.map;
    const src = this.src;
    if (!src) return;
    if (!map.getLayer(FILL) || !map.isStyleLoaded() || !map.getSource(SOURCE)) {
      this.frame = requestAnimationFrame(() => this.pump());
      return;
    }

    const zips = src.zips;
    const end = Math.min(this.cursor + CHUNK, zips.length);
    for (let i = this.cursor; i < end; i++) {
      const zip = zips[i];
      const k = src.classOf(zip);
      if (this.lastWritten.get(zip) === k) {
        this.skipped++;
        continue;
      }
      const rel = src.reliabilityOf(zip);
      map.setFeatureState(
        { source: SOURCE, sourceLayer: SOURCE_LAYER, id: zip },
        { k, rel: rel < 0 ? 3 : rel },
      );
      this.lastWritten.set(zip, k);
      this.writes++;
    }
    this.cursor = end;

    // The epoch may have moved on while this batch was queued. Re-entering
    // schedule() rather than continuing lets the newer epoch restart from 0, so
    // an aborted metric change never applies half of the old classing.
    if (this.cursor < zips.length) {
      this.frame = requestAnimationFrame(() => this.pump());
      return;
    }
    measure("map:applyChoropleth", "map:applyChoropleth:start", {
      zoom: map.getZoom(),
      writes: this.writes,
      skipped: this.skipped,
      epoch: this.epochApplied,
    });
  }
}

/**
 * Wraps `setPaintProperty` so the regression is counted rather than argued about.
 *
 * `map:sourceReload` MUST be 0 after setup. Any non-zero value means something
 * wrote a data-driven paint value and paid for a full source reload. Read it in
 * a console with `__domapusPerf.counterValue("map:sourceReload")`.
 */
export function setPaintPropertyCounted(
  map: maplibregl.Map, layer: string, prop: string, value: unknown,
): void {
  count("map:sourceReload");
  map.setPaintProperty(layer, prop, value as never);
}

/** Correct scope for PAINTING: whole loaded tiles. Scoping tighter leaves tile
 *  edges unpainted. Deliberately NOT the same function as the viewport query —
 *  conflating the two is what produced the auto-scale bug. */
export function loadedZips(map: maplibregl.Map): string[] {
  const feats = map.querySourceFeatures(SOURCE, { sourceLayer: SOURCE_LAYER });
  const seen = new Set<string>();
  for (const f of feats) if (f.id !== undefined) seen.add(String(f.id));
  return [...seen];
}

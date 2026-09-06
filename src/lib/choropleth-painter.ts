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

/** Fill opacity for a ZIP whose median rests on too few sales to rank. */
export const LOW_RELIABILITY_OPACITY = 0.38;
export const FULL_OPACITY = 0.8;

/**
 * Constant too. Reliability drives opacity, so uncertainty needs no second ramp
 * and no second paint property write.
 *
 * This is the honesty layer — the one thing separating this from every other
 * choropleth that paints a 2-sale ZIP identically to a 2,000-sale one — and it
 * has no user control. An off switch would be an invitation to turn it off for a
 * screenshot, and it would become another piece of state that has to survive the
 * URL, the export and the archived snapshot, for no gain.
 *
 * THE CARVE-OUT IS NOT IN HERE, AND THAT IS THE POINT. `ACTIVE_LISTINGS` must
 * not be faded — it is a listing-side series that does not depend on sales at all,
 * thousands of ZIPs carry active listings with no sales, and dimming a listings
 * map hardest exactly where there were no sales is a lie the byte layout makes
 * easy. But expressing that as a second expression and swapping between them on a
 * metric change would call `setPaintProperty` on a value MapLibre has seen as
 * data-driven, which marks the source `reload` and re-parses every loaded tile:
 * the exact 3375 ms regression this file exists to prevent.
 *
 * So the carve-out lives in the DATA instead. A fade-exempt metric's class source
 * reports every ZIP as tier 3 (see `class-source.ts`), the painter writes that
 * into feature-state as it already does, and this expression never changes.
 * `MONTHS_OF_SUPPLY` is deliberately not exempt: it is inventory over the sales
 * rate, so it does derive from homes sold and the fade is correct there.
 */
export function classOpacityExpression(): unknown[] {
  return [
    "case",
    ["<", ["coalesce", ["feature-state", "rel"], 3], 1], LOW_RELIABILITY_OPACITY, // tier 0
    FULL_OPACITY,
  ];
}

/**
 * The LISA overlay: where a ZIP's price agrees or disagrees with its neighbours.
 *
 * Categorical, not sequential — the five classes are kinds, not amounts, so a
 * ramp would imply an ordering that does not exist. HH/LL are cluster membership;
 * LH/HL are the ZIP standing apart from its neighbourhood.
 *
 * Constant, like everything else on this layer. Toggling the overlay changes
 * `fill-opacity` between two LITERALS, which is not a data-driven value and so
 * does not mark the source `reload`.
 */
export const LISA_COLORS = [
  "#B2182B", // 1 HH — high surrounded by high
  "#2166AC", // 2 LL — low surrounded by low
  "#92C5DE", // 3 LH — low surrounded by high
  "#F4A582", // 4 HL — high surrounded by low
];

export function lisaPaintExpression(): unknown[] {
  return [
    "match",
    ["coalesce", ["feature-state", "lisa"], 0],
    ...LISA_COLORS.flatMap((c, i) => [i + 1, c]),
    "rgba(0,0,0,0)", // 0 = not distinguishable from spatial randomness
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
   * Last state written per ZIP, so an epoch that changes nothing for a ZIP costs
   * nothing. This does NOT weaken the full-set guarantee: every ZIP is still
   * visited every epoch, and MapLibre's own feature-state store already holds the
   * value we would have re-written, so a skipped write and a redundant write
   * leave the map in the identical state.
   *
   * IT KEYS ON BOTH FIELDS, and that is not defensive coding — keying on the
   * class alone was a real bug. Reliability used to be metric-invariant on the
   * client too, so `k` was the only thing that could differ between epochs. It no
   * longer is: `ACTIVE_LISTINGS` is exempt from the reliability fade, and the
   * exemption is expressed by its class source reporting every ZIP as tier 3. A
   * ZIP whose class happened to be identical under both metrics was therefore
   * skipped, kept the previous metric's tier, and stayed faded on a map that must
   * not fade anything.
   *
   * The invariant it depends on: nothing else clears feature state. Nothing calls
   * removeFeatureState, and the cache is dropped in dispose() alongside the map.
   * If a future change adds a style reload, clear this too or ZIPs will keep
   * whatever colour survived the reload.
   */
  private lastWritten = new Map<string, number>();

  /** `k` and `rel` packed into one number, so the skip test stays a single
   *  Map lookup and one integer compare. `k` is -1..6 and `rel` is 0..3. */
  private static pack(k: number, rel: number): number {
    return (k + 1) * 4 + rel;
  }

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
      const raw = src.reliabilityOf(zip);
      const rel = raw < 0 ? 3 : raw;
      const packed = ChoroplethPainter.pack(k, rel);
      if (this.lastWritten.get(zip) === packed) {
        this.skipped++;
        continue;
      }
      map.setFeatureState({ source: SOURCE, sourceLayer: SOURCE_LAYER, id: zip }, { k, rel });
      this.lastWritten.set(zip, packed);
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
 *  conflating the two is what produced the auto-scale bug.
 *
 *  Returns empty when the source is not there yet, and that guard is load-bearing
 *  rather than defensive. This is called from the map's own `load` handler, which
 *  fires when the STYLE is ready — the `zips` source is added later, once the
 *  PMTiles header has been read. `querySourceFeatures` on a missing source
 *  throws, and a throw inside that handler aborts the rest of it, so the map
 *  never reports itself ready and the layers are never added. The symptom is a
 *  blank map with no error, which is why this is written down. */
export function loadedZips(map: maplibregl.Map): string[] {
  if (!map.getSource(SOURCE)) return [];
  const feats = map.querySourceFeatures(SOURCE, { sourceLayer: SOURCE_LAYER });
  const seen = new Set<string>();
  for (const f of feats) if (f.id !== undefined) seen.add(String(f.id));
  return [...seen];
}

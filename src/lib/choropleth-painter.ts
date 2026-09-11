import type * as maplibregl from "maplibre-gl";
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
 * Every ZIP is painted at full opacity. Reliability is NOT an opacity channel.
 *
 * It used to be: tier 0 at 0.38, everything else at 0.8. That is a lightness
 * channel layered on a ramp whose meaning IS lightness, so the two are the same
 * perceptual channel used twice, and the reader cannot separate them.
 *
 * MEASURED, compositing each ramp colour over Positron's `#FAFAF8` background and
 * converting to CIELAB. This ramp averages 14.0 L* per class step, so the error
 * an alpha introduces can be stated in class-step units — how many classes lighter
 * the fill LOOKS than it is. Worst case is always the darkest class, which is
 * where the map carries its signal:
 *
 *   a=0.38  3.90 steps   a=0.75  1.59      a=0.92  0.49
 *   a=0.62  2.43         a=0.85  0.94      a=0.95  0.30
 *
 * At the shipped 0.38 an expensive rural ZIP rendered as a colour the eye reads as
 * nearly four classes cheaper. Holding the artefact under half a step needs every
 * alpha at 0.92 or above, which leaves 0.92..1.00 of usable range — too little to
 * read as a deliberate signal and exactly enough to be misread as a value. There
 * is no alpha band that is both visible as uncertainty and not confusable with
 * value, so the channel had to go rather than be retuned.
 *
 * The bias was systematic, not random. Reliability tracks sales volume, which
 * tracks urban density, so the fade lightened rural ZIPs specifically — and the
 * pipeline already measures those ZIPs as genuinely cheaper (median $275,953
 * against $394,885, `classing.median_sale_price.selection_effect`). Both errors
 * pointed the same way. Tier 0 is 72% of ZIPs and 78.5% of the drawn land area, so
 * this was most of the map.
 *
 * The honesty layer is not abandoned, it is relocated. Reliability is reported as
 * a number where a number can be read — the hover popup (`+/-4.6%, 312 sales`),
 * the detail panel, and the legend — and a texture overlay gated to zoom >= 6 is
 * the intended fill-side channel, deferred rather than cancelled. Texture is
 * orthogonal to lightness, which is the property that made opacity unusable.
 *
 * Kept as a constant expression set once at `addLayer`. `FADE_EXEMPT` and the
 * tier-3 reporting in `class-source.ts` are now inert with respect to opacity, and
 * are retained because the texture layer will read the same `rel` feature-state.
 */
export const FULL_OPACITY = 1;

export function classOpacityExpression(): number {
  return FULL_OPACITY;
}

/**
 * Price outliers: the ZIPs whose price disagrees with the ZIPs around them.
 *
 * THIS USED TO PAINT ALL FOUR LISA CLASSES AS A FULL-COVERAGE FILL, and that was
 * the wrong reading of its own result. Local Moran's I sorts ZIPs into five
 * classes: not-significant, HH (costly among costly), LL (cheap among cheap), and
 * the two outlier classes LH and HL. Measured on this release:
 *
 *   class   ZIPs   median size   share of drawn area
 *   ns      6,857    135 km2     80.11%
 *   LL      1,203    153 km2     13.10%
 *   HH      1,349     40 km2      5.93%
 *   LH         20     48 km2      0.60%
 *   HL         27     78 km2      0.26%
 *
 * Two things follow. Global Moran's I at 8 neighbours is 0.7343 — price is
 * strongly clustered almost everywhere — so HH and LL, which are 2,552 of the
 * 2,599 significant ZIPs, restate what the choropleth underneath already shows.
 * And HH polygons are about a quarter the size of LL ones, so an overlay painting
 * both put down twice as much blue as red and read as "everything is cheap".
 * The reported symptom was exactly that: only blue clusters visible.
 *
 * The informative classes are LH and HL — a ZIP that breaks its neighbourhood's
 * pattern is something a price map cannot show you. There are 47 of them, 0.86%
 * of the area, and under the old design they were two of four colours nobody had
 * a key for. So the overlay is now those 47 only, drawn as markers rather than
 * fills, with the choropleth left intact underneath.
 *
 * Markers, not fill, for a second reason: 47 polygons scattered across the
 * country are invisible at national zoom, which is where you would look for them.
 * A fixed-radius circle is legible at every zoom.
 */
export const OUTLIER_COLORS = {
  /** LISA class 3 — low value ringed by high. */
  LH: "#2166AC",
  /** LISA class 4 — high value ringed by low. */
  HL: "#B2182B",
} as const;

/** LISA class code -> which outlier kind, or null for the classes not shown. */
export const OUTLIER_CLASS: Record<number, keyof typeof OUTLIER_COLORS> = {
  3: "LH",
  4: "HL",
};

export function outlierColorExpression(): unknown[] {
  return [
    "match",
    ["get", "cls"],
    3, OUTLIER_COLORS.LH,
    4, OUTLIER_COLORS.HL,
    "rgba(0,0,0,0)",
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
  map.setPaintProperty(layer, prop as never, value as never);
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

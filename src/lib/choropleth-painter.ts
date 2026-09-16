import type * as maplibregl from "maplibre-gl";
import { CHOROPLETH_COLORS, NO_DATA_COLOR } from "./choropleth";
import type { ClassSource } from "./class-source";
import { count, mark, measure } from "./perf";

const SOURCE = "zips";
const SOURCE_LAYER = "us_zip_codes";
const FILL = "zips-fill";
// Feature-state writes per frame. `setFeatureState` measures 0.14 us/call, so the full set
// is ~5 ms; yielding every 8,000 used to cost a full map render per chunk (579 ms -> 8 ms).
export const CHUNK = 50_000;

/**
 * Set once at layer creation, never rewritten. Any `setPaintProperty` of a data-driven value
 * reloads every loaded tile (3375 ms per metric switch, measured). The class lives in
 * feature-state instead, which does not relayout.
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
 * Full opacity always. Fading low-reliability ZIPs moved lightness on a ramp whose meaning
 * is lightness (up to 3.9 class steps of error on the darkest class), and it fell on rural
 * ZIPs. Reliability is shown as a number in the popup and panel instead.
 */
export const FULL_OPACITY = 1;

export function classOpacityExpression(): number {
  return FULL_OPACITY;
}

/**
 * LISA outlier markers. Only LH and HL are drawn (47 ZIPs, 2026-09): HH and LL restate the
 * choropleth, and as fills their size difference read as "everything is cheap". Circles,
 * because 47 small polygons are invisible at national zoom.
 */
export const OUTLIER_COLORS = {
  /** LISA class 3 — low value ringed by high. */
  LH: "#2166AC",
  /** LISA class 4 — high value ringed by low. */
  HL: "#B2182B",
} as const;

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
 * Writes every ZIP's class into feature-state once per epoch.
 *
 * The full set, not the visible one: MapLibre re-applies accumulated state to tiles as they
 * load, so scoping would leave the previous metric's colours on anything off screen. It is
 * also not more work (z3 has 31,828 ZCTAs but 38,077 feature instances).
 */
export class ChoroplethPainter {
  private epochApplied = -1;
  private cursor = 0;
  private frame: number | null = null;
  private src: ClassSource | null = null;
  private writes = 0;
  private skipped = 0;
  /**
   * Last (k, rel) written per ZIP, so an unchanged ZIP costs nothing. Keyed on both fields:
   * keying on k alone left the fade on when switching to a fade-exempt metric. Assumes
   * nothing else clears feature state; clear this on any future style reload.
   */
  private lastWritten = new Map<string, number>();

  /** `k` is -1..13, `rel` 0..3. */
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
 * Counts every `setPaintProperty` on a ZIP layer as `map:sourceReload`, which the
 * bench asserts stays 0. Any paint rewrite there reloads every loaded tile.
 */
export function countZipPaintRewrites(map: maplibregl.Map): void {
  const original = map.setPaintProperty.bind(map);
  map.setPaintProperty = ((layer: string, ...rest: unknown[]) => {
    if (layer.startsWith("zips-")) count("map:sourceReload");
    return (original as (...a: unknown[]) => maplibregl.Map)(layer, ...rest);
  }) as typeof map.setPaintProperty;
}

/** ZIPs on loaded tiles: the scope for painting (tighter leaves tile edges unpainted), not
 *  for auto-scale sampling. Returns empty until the `zips` source exists: this runs from the
 *  map's `load` handler, and a throw there leaves the map blank with no error. */
export function loadedZips(map: maplibregl.Map): string[] {
  if (!map.getSource(SOURCE)) return [];
  const feats = map.querySourceFeatures(SOURCE, { sourceLayer: SOURCE_LAYER });
  const seen = new Set<string>();
  for (const f of feats) if (f.id !== undefined) seen.add(String(f.id));
  return [...seen];
}

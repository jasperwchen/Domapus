import { useEffect, useRef, useMemo, forwardRef, useImperativeHandle, useState, useCallback } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "@/lib/maplibre-worker";
import { ZipData } from "../map/types";
import { addPMTilesProtocol } from "@/lib/pmtiles-protocol";
import { trackError } from "@/lib/analytics";
import { getMetricLabel } from "@/lib/metrics";
import bbox from "@turf/bbox";
import { featureCollection, point } from "@turf/helpers";
import { dataUrl } from "@/lib/data-url";
import { CHOROPLETH_COLORS, NO_DATA_COLOR } from "@/lib/choropleth";
import { classify } from "@/lib/class-source";
import { classPaintExpression, FULL_OPACITY } from "@/lib/choropleth-painter";
import { tickAt } from "@/lib/legend-format";
import { fetchDataDates, formatPeriod, formatPeriodDay } from "@/lib/data-dates";

// ---------------------------------------------------------------------------
// ONE LAYOUT, TWO RENDERERS.
//
// Every number in `L` is in STAGE UNITS — the coordinate space of the 1200x900
// preview. The exported canvas is that same layout at EXPORT_SCALE, so the
// preview and the PNG are the same picture by construction rather than by two
// sets of numbers somebody has to keep in step.
//
// They were two sets, and they had drifted. The Alaska and Hawaii insets were
// drawn at 400 px in both places, which is 35% of the width of a 1200-px preview
// and 11% of the width of a 3600-px canvas: on screen they dominated the map, in
// the downloaded file they were unreadable thumbnails.
//
// Text follows the same rule. Every run is placed as a BOX, and both renderers
// centre the glyphs in it — canvas with `textBaseline = "middle"`, the DOM with
// `lineHeight` equal to the box height — so neither has to reason about
// ascenders to agree with the other.
//
// The maps keep the guarantee too: each MapLibre canvas renders at a backing
// size of exactly `stage units x EXPORT_SCALE`, so `drawImage` onto the export
// canvas is 1:1. No resampling, and no aspect change between preview and file.
// ---------------------------------------------------------------------------
const STAGE_W = 1200;
const STAGE_H = 900;
const EXPORT_SCALE = 3;

export const EXPORT_CANVAS_W = STAGE_W * EXPORT_SCALE;
export const EXPORT_CANVAS_H = STAGE_H * EXPORT_SCALE;

/** Both renderers use this stack so glyph widths agree. A canvas `ctx.font`
 *  falls back silently on a family it cannot parse, and a silent fallback here
 *  means the preview and the file disagree about where a right-aligned run
 *  ends. */
const FONT_STACK = '"Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const font = (size: number, weight = "400") => `${weight} ${size}px ${FONT_STACK}`;

const INK = "#0F172A";
const MUTED = "#64748B";
const HAIRLINE = "#D8DEE7";
const PANEL = "#FFFFFF";
const MAP_BACKDROP = "#F8FAFC";
const LINK = "#0C82A5";

const L = {
  pad: 32,
  /** Height of the title block, measured from the top pad to the map frame. */
  headerH: 76,
  title: { top: 32, h: 32, size: 27 },
  sub: { top: 66, h: 20, size: 15 },
  /**
   * The strip below the map frame. Everything that is not the map lives here:
   * the key on the left, the attribution on the right.
   *
   * The key used to float inside the map, bottom right, on a white panel. On the
   * national view that is the Atlantic east of Florida — except the panel was
   * 324 x 94 and reached inland: measured against the shipped snapshot it was
   * drawn on top of 148 to 164 Florida ZCTAs, depending on the metric. At state
   * and metro scope there is no ocean at all and it simply covered whatever was
   * under it. A band costs 42 units of map height and cannot cover anything.
   */
  band: { gap: 12, foot: { h: 20, size: 12 } },
  inset: { w: 216, h: 168, labelH: 20, labelSize: 10, gap: 10, margin: 14 },
  legend: {
    barW: 300, barH: 12, nameGap: 12, endGap: 20,
    labelGap: 5, labelH: 13, titleSize: 11, labelSize: 10, swatch: 11,
  },
} as const;

/** Height of the key: the colour bar with its boundary labels underneath. */
const LEGEND_H = L.legend.barH + L.legend.labelGap + L.legend.labelH;

/** Vertical space the inset column occupies inside the map frame. */
const INSET_BLOCK_H = L.inset.labelH + L.inset.h + L.inset.margin;

/** Layout rectangles for one configuration, in stage units. */
function layout(includeTitle: boolean, includeLegend: boolean) {
  const rowH = includeLegend ? LEGEND_H : L.band.foot.h;
  const mapLeft = L.pad;
  const mapRight = STAGE_W - L.pad;
  const mapTop = L.pad + (includeTitle ? L.headerH : 0);
  const mapBottom = STAGE_H - L.pad - (L.band.gap + rowH);
  const bandTop = mapBottom + L.band.gap;
  return {
    mapLeft, mapTop, mapRight, mapBottom,
    mapW: mapRight - mapLeft,
    mapH: mapBottom - mapTop,
    bandTop, rowH,
    footTop: bandTop + (rowH - L.band.foot.h) / 2,
  };
}

/** Text width in stage units, measured once and used by BOTH renderers, so the
 *  colour bar starts at the same x in the preview and in the file instead of at
 *  two independent measurements of the same string. */
let measureEl: HTMLCanvasElement | null = null;
function textWidth(s: string, size: number, weight = "400"): number {
  if (!measureEl) measureEl = document.createElement("canvas");
  const ctx = measureEl.getContext("2d");
  if (!ctx) return s.length * size * 0.55;
  ctx.font = font(size, weight);
  return ctx.measureText(s).width;
}

/** x positions along the key, from the metric name's measured width. */
function legendGeom(metricLabel: string) {
  const g = L.legend;
  const nameW = textWidth(metricLabel, g.titleSize, "600");
  const barX = L.pad + nameW + g.nameGap;
  const swatchX = barX + g.barW + g.endGap;
  return { nameW, barX, swatchX, ndTextX: swatchX + g.swatch + 6 };
}

/**
 * The attribution, as segments, so the PDF can put a link box around each brand
 * name and both renderers can colour them the same.
 *
 * The sidebar used to re-measure this text with a throwaway canvas of its own to
 * guess where one link rectangle went. `exportToCanvas` now returns the boxes it
 * actually drew.
 */
type FooterSegment = { text: string; url?: string };

const BRAND_SEGMENTS: FooterSegment[] = [
  { text: "Built by " },
  { text: "Domapus", url: "https://jasperwchen.github.io/Domapus/" },
  { text: "   ·   Data: " },
  { text: "Redfin", url: "https://www.redfin.com/news/data-center/" },
  { text: " & " },
  { text: "Zillow", url: "https://www.zillow.com/research/data/" },
];

/**
 * The attribution row, with the data period folded in when nothing else on the
 * page carries it.
 *
 * An untitled export used to leave the page with no date at all: the period is
 * drawn in the subtitle, and the subtitle belongs to the title block. The
 * filename says which metric and which region, so a file on disk was always
 * identifiable — but a PNG pasted into a deck is not a file any more, and it had
 * nothing on it saying which month it described.
 *
 * Only when the title is OFF. With the title on, the subtitle already says it,
 * and printing the date twice is worse than printing it once. The row is
 * right-aligned from `mapRight` and grows leftward; at 1200 stage units the key
 * ends around x=650 even for the longest metric name, so the extra ~150 units
 * cannot reach it.
 */
function footerSegments(dataDate: string, includeTitle: boolean): FooterSegment[] {
  if (includeTitle || !dataDate) return BRAND_SEGMENTS;
  return [{ text: `${dataDate}   ·   ` }, ...BRAND_SEGMENTS];
}

const BOUNDS_BUFFER = 0.15;

// The offscreen insets render into a container EXPORT_SCALE times the box they
// are shown in, at pixelRatio 1, so the backing store lands on the export canvas
// at 1:1 — and, more importantly, so `fitBounds` has room to work.
//
// `fitBounds` picks a zoom from the container's CSS size and then clamps it to
// `minZoom`, which must be at least the tileset's own minimum or the choropleth
// layer has no tiles and renders nothing. Alaska spans 0.109 of the world's
// Mercator height; fitting that inside 504 px asks for zoom 3.14, which clears
// the floor. Inside the 168 px the inset is DISPLAYED at, the same fit asks for
// 1.4, gets clamped to 3, and Alaska is cropped to whatever third of the state
// the viewport happens to land on.
const INSET_RENDER_W = L.inset.w * EXPORT_SCALE;
const INSET_RENDER_H = L.inset.h * EXPORT_SCALE;
const ALASKA_DEFAULT_BOUNDS: [[number, number], [number, number]] = [[-168.0, 54.5], [-130.0, 70.0]];
const HAWAII_DEFAULT_BOUNDS: [[number, number], [number, number]] = [[-160.5, 18.9], [-154.8, 22.3]];
const PMTILES_MIN_ZOOM = 3;
const MAP_READY_TIMEOUT_MS = 10_000;
const MAIN_PAD = 24;

type Bounds = [[number, number], [number, number]];

/** Normalised Web Mercator, 0..1, the projection `fitBounds` fits in. */
const mercX = (lng: number) => (lng + 180) / 360;
const mercY = (lat: number) =>
  (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360;

/**
 * Padding for the main map's fit, with the bottom grown to keep the data off
 * the insets.
 *
 * The insets sit in the map's lower left, which on a map of the lower 48 is the
 * Pacific and northern Mexico. They used to be placed at a fixed margin from the
 * frame with no idea where the data was, and measured against the shipped
 * snapshot the Hawaii box was drawn on top of 3 to 8 Texas ZCTAs around Big
 * Bend, depending on the metric.
 *
 * The lower 48 are wider than the frame they are drawn in, so the fit is
 * width-bound and the leftover height is empty. Spending that leftover as bottom
 * padding pushes the states up off the insets and costs nothing: the width still
 * binds, so the map is drawn at exactly the same size. Measured after: 0 ZCTAs
 * covered, on all eight painted metrics.
 */
function mainPadding(bounds: Bounds, w: number, h: number, reserveBottom: number) {
  if (reserveBottom <= 0) return MAIN_PAD;
  const dx = mercX(bounds[1][0]) - mercX(bounds[0][0]);
  const dy = mercY(bounds[0][1]) - mercY(bounds[1][1]);
  if (!(dx > 0) || !(dy > 0)) return MAIN_PAD;
  const slack = (h - MAIN_PAD * 2) - ((w - MAIN_PAD * 2) * dy) / dx;
  if (slack <= 0) return MAIN_PAD;
  return {
    top: MAIN_PAD, right: MAIN_PAD, left: MAIN_PAD,
    bottom: MAIN_PAD + Math.min(slack, reserveBottom),
  };
}

/**
 * How large the inset draws its state compared with the main map, as a
 * multiplier. Alaska lands near 0.2x and Hawaii near 2x, which is the thing a
 * reader cannot otherwise work out: the two boxes are the same size on the page
 * but one holds a state ten times wider than the other.
 *
 * The inset renders into a container EXPORT_SCALE times its displayed box, so
 * its reported zoom is that much higher than what the page shows.
 */
function scaleSuffix(ratio: number | undefined): string {
  if (!ratio || !Number.isFinite(ratio) || ratio <= 0) return "";
  const s = ratio >= 10 ? ratio.toFixed(0) : ratio >= 1 ? ratio.toFixed(1) : ratio.toFixed(2);
  return ` · ${s}× scale`;
}

export interface PrintStageProps {
  filteredData: ZipData[];
  selectedMetric: string;
  /** The boundaries the live map is painting, straight from the manifest. The
   *  export does not derive its own — see `classesByZip`. */
  breaks: readonly number[] | null;
  regionScope: "national" | "state" | "metro";
  regionName: string;
  includeLegend: boolean;
  includeTitle: boolean;
  showCities?: boolean;
  onReady?: () => void;
}

/** A clickable region of the exported canvas, in canvas pixels. */
export interface ExportLink {
  x: number; y: number; w: number; h: number; url: string;
}

export interface ExportRender {
  canvas: HTMLCanvasElement;
  links: ExportLink[];
  /** The ISO period the export describes, for the filename. Comes from the same
   *  place the subtitle's date does, so the name and the picture cannot disagree.
   *  Null only when no row carried a period. */
  period: string | null;
}

export interface PrintStageRef {
  getElement: () => HTMLDivElement | null;
  exportToCanvas: () => Promise<ExportRender>;
}

/** The metric's value for one ZIP, or null. Distinguishes a real zero — a ZIP
 *  where nothing sold above list — from a ZIP that reports nothing at all;
 *  `getMetricValue` maps both to 0 and cannot. */
function rawValue(zip: ZipData, metric: string): number | null {
  const v = zip[metric as keyof ZipData];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Wait for a map to settle, then capture its GL canvas as an image. */
function captureMapCanvas(map: maplibregl.Map): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const CAPTURE_TIMEOUT_MS = 10_000;
    let settled = false;

    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("Map capture timed out"));
      }
    }, CAPTURE_TIMEOUT_MS);

    const doCapture = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      map.once("render", () => resolve(map.getCanvas()));
      map.triggerRepaint();
    };

    // `loaded()` goes false again after a layout change, which is what makes a
    // capture taken right after the city-label toggle safe: this waits for the
    // symbol layers to be placed instead of grabbing the frame before them.
    if (map.loaded() && map.isStyleLoaded()) {
      doCapture();
    } else {
      map.once("idle", doCapture);
    }
  });
}

export const PrintStage = forwardRef<PrintStageRef, PrintStageProps>(({
  filteredData, selectedMetric, breaks, regionScope, regionName,
  includeLegend, includeTitle, showCities = false, onReady,
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mainMapRef = useRef<HTMLDivElement>(null);
  const alaskaMapRef = useRef<HTMLDivElement>(null);
  const hawaiiMapRef = useRef<HTMLDivElement>(null);
  const mapsRef = useRef<{ main: maplibregl.Map | null; alaska: maplibregl.Map | null; hawaii: maplibregl.Map | null }>({
    main: null, alaska: null, hawaii: null,
  });
  /** City-label layer ids per map, so the toggle is a visibility change rather
   *  than a teardown and rebuild of three maps. */
  const cityLayersRef = useRef<Record<string, string[]>>({});
  /** What the main map was fitted to, so a layout change can re-fit it instead
   *  of leaving the old zoom in a frame that is no longer that shape. */
  const mainFitRef = useRef<{ bounds: Bounds; reserveBottom: number } | null>(null);
  const [mapsLoaded, setMapsLoaded] = useState(false);
  const [scale, setScale] = useState(1);
  const [zhviPeriod, setZhviPeriod] = useState<string | null>(null);
  const [insetScales, setInsetScales] = useState<{ alaska?: number; hawaii?: number }>({});

  // City labels are offered below the national view only. At national extent
  // Positron's place labels stack into noise over the choropleth, so the control
  // is disabled there rather than left to produce a bad export.
  const citiesAllowed = regionScope !== "national";
  const cityLabelsOn = showCities && citiesAllowed;

  const geom = layout(includeTitle, includeLegend);
  const scaleOk = !!breaks && breaks.length === CHOROPLETH_COLORS.length - 1;
  const metricLabel = getMetricLabel(selectedMetric);
  const alaskaLabel = `ALASKA${scaleSuffix(insetScales.alaska)}`;
  const hawaiiLabel = `HAWAII${scaleSuffix(insetScales.hawaii)}`;

  // ZHVI is a Zillow series with its own publication month, and it is not stored
  // per ZIP, so it comes from last_updated.json. Everything else is Redfin and
  // carries period_end on each record.
  useEffect(() => {
    let isMounted = true;
    fetchDataDates()
      .then(d => { if (isMounted) setZhviPeriod(d.zhvi_period_end ?? d.period_end); })
      .catch(() => { /* date is omitted rather than guessed */ });
    return () => { isMounted = false; };
  }, []);

  const onReadyRef = useRef(onReady);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);

  useEffect(() => {
    const handleResize = () => {
      const parent = containerRef.current?.parentElement;
      if (!parent) return;
      setScale(Math.min(parent.clientWidth / STAGE_W, parent.clientHeight / STAGE_H));
    };
    handleResize();
    const observer = new ResizeObserver(handleResize);
    if (containerRef.current?.parentElement) observer.observe(containerRef.current.parentElement);
    return () => observer.disconnect();
  }, []);

  /**
   * The period this export describes, written as "Data through <date>".
   *
   * DO NOT CHANGE THIS BACK TO `formatRedfinWindow`. That helper is correct and
   * stays correct everywhere else: Redfin's ZIP rows are a rolling three-month
   * window, so "3 months ending Jul 31, 2026" is the honest description of the
   * statistic. On a printed map it reads as a puzzle — the reader has to work out
   * whether the number is July's or the quarter's before they can look at the
   * colours. The window caveat belongs on the methodology page, which the footer
   * links to the site for; a chart subtitle says how current the data is.
   *
   * This was once `today minus one month`, which named a month the numbers did
   * not come from. That is the regression to guard against — the date still comes
   * from the data, never from the clock.
   */
  const dataPeriod = useMemo(() => {
    if (selectedMetric.startsWith("zhvi")) return zhviPeriod;
    let newest: string | null = null;
    for (const zip of filteredData) {
      const pe = zip.period_end;
      if (pe && (newest === null || pe > newest)) newest = pe;
    }
    return newest;
  }, [filteredData, selectedMetric, zhviPeriod]);

  const dataDate = useMemo(() => {
    if (!dataPeriod) return "";
    return selectedMetric.startsWith("zhvi")
      ? `Data through ${formatPeriod(dataPeriod)}`
      : `Data through ${formatPeriodDay(dataPeriod)}`;
  }, [dataPeriod, selectedMetric]);

  /**
   * The class of every ZIP being drawn, from the boundaries the pipeline
   * published and the live map is already painting.
   *
   * IT DOES NOT CUT ITS OWN. It used to: `computeQuantileBuckets` over whatever
   * ZIPs the region contained, 14 plain quantiles, for every metric. The pipeline
   * classes prices log-equal between their p1 and p99 anchors, on the rankable
   * set only, so on the national extent — the same ZIPs, the same release — 73%
   * of them came out a different colour in the file than on the screen they were
   * exported from, and more than half of those by two classes or more. Measured
   * per metric: zhvi 73.0%, median_sale_price 82.6%, median_ppsf 89.7%,
   * sold_above_list 82.9%, months_of_supply 75.5%, median_dom 64.4%. Only the two
   * exact counts agreed, because plain quantiles is what the pipeline uses for
   * them. This was the last second class authority in the app.
   */
  const classesByZip = useMemo(() => {
    const out = new Map<string, number>();
    if (!scaleOk) return out;
    for (const zip of filteredData) {
      const v = rawValue(zip, selectedMetric);
      if (v !== null) out.set(zip.zipCode, classify(v, breaks!));
    }
    return out;
  }, [filteredData, selectedMetric, breaks, scaleOk]);

  /**
   * Framing samples only the ZIPs that HAVE a value for this metric.
   *
   * Sampling every ZIP in the region let ZIPs that can never show a colour set
   * the frame. Puerto Rico's 131 ZCTAs and the Virgin Islands' 6 report nothing
   * for any metric, and they dragged the mainland frame from 24.59 deg N down to
   * 17.73 — a fifth of the height of a map of the lower 48 spent on empty ocean.
   * The same rule tightens Alaska from the 46.6 degrees of longitude its ZCTAs
   * span, most of it empty Aleutian chain, to the 35.1 that have data.
   */
  const { alaskaZips, hawaiiZips, mainlandZips, alaskaBounds, hawaiiBounds, mainlandBounds } = useMemo(() => {
    const ak = new Set<string>(), hi = new Set<string>(), ml = new Set<string>();
    const akPts: ReturnType<typeof point>[] = [], hiPts: ReturnType<typeof point>[] = [], mlPts: ReturnType<typeof point>[] = [];

    filteredData.forEach(zip => {
      const st = (zip.state ?? '').toUpperCase();
      const lat = zip.latitude;
      const lng = zip.longitude;
      const placeable = rawValue(zip, selectedMetric) !== null
        && lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng);

      if (st === 'AK') {
        ak.add(zip.zipCode);
        // The eastern-hemisphere Aleutians cross the antimeridian, which is a
        // projection problem rather than a framing one; excluded from the fit.
        if (placeable && lng! < 0) akPts.push(point([lng!, lat!]));
      } else if (st === 'HI') {
        hi.add(zip.zipCode);
        if (placeable) hiPts.push(point([lng!, lat!]));
      } else {
        ml.add(zip.zipCode);
        if (placeable) mlPts.push(point([lng!, lat!]));
      }
    });

    const getSmartBbox = (pts: ReturnType<typeof point>[]): Bounds | null => {
      if (pts.length === 0) return null;
      const b = bbox(featureCollection(pts));
      return [
        [b[0] - BOUNDS_BUFFER, b[1] - BOUNDS_BUFFER],
        [b[2] + BOUNDS_BUFFER, b[3] + BOUNDS_BUFFER],
      ];
    };

    // An inset is drawn only where there is something to show in it. A state
    // whose ZCTAs all report nothing for this metric gets no empty box.
    const akBounds = akPts.length > 0 ? (getSmartBbox(akPts) ?? ALASKA_DEFAULT_BOUNDS) : null;
    const hiBounds = hiPts.length > 0 ? (getSmartBbox(hiPts) ?? HAWAII_DEFAULT_BOUNDS) : null;

    return {
      alaskaZips: akBounds ? ak : new Set<string>(),
      hawaiiZips: hiBounds ? hi : new Set<string>(),
      mainlandZips: ml,
      alaskaBounds: akBounds,
      hawaiiBounds: hiBounds,
      mainlandBounds: getSmartBbox(mlPts),
    };
  }, [filteredData, selectedMetric]);

  const legendTicks = useMemo(
    () => (scaleOk ? tickAt(breaks!, 5, selectedMetric) : null),
    [scaleOk, breaks, selectedMetric],
  );

  const classesRef = useRef(classesByZip);
  classesRef.current = classesByZip;
  const filteredDataRef = useRef(filteredData);
  filteredDataRef.current = filteredData;
  const legendTicksRef = useRef(legendTicks);
  legendTicksRef.current = legendTicks;
  const includeLegendRef = useRef(includeLegend);
  includeLegendRef.current = includeLegend;
  const includeTitleRef = useRef(includeTitle);
  includeTitleRef.current = includeTitle;
  const regionNameRef = useRef(regionName);
  regionNameRef.current = regionName;
  const regionScopeRef = useRef(regionScope);
  regionScopeRef.current = regionScope;
  const dataDateRef = useRef(dataDate);
  dataDateRef.current = dataDate;
  const dataPeriodRef = useRef(dataPeriod);
  dataPeriodRef.current = dataPeriod;
  const cityLabelsOnRef = useRef(cityLabelsOn);
  cityLabelsOnRef.current = cityLabelsOn;
  const metricLabelRef = useRef(metricLabel);
  metricLabelRef.current = metricLabel;
  const insetLabelsRef = useRef({ alaska: alaskaLabel, hawaii: hawaiiLabel });
  insetLabelsRef.current = { alaska: alaskaLabel, hawaii: hawaiiLabel };

  const exportToCanvas = useCallback(async (): Promise<ExportRender> => {
    const S = EXPORT_SCALE;
    const out = document.createElement("canvas");
    out.width = EXPORT_CANVAS_W;
    out.height = EXPORT_CANVAS_H;
    const ctx = out.getContext("2d");
    if (!ctx) throw new Error("Could not get 2D context");
    const links: ExportLink[] = [];

    /** Stage units to canvas pixels. Every draw below goes through it. */
    const p = (n: number) => n * S;
    /** One text run, centred in its box exactly as the DOM centres it in a line
     *  box of the same height. */
    const text = (s: string, x: number, top: number, h: number) =>
      ctx.fillText(s, p(x), p(top + h / 2));
    const hair = () => { ctx.strokeStyle = HAIRLINE; ctx.lineWidth = Math.max(1, S * 0.5); };

    ctx.fillStyle = PANEL;
    ctx.fillRect(0, 0, EXPORT_CANVAS_W, EXPORT_CANVAS_H);
    ctx.textBaseline = "middle";

    const captureRequired = async (map: maplibregl.Map | null, mapName: string) => {
      if (!map) throw new Error(`Could not capture ${mapName} map: map is not initialized`);
      return await captureMapCanvas(map);
    };
    const captureOptional = async (map: maplibregl.Map | null) => {
      if (!map) return null;
      try { return await captureMapCanvas(map); }
      catch { return null; }
    };

    const [mainGl, alaskaGl, hawaiiGl] = await Promise.all([
      captureRequired(mapsRef.current.main, "main"),
      captureOptional(mapsRef.current.alaska),
      captureOptional(mapsRef.current.hawaii),
    ]);

    const g = layout(includeTitleRef.current, includeLegendRef.current);
    const label = metricLabelRef.current;

    if (includeTitleRef.current) {
      ctx.textAlign = "left";
      ctx.fillStyle = INK;
      ctx.font = font(p(L.title.size), "700");
      text(`${label} by ZIP Code`, L.pad, L.title.top, L.title.h);

      ctx.fillStyle = MUTED;
      ctx.font = font(p(L.sub.size));
      text(
        dataDateRef.current ? `${regionNameRef.current}   ·   ${dataDateRef.current}` : regionNameRef.current,
        L.pad, L.sub.top, L.sub.h,
      );
    }

    // The map, inside a hairline frame so it reads as a figure rather than as
    // ink that ran to the edge of the paper.
    ctx.fillStyle = MAP_BACKDROP;
    ctx.fillRect(p(g.mapLeft), p(g.mapTop), p(g.mapW), p(g.mapH));
    if (mainGl) ctx.drawImage(mainGl, p(g.mapLeft), p(g.mapTop), p(g.mapW), p(g.mapH));
    hair();
    ctx.strokeRect(p(g.mapLeft), p(g.mapTop), p(g.mapW), p(g.mapH));

    if (regionScopeRef.current === "national") {
      const { w, h, labelH, gap, margin } = L.inset;
      const insetY = g.mapBottom - margin - labelH - h;
      let insetX = g.mapLeft + margin;

      const drawInset = (glCanvas: HTMLCanvasElement | null, insetLabel: string) => {
        if (!glCanvas) return;
        ctx.fillStyle = PANEL;
        ctx.fillRect(p(insetX), p(insetY), p(w), p(labelH + h));
        ctx.drawImage(glCanvas, p(insetX), p(insetY + labelH), p(w), p(h));
        hair();
        ctx.strokeRect(p(insetX), p(insetY), p(w), p(labelH + h));
        ctx.beginPath();
        ctx.moveTo(p(insetX), p(insetY + labelH));
        ctx.lineTo(p(insetX + w), p(insetY + labelH));
        ctx.stroke();
        ctx.fillStyle = MUTED;
        ctx.font = font(p(L.inset.labelSize), "600");
        ctx.textAlign = "left";
        text(insetLabel, insetX + 7, insetY, labelH);
        insetX += w + gap;
      };

      if (alaskaZips.size > 0) drawInset(alaskaGl, insetLabelsRef.current.alaska);
      if (hawaiiZips.size > 0) drawInset(hawaiiGl, insetLabelsRef.current.hawaii);
    }

    // The key, in the band below the map. Left-aligned run: name, colour bar with
    // its boundary labels underneath, then the no-data swatch.
    const ticks = legendTicksRef.current;
    if (includeLegendRef.current && ticks) {
      const lg = L.legend;
      const lx = legendGeom(label);

      ctx.textAlign = "left";
      ctx.fillStyle = INK;
      ctx.font = font(p(lg.titleSize), "600");
      text(label, L.pad, g.bandTop, g.rowH);

      // One rectangle per class, not a gradient. The map paints CLASSES discrete
      // colours; interpolating between them would put colours in the key that no
      // ZIP on the map can be.
      const swatchW = lg.barW / CHOROPLETH_COLORS.length;
      CHOROPLETH_COLORS.forEach((color, i) => {
        ctx.fillStyle = color;
        // One extra device pixel of overlap, so the seams do not show as
        // hairlines after the scale-up.
        ctx.fillRect(p(lx.barX + i * swatchW), p(g.bandTop), p(swatchW) + 1, p(lg.barH));
      });
      hair();
      ctx.strokeRect(p(lx.barX), p(g.bandTop), p(lg.barW), p(lg.barH));

      // Labels sit under the boundary they name — break i is the edge between
      // class i and i+1 — not spread evenly and hoped for. This used to print the
      // 5th, 50th and 95th percentiles of the values at the two ends and the
      // middle of the strip, which describes a scale the map is not painting.
      ctx.fillStyle = MUTED;
      ctx.font = font(p(lg.labelSize), "600");
      ctx.textAlign = "center";
      for (const t of ticks) {
        const half = ctx.measureText(t.label).width / 2 / S;
        const x = Math.min(Math.max(lx.barX + t.pos * lg.barW, lx.barX + half), lx.barX + lg.barW - half);
        text(t.label, x, g.bandTop + lg.barH + lg.labelGap, lg.labelH);
      }

      // No data is a ZCTA that IS drawn and that neither source reports. It has a
      // colour on the map, so it needs an entry in the key.
      const ndY = g.bandTop + (g.rowH - lg.swatch) / 2;
      ctx.fillStyle = NO_DATA_COLOR;
      ctx.fillRect(p(lx.swatchX), p(ndY), p(lg.swatch), p(lg.swatch));
      hair();
      ctx.strokeRect(p(lx.swatchX), p(ndY), p(lg.swatch), p(lg.swatch));
      ctx.fillStyle = MUTED;
      ctx.font = font(p(lg.labelSize));
      ctx.textAlign = "left";
      text("No data reported", lx.ndTextX, g.bandTop, g.rowH);
    }

    // Attribution, right-aligned on the same band row. Measured first so each
    // brand name can be coloured and boxed on its own rather than treated as one
    // grey string.
    ctx.font = font(p(L.band.foot.size));
    ctx.textAlign = "left";
    const footer = footerSegments(dataDateRef.current, includeTitleRef.current);
    const widths = footer.map(s => ctx.measureText(s.text).width);
    const total = widths.reduce((a, b) => a + b, 0);
    let x = p(g.mapRight) - total;
    footer.forEach((seg, i) => {
      ctx.fillStyle = seg.url ? LINK : MUTED;
      ctx.fillText(seg.text, x, p(g.footTop + L.band.foot.h / 2));
      if (seg.url) links.push({ x, y: p(g.footTop), w: widths[i], h: p(L.band.foot.h), url: seg.url });
      x += widths[i];
    });

    return { canvas: out, links, period: dataPeriodRef.current };
  }, [alaskaZips.size, hawaiiZips.size]);

  useImperativeHandle(ref, () => ({
    getElement: () => containerRef.current,
    exportToCanvas,
  }), [exportToCanvas]);

  // `showCities`, `includeTitle` and `includeLegend` are deliberately absent:
  // labels are a visibility change and the two layout toggles only move the
  // frame, neither of which is a reason to tear down and re-download three maps.
  const mapCreationKey = useMemo(
    () => `${regionScope}|${regionName}|${selectedMetric}|${filteredData.length}|${scaleOk}`,
    [regionScope, regionName, selectedMetric, filteredData.length, scaleOk],
  );

  useEffect(() => {
    addPMTilesProtocol();
    setMapsLoaded(false);
    setInsetScales({});
    cityLayersRef.current = {};
    mainFitRef.current = null;

    (["main", "alaska", "hawaii"] as const).forEach(k => {
      mapsRef.current[k]?.remove();
      mapsRef.current[k] = null;
    });

    if (filteredDataRef.current.length === 0 || !scaleOk) {
      onReadyRef.current?.();
      return;
    }

    const currentClasses = classesRef.current;
    const pmtilesUrl = dataUrl("us_zip_codes.pmtiles");
    const frame = layout(includeTitleRef.current, includeLegendRef.current);
    const insetsDrawn = regionScope === "national" && (alaskaZips.size > 0 || hawaiiZips.size > 0);

    let loadedCount = 0;
    const requiredMaps = regionScope === "national"
      ? 1 + (alaskaZips.size > 0 ? 1 : 0) + (hawaiiZips.size > 0 ? 1 : 0)
      : 1;
    let isReadyTriggered = false;
    let isCleanedUp = false;

    const markReady = () => {
      if (isCleanedUp || isReadyTriggered) return;
      if (loadedCount >= requiredMaps) {
        isReadyTriggered = true;
        const main = mapsRef.current.main;
        if (main && typeof main.getZoom === "function") {
          const mz = main.getZoom();
          const ratio = (m: maplibregl.Map | null) =>
            m && typeof m.getZoom === "function"
              ? Math.pow(2, m.getZoom() - mz) / EXPORT_SCALE
              : undefined;
          setInsetScales({
            alaska: ratio(mapsRef.current.alaska),
            hawaii: ratio(mapsRef.current.hawaii),
          });
        }
        setMapsLoaded(true);
        onReadyRef.current?.();
      }
    };

    const createMap = (
      container: HTMLDivElement | null,
      key: "main" | "alaska" | "hawaii",
      bounds?: Bounds,
      validZips?: Set<string>,
    ) => {
      if (!container || isCleanedUp) return;

      const map = new maplibregl.Map({
        container,
        style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
        // The container is sized in stage units for the main map and in stage
        // units x EXPORT_SCALE for the insets, so both back onto exactly the
        // pixels the export canvas wants. The main map used to render 2272 px
        // wide and get stretched into a 3440 px slot — a 1.51x upscale on a file
        // whose whole selling point is that it is 3600 px across.
        pixelRatio: key === "main" ? EXPORT_SCALE : 1,
        interactive: false,
        attributionControl: false,
        fadeDuration: 0,
        renderWorldCopies: false,
        // maplibre-gl v5+: preserveDrawingBuffer moved out of MapOptions root
        // into canvasContextAttributes. Required for getCanvas() during export to
        // capture pixels instead of a blank buffer.
        canvasContextAttributes: { preserveDrawingBuffer: true },
        // Below the PMTiles tileset's minimum there are no tiles and the
        // choropleth renders nothing. See INSET_RENDER_W for why the insets are
        // rendered large enough that this floor never binds.
        minZoom: PMTILES_MIN_ZOOM,
      });
      mapsRef.current[key] = map;

      // MapLibre reports a rejected paint value as an error EVENT, not a throw,
      // so without this a broken layer is invisible to the catch below. That is
      // exactly how the old `step` expression failed: silently, on 670 of 869
      // metros, with a success toast.
      map.on("error", (e) => {
        const msg = (e as { error?: { message?: string } })?.error?.message ?? "unknown map error";
        if (/abort/i.test(msg)) return;   // teardown mid-load, not a fault
        console.error(`[Export] ${key} map error:`, msg);
        trackError("export_map_error", msg);
      });

      map.on("load", () => {
        if (isCleanedUp) { map.remove(); return; }
        try {
          map.resize();

          if (bounds) {
            const isValid = bounds.flat().every(n => Number.isFinite(n));
            if (isValid) {
              // 7 rather than 6 so Hawaii, whose bbox fits its inset at zoom 6.3,
              // is not left floating at two thirds of the box.
              const maxZoom = key === "main" ? 12 : 7;
              const padding = key === "main"
                ? mainPadding(bounds, frame.mapW, frame.mapH, insetsDrawn ? INSET_BLOCK_H : 0)
                : 10;
              if (key === "main") {
                mainFitRef.current = { bounds, reserveBottom: insetsDrawn ? INSET_BLOCK_H : 0 };
              }
              map.fitBounds(bounds, { padding, animate: false, maxZoom });
            }
          }

          const style = map.getStyle();
          const cityLayers: string[] = [];
          let firstCityLayerId: string | undefined;
          if (style?.layers) {
            for (const layer of style.layers) {
              const id = layer.id;
              const sourceLayer = (layer as { "source-layer"?: string })["source-layer"];
              const isCity = id.includes("place_city");
              const isWater = sourceLayer === "water";
              const isBoundary = id.includes("boundary_country") || id.includes("boundary_state");

              if (isCity) {
                if (!firstCityLayerId) firstCityLayerId = id;
                cityLayers.push(id);
                map.setLayoutProperty(id, "visibility", cityLabelsOnRef.current ? "visible" : "none");
              } else if (isWater || isBoundary) {
                map.setLayoutProperty(id, "visibility", "visible");
              } else {
                map.setLayoutProperty(id, "visibility", "none");
              }
            }
          }
          cityLayersRef.current[key] = cityLayers;

          map.addSource("zips", {
            type: "vector",
            url: `pmtiles://${pmtilesUrl}`,
            promoteId: "ZCTA5CE20",
          });

          const filterExpr = validZips
            ? ["in", ["get", "ZCTA5CE20"], ["literal", Array.from(validZips)]]
            : ["has", "ZCTA5CE20"];

          // The SAME constant `match` expression the live map uses. It reads a
          // class out of feature-state, so it never needs rewriting and — the
          // reason it replaced a `step` — it imposes no ordering on anything.
          //
          // The old expression took quantile thresholds as its stop values, and
          // MapLibre requires those to be strictly ascending. Ties in a small
          // region produce equal thresholds; `Style.addLayer` then fires an error
          // event and RETURNS WITHOUT ADDING THE LAYER, so the export came out as
          // ZIP outlines with no fill and still reported success. Measured across
          // the shipped snapshot: 1,521 of 6,952 metro x metric combinations, 670
          // of 869 metros. Reproduced on Pittsburgh, PA + Homes Sold.
          map.addLayer({
            id: "zips-fill", type: "fill", source: "zips", "source-layer": "us_zip_codes",
            filter: filterExpr as import("maplibre-gl").FilterSpecification,
            paint: {
              "fill-color": classPaintExpression() as unknown as string,
              "fill-opacity": FULL_OPACITY,
            },
          }, firstCityLayerId);

          map.addLayer({
            id: "zips-border", type: "line", source: "zips", "source-layer": "us_zip_codes",
            filter: filterExpr as import("maplibre-gl").FilterSpecification,
            paint: { "line-color": "rgba(0,0,0,0.1)", "line-width": 0.5 },
          }, firstCityLayerId);

          const zipsToColor = validZips ?? new Set(currentClasses.keys());
          let featureStatesApplied = false;

          const applyFeatureStates = () => {
            if (featureStatesApplied || isCleanedUp) return;
            featureStatesApplied = true;
            zipsToColor.forEach(zipCode => {
              const k = currentClasses.get(zipCode);
              // A ZIP with no value is left unset. `coalesce` in the expression
              // resolves that to -1, which the match answers with NO_DATA_COLOR.
              if (k !== undefined) {
                map.setFeatureState(
                  { source: "zips", sourceLayer: "us_zip_codes", id: zipCode },
                  { k },
                );
              }
            });
            map.triggerRepaint();
          };

          const onSourceData = (e: maplibregl.MapSourceDataEvent) => {
            if (e.sourceId === "zips" && e.isSourceLoaded && !featureStatesApplied) {
              map.off("sourcedata", onSourceData);
              applyFeatureStates();
            }
          };
          map.on("sourcedata", onSourceData);
          if (map.isSourceLoaded("zips")) {
            map.off("sourcedata", onSourceData);
            applyFeatureStates();
          }

          const checkInterval = setInterval(() => {
            if (isCleanedUp) { clearInterval(checkInterval); return; }
            if (!featureStatesApplied && map.isSourceLoaded("zips")) {
              map.off("sourcedata", onSourceData);
              applyFeatureStates();
            }
            if (map.loaded() && map.isStyleLoaded() && featureStatesApplied) {
              clearInterval(checkInterval);
              loadedCount++;
              markReady();
            }
          }, 250);

          setTimeout(() => {
            if (!isReadyTriggered && !isCleanedUp) {
              clearInterval(checkInterval);
              if (!featureStatesApplied) {
                map.off("sourcedata", onSourceData);
                applyFeatureStates();
              }
              loadedCount++;
              markReady();
            }
          }, MAP_READY_TIMEOUT_MS);

        } catch (error: unknown) {
          const errMsg = error instanceof Error ? error.message : "Unknown export map error";
          console.error(`[Export] Error initializing map ${key}:`, error);
          trackError("export_map_init_error", errMsg);
          loadedCount++;
          markReady();
        }
      });
    };

    if (regionScope === "national") {
      createMap(mainMapRef.current, "main", mainlandBounds ?? undefined, mainlandZips);
      if (alaskaZips.size > 0) createMap(alaskaMapRef.current, "alaska", alaskaBounds ?? undefined, alaskaZips);
      if (hawaiiZips.size > 0) createMap(hawaiiMapRef.current, "hawaii", hawaiiBounds ?? undefined, hawaiiZips);
    } else {
      const allBounds = mainlandBounds ?? alaskaBounds ?? hawaiiBounds;
      const allZips = new Set(filteredDataRef.current.map(z => z.zipCode));
      createMap(mainMapRef.current, "main", allBounds ?? undefined, allZips);
    }

    return () => {
      isCleanedUp = true;
      (["main", "alaska", "hawaii"] as const).forEach(k => {
        mapsRef.current[k]?.remove();
        mapsRef.current[k] = null;
      });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapCreationKey, alaskaZips, hawaiiZips, mainlandZips, alaskaBounds, hawaiiBounds, mainlandBounds]);

  // Title and legend change the SHAPE of the map frame. MapLibre resizes its own
  // canvas to match, but it keeps the zoom it was fitted at, so without this the
  // view stays framed for the old rectangle — and the bottom padding that holds
  // the states off the insets was computed for a height that no longer applies.
  useEffect(() => {
    if (!mapsLoaded) return;
    const map = mapsRef.current.main;
    const fit = mainFitRef.current;
    if (!map || !fit) return;
    const frame = layout(includeTitle, includeLegend);
    map.resize();
    map.fitBounds(fit.bounds, {
      padding: mainPadding(fit.bounds, frame.mapW, frame.mapH, fit.reserveBottom),
      animate: false,
      maxZoom: 12,
    });
  }, [includeTitle, includeLegend, mapsLoaded]);

  // City labels: a layout property on layers already found at load, so the
  // toggle costs a repaint rather than three rebuilds and a tile re-download.
  useEffect(() => {
    if (!mapsLoaded) return;
    (["main", "alaska", "hawaii"] as const).forEach(key => {
      const map = mapsRef.current[key];
      const ids = cityLayersRef.current[key];
      if (!map || !ids) return;
      for (const id of ids) {
        try { map.setLayoutProperty(id, "visibility", cityLabelsOn ? "visible" : "none"); }
        catch { /* layer went away with a style reload; nothing to toggle */ }
      }
    });
  }, [cityLabelsOn, mapsLoaded]);

  const insetRenderStyle = {
    width: INSET_RENDER_W,
    height: INSET_RENDER_H,
    transform: `scale(${1 / EXPORT_SCALE})`,
    transformOrigin: "top left" as const,
  };

  const insetChrome = (label: string, mapDivRef: React.RefObject<HTMLDivElement>) => (
    <div style={{ background: PANEL, border: `1px solid ${HAIRLINE}` }}>
      <div
        style={{
          height: L.inset.labelH, lineHeight: `${L.inset.labelH}px`, padding: "0 7px",
          fontSize: L.inset.labelSize, fontWeight: 600,
          color: MUTED, borderBottom: `1px solid ${HAIRLINE}`, whiteSpace: "pre",
        }}
      >
        {label}
      </div>
      <div style={{ width: L.inset.w, height: L.inset.h, overflow: "hidden", position: "relative" }}>
        <div ref={mapDivRef} style={insetRenderStyle} />
      </div>
    </div>
  );

  const lx = useMemo(() => legendGeom(metricLabel), [metricLabel]);

  return (
    <div className="w-full h-full flex items-center justify-center overflow-hidden bg-muted/10 select-none">
      <div
        ref={containerRef}
        style={{
          width: STAGE_W,
          height: STAGE_H,
          transform: `scale(${scale})`,
          boxShadow: "0 4px 24px rgba(15,23,42,0.14)",
          backgroundColor: PANEL,
          fontFamily: FONT_STACK,
          position: "relative",
        }}
        className="flex-shrink-0 origin-center rounded-md"
        onContextMenu={(e) => { e.preventDefault(); return false; }}
      >
        {includeTitle && (
          <>
            <div
              style={{
                position: "absolute", left: L.pad, right: L.pad,
                top: L.title.top, height: L.title.h, lineHeight: `${L.title.h}px`,
                fontSize: L.title.size, fontWeight: 700, color: INK,
              }}
            >
              {metricLabel} by ZIP Code
            </div>
            <div
              style={{
                position: "absolute", left: L.pad, right: L.pad,
                top: L.sub.top, height: L.sub.h, lineHeight: `${L.sub.h}px`,
                fontSize: L.sub.size, color: MUTED, whiteSpace: "pre",
              }}
            >
              {dataDate ? `${regionName}   ·   ${dataDate}` : regionName}
            </div>
          </>
        )}

        <div
          style={{
            position: "absolute",
            left: geom.mapLeft, top: geom.mapTop,
            width: geom.mapW, height: geom.mapH,
            background: MAP_BACKDROP,
            border: `1px solid ${HAIRLINE}`,
            boxSizing: "border-box",
          }}
        >
          <div ref={mainMapRef} className="absolute inset-0" />

          {regionScope === "national" && (
            <div
              style={{
                position: "absolute",
                left: L.inset.margin - 1, bottom: L.inset.margin - 1,
                display: "flex", gap: L.inset.gap, zIndex: 10,
              }}
            >
              {alaskaZips.size > 0 && insetChrome(alaskaLabel, alaskaMapRef)}
              {hawaiiZips.size > 0 && insetChrome(hawaiiLabel, hawaiiMapRef)}
            </div>
          )}

          {!mapsLoaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/90 z-50 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-3">
                {scaleOk ? (
                  <>
                    <div className="animate-spin rounded-full h-10 w-10 border-4 border-slate-200 border-t-cyan-600" />
                    <span className="text-sm font-medium text-slate-500">Rendering map…</span>
                  </>
                ) : (
                  <span className="text-sm font-medium text-slate-500">
                    Colour scale unavailable — the data manifest did not load.
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {includeLegend && legendTicks && (
          <>
            <div
              style={{
                position: "absolute", left: L.pad, top: geom.bandTop,
                width: lx.nameW, height: geom.rowH, lineHeight: `${geom.rowH}px`,
                fontSize: L.legend.titleSize, fontWeight: 600, color: INK,
                whiteSpace: "pre", overflow: "hidden",
              }}
            >
              {metricLabel}
            </div>
            <div
              style={{
                position: "absolute", left: lx.barX, top: geom.bandTop,
                width: L.legend.barW, height: L.legend.barH, display: "flex",
                border: `1px solid ${HAIRLINE}`, boxSizing: "border-box",
              }}
              aria-hidden="true"
            >
              {CHOROPLETH_COLORS.map((c, i) => (
                <div key={c + i} style={{ background: c, flex: 1 }} />
              ))}
            </div>
            <div
              style={{
                position: "absolute", left: lx.barX,
                top: geom.bandTop + L.legend.barH + L.legend.labelGap,
                width: L.legend.barW, height: L.legend.labelH,
              }}
            >
              {legendTicks.map(({ i, label, pos }) => (
                <span
                  key={i}
                  style={{
                    position: "absolute", left: `${pos * 100}%`, top: 0,
                    height: L.legend.labelH, lineHeight: `${L.legend.labelH}px`,
                    transform: "translateX(-50%)",
                    fontSize: L.legend.labelSize, fontWeight: 600, color: MUTED,
                    whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {label}
                </span>
              ))}
            </div>
            <div
              style={{
                position: "absolute", left: lx.swatchX, top: geom.bandTop,
                height: geom.rowH, display: "flex", alignItems: "center", gap: 6,
              }}
            >
              <span
                style={{
                  width: L.legend.swatch, height: L.legend.swatch, boxSizing: "border-box",
                  background: NO_DATA_COLOR, border: `1px solid ${HAIRLINE}`,
                  display: "inline-block",
                }}
              />
              <span style={{ fontSize: L.legend.labelSize, color: MUTED }}>
                No data reported
              </span>
            </div>
          </>
        )}

        <div
          style={{
            position: "absolute",
            right: L.pad, top: geom.footTop,
            height: L.band.foot.h, lineHeight: `${L.band.foot.h}px`,
            fontSize: L.band.foot.size, color: MUTED, whiteSpace: "pre",
          }}
        >
          {footerSegments(dataDate, includeTitle).map((seg, i) => seg.url ? (
            <a
              key={i}
              href={seg.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: LINK, textDecoration: "none" }}
            >
              {seg.text}
            </a>
          ) : (
            <span key={i}>{seg.text}</span>
          ))}
        </div>
      </div>
    </div>
  );
});

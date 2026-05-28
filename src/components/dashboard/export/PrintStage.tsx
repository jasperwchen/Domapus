import { useEffect, useRef, useMemo, forwardRef, useImperativeHandle, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { ZipData } from "../map/types";
import { addPMTilesProtocol } from "@/lib/pmtiles-protocol";
import { trackError } from "@/lib/analytics";
import { getMetricLabel } from "@/lib/metrics";
import { getMetricValue } from "@/lib/metric-value";
import { computeQuantileBuckets, computeQuantiles } from "@/lib/quantiles";
import bbox from "@turf/bbox";
import { featureCollection, point } from "@turf/helpers";

const BASE_PATH = import.meta.env.BASE_URL;
const CHOROPLETH_COLORS = ["#FFF9B0", "#FFEB84", "#FFD166", "#FF9A56", "#E84C61", "#C13584", "#7B2E8D", "#2E0B59"];
const BASE_WIDTH = 1200;
const BASE_HEIGHT = 900;
const BOUNDS_BUFFER = 0.15;

export const EXPORT_CANVAS_W = 3600;
export const EXPORT_CANVAS_H = 2700;
export const EXPORT_CANVAS_PAD = 80;
export const ATTRIBUTION_TEXT = "Built by Domapus • Data: Redfin & Zillow";
export const ATTRIBUTION_FONT = "32px sans-serif";
export const ATTRIBUTION_BASELINE_Y = EXPORT_CANVAS_PAD + 48;
export const ATTRIBUTION_RIGHT_X = EXPORT_CANVAS_W - EXPORT_CANVAS_PAD;

// Alaska bbox is bounded by what fits the inset at PMTILES_MIN_ZOOM (=3, the lowest
// zoom level the tileset publishes). At zoom 3, a 224×144 px inset can fit ~9° of
// latitude after Mercator stretching at lat 60°+, so we focus on the populated
// Anchorage / Fairbanks / Juneau corridor and accept that the Aleutians and arctic
// communities fall outside the frame. Lower minzooms would require regenerating the
// tileset, which we don't want to do.
const ALASKA_DEFAULT_BOUNDS: [[number, number], [number, number]] = [[-156.0, 56.5], [-130.0, 65.5]];
const HAWAII_DEFAULT_BOUNDS: [[number, number], [number, number]] = [[-160.5, 18.9], [-154.8, 22.3]];
const PMTILES_MIN_ZOOM = 3;
const MAP_READY_TIMEOUT_MS = 10_000;

export interface PrintStageProps {
  filteredData: ZipData[];
  selectedMetric: string;
  regionScope: "national" | "state" | "metro";
  regionName: string;
  includeLegend: boolean;
  includeTitle: boolean;
  showCities?: boolean;
  onReady?: () => void;
}

export interface PrintStageRef {
  getElement: () => HTMLDivElement | null;
  exportToCanvas: () => Promise<HTMLCanvasElement>;
}

const getDate = (): string =>
  new Date(new Date().setMonth(new Date().getMonth() - 1))
    .toLocaleDateString("en-US", { month: "long", year: "numeric" });

function formatLegendValue(value: number, metric: string): string {
  const m = metric.toLowerCase();
  if (m.includes("price") || m.includes("zhvi")) return `$${(value / 1000).toFixed(0)}k`;
  if (m.includes("ratio")) return `${value.toFixed(1)}%`;
  return value.toLocaleString();
}

/** Wait for a map to reach the idle state then capture its GL canvas as an image. */
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

    if (map.loaded() && map.isStyleLoaded()) {
      doCapture();
    } else {
      map.once("idle", doCapture);
    }
  });
}

export const PrintStage = forwardRef<PrintStageRef, PrintStageProps>(({
  filteredData, selectedMetric, regionScope, regionName, includeLegend, includeTitle, showCities = false, onReady
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mainMapRef = useRef<HTMLDivElement>(null);
  const alaskaMapRef = useRef<HTMLDivElement>(null);
  const hawaiiMapRef = useRef<HTMLDivElement>(null);
  const mapsRef = useRef<{ main: maplibregl.Map | null; alaska: maplibregl.Map | null; hawaii: maplibregl.Map | null }>({
    main: null, alaska: null, hawaii: null,
  });
  const [mapsLoaded, setMapsLoaded] = useState(false);
  const [scale, setScale] = useState(1);

  const onReadyRef = useRef(onReady);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);

  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current && containerRef.current.parentElement) {
        const parent = containerRef.current.parentElement;
        const scaleW = parent.clientWidth / BASE_WIDTH;
        const scaleH = parent.clientHeight / BASE_HEIGHT;
        setScale(Math.min(scaleW, scaleH));
        Object.values(mapsRef.current).forEach(map => map?.resize());
      }
    };
    handleResize();
    const observer = new ResizeObserver(handleResize);
    if (containerRef.current?.parentElement) observer.observe(containerRef.current.parentElement);
    return () => observer.disconnect();
  }, []);

  const zipDataMap = useMemo(() => {
    const map: Record<string, ZipData> = {};
    filteredData.forEach(zip => { map[zip.zipCode] = zip; });
    return map;
  }, [filteredData]);

  const { alaskaZips, hawaiiZips, mainlandZips, alaskaBounds, hawaiiBounds, mainlandBounds } = useMemo(() => {
    const ak = new Set<string>(), hi = new Set<string>(), ml = new Set<string>();
    const akPts: ReturnType<typeof point>[] = [], hiPts: ReturnType<typeof point>[] = [], mlPts: ReturnType<typeof point>[] = [];

    filteredData.forEach(zip => {
      const st = (zip.state ?? '').toUpperCase();
      const isAk = st === 'AK';
      const isHi = st === 'HI';
      const lat = zip.latitude;
      const lng = zip.longitude;

      if (isAk) {
        ak.add(zip.zipCode);
        if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng) && lng < 0) akPts.push(point([lng, lat]));
      } else if (isHi) {
        hi.add(zip.zipCode);
        if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) hiPts.push(point([lng, lat]));
      } else {
        ml.add(zip.zipCode);
        if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) mlPts.push(point([lng, lat]));
      }
    });

    const getSmartBbox = (pts: ReturnType<typeof point>[]): [[number, number], [number, number]] | null => {
      if (pts.length === 0) return null;
      const b = bbox(featureCollection(pts));
      return [
        [b[0] - BOUNDS_BUFFER, b[1] - BOUNDS_BUFFER],
        [b[2] + BOUNDS_BUFFER, b[3] + BOUNDS_BUFFER],
      ];
    };

    return {
      alaskaZips: ak,
      hawaiiZips: hi,
      mainlandZips: ml,
      alaskaBounds: ak.size > 0 ? (getSmartBbox(akPts) ?? ALASKA_DEFAULT_BOUNDS) : null,
      hawaiiBounds: hi.size > 0 ? (getSmartBbox(hiPts) ?? HAWAII_DEFAULT_BOUNDS) : null,
      mainlandBounds: getSmartBbox(mlPts),
    };
  }, [filteredData]);

  const buckets = useMemo(
    () => computeQuantileBuckets(filteredData.map(d => getMetricValue(d, selectedMetric))),
    [filteredData, selectedMetric],
  );

  const metricValues = useMemo(
    () => filteredData
      .map(d => d[selectedMetric as keyof ZipData] as number)
      .filter(v => typeof v === "number" && v > 0),
    [filteredData, selectedMetric],
  );

  const legendDisplay = useMemo(() => {
    if (metricValues.length === 0) return { min: "N/A", mid: "N/A", max: "N/A" };
    const [min, mid, max] = computeQuantiles(metricValues, [0.05, 0.5, 0.95]);
    return {
      min: formatLegendValue(min, selectedMetric),
      mid: formatLegendValue(mid, selectedMetric),
      max: formatLegendValue(max, selectedMetric),
    };
  }, [metricValues, selectedMetric]);

  const bucketsRef = useRef(buckets);
  bucketsRef.current = buckets;
  const zipDataMapRef = useRef(zipDataMap);
  zipDataMapRef.current = zipDataMap;
  const filteredDataRef = useRef(filteredData);
  filteredDataRef.current = filteredData;
  const selectedMetricRef = useRef(selectedMetric);
  selectedMetricRef.current = selectedMetric;
  const legendDisplayRef = useRef(legendDisplay);
  legendDisplayRef.current = legendDisplay;
  const includeLegendRef = useRef(includeLegend);
  includeLegendRef.current = includeLegend;
  const includeTitleRef = useRef(includeTitle);
  includeTitleRef.current = includeTitle;
  const regionNameRef = useRef(regionName);
  regionNameRef.current = regionName;
  const regionScopeRef = useRef(regionScope);
  regionScopeRef.current = regionScope;

  const exportToCanvas = useCallback(async (): Promise<HTMLCanvasElement> => {
    const EXPORT_W = EXPORT_CANVAS_W;
    const EXPORT_H = EXPORT_CANVAS_H;
    const PAD = EXPORT_CANVAS_PAD;

    const out = document.createElement("canvas");
    out.width = EXPORT_W;
    out.height = EXPORT_H;
    const ctx = out.getContext("2d");
    if (!ctx) throw new Error("Could not get 2D context");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, EXPORT_W, EXPORT_H);

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

    let mapTop = PAD;

    if (includeTitleRef.current) {
      ctx.fillStyle = "#0f172a";
      ctx.font = "bold 72px sans-serif";
      ctx.fillText(`${getMetricLabel(selectedMetricRef.current)} by ZIP Code`, PAD, PAD + 72);

      ctx.fillStyle = "#475569";
      ctx.font = "42px sans-serif";
      ctx.fillText(`${regionNameRef.current} • ${getDate()}`, PAD, PAD + 130);

      mapTop = PAD + 170;
    }

    ctx.fillStyle = "#9CA3AF";
    ctx.font = ATTRIBUTION_FONT;
    ctx.textAlign = "right";
    ctx.fillText(ATTRIBUTION_TEXT, ATTRIBUTION_RIGHT_X, ATTRIBUTION_BASELINE_Y);
    ctx.textAlign = "left";

    const mapLeft = PAD;
    const mapRight = EXPORT_W - PAD;
    const mapBottom = EXPORT_H - PAD;
    const mapWidth = mapRight - mapLeft;
    const mapHeight = mapBottom - mapTop;

    ctx.fillStyle = "#F8FAFC";
    ctx.fillRect(mapLeft, mapTop, mapWidth, mapHeight);

    if (mainGl) {
      ctx.drawImage(mainGl, mapLeft, mapTop, mapWidth, mapHeight);
    }

    if (regionScopeRef.current === "national") {
      const INSET_W = 400;
      const INSET_H = 260;
      const INSET_LABEL_H = 32;
      const insetY = mapBottom - INSET_H - INSET_LABEL_H - 12;
      let insetX = mapLeft + 12;

      const drawInset = (glCanvas: HTMLCanvasElement | null, label: string) => {
        if (!glCanvas) return;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(insetX, insetY, INSET_W, INSET_H + INSET_LABEL_H);
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 1;
        ctx.strokeRect(insetX, insetY, INSET_W, INSET_H + INSET_LABEL_H);
        ctx.fillStyle = "#64748B";
        ctx.font = "bold 24px sans-serif";
        ctx.fillText(label, insetX + 8, insetY + 24);
        ctx.drawImage(glCanvas, insetX, insetY + INSET_LABEL_H, INSET_W, INSET_H);
        insetX += INSET_W + 12;
      };

      if (alaskaZips.size > 0) drawInset(alaskaGl, "Alaska");
      if (hawaiiZips.size > 0) drawInset(hawaiiGl, "Hawaii");
    }

    if (includeLegendRef.current) {
      const LEGEND_W = 600;
      const LEGEND_H = 28;
      const LEGEND_MARGIN_R = 40;
      const LEGEND_MARGIN_B = 40;
      const legendX = mapRight - LEGEND_W - LEGEND_MARGIN_R;
      const legendY = mapBottom - LEGEND_MARGIN_B - 32 - LEGEND_H;

      const gradient = ctx.createLinearGradient(legendX, 0, legendX + LEGEND_W, 0);
      CHOROPLETH_COLORS.forEach((color, i) => {
        gradient.addColorStop(i / (CHOROPLETH_COLORS.length - 1), color);
      });

      ctx.beginPath();
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(legendX, legendY, LEGEND_W, LEGEND_H, 4);
      } else {
        ctx.rect(legendX, legendY, LEGEND_W, LEGEND_H);
      }
      ctx.fillStyle = gradient;
      ctx.fill();

      const ld = legendDisplayRef.current;
      ctx.fillStyle = "#1e293b";
      ctx.font = "bold 26px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(ld.min, legendX, legendY + LEGEND_H + 32);
      ctx.textAlign = "center";
      ctx.fillText(ld.mid, legendX + LEGEND_W / 2, legendY + LEGEND_H + 32);
      ctx.textAlign = "right";
      ctx.fillText(ld.max, legendX + LEGEND_W, legendY + LEGEND_H + 32);
      ctx.textAlign = "left";
    }

    return out;
  }, [alaskaZips.size, hawaiiZips.size]);

  useImperativeHandle(ref, () => ({
    getElement: () => containerRef.current,
    exportToCanvas,
  }), [exportToCanvas]);

  const mapCreationKey = useMemo(
    () => `${regionScope}|${regionName}|${selectedMetric}|${filteredData.length}|${showCities}`,
    [regionScope, regionName, selectedMetric, filteredData.length, showCities],
  );

  useEffect(() => {
    addPMTilesProtocol();
    setMapsLoaded(false);

    (["main", "alaska", "hawaii"] as const).forEach(k => {
      mapsRef.current[k]?.remove();
      mapsRef.current[k] = null;
    });

    if (filteredDataRef.current.length === 0) {
      onReadyRef.current?.();
      return;
    }

    const currentBuckets = bucketsRef.current;
    const currentZipDataMap = zipDataMapRef.current;
    const currentFilteredData = filteredDataRef.current;
    const currentMetric = selectedMetricRef.current;

    const pmtilesUrl = new URL(`${BASE_PATH}data/us_zip_codes.pmtiles`, window.location.origin).href;
    const stepExpression = [
      "step",
      ["coalesce", ["feature-state", "metricValue"], 0],
      "#efefef",
      0.000001, CHOROPLETH_COLORS[0],
      ...currentBuckets.flatMap((threshold, i) => [
        threshold,
        CHOROPLETH_COLORS[Math.min(i + 1, CHOROPLETH_COLORS.length - 1)],
      ]),
    ];

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
        setMapsLoaded(true);
        onReadyRef.current?.();
      }
    };

    const createMap = (
      container: HTMLDivElement | null,
      key: "main" | "alaska" | "hawaii",
      bounds?: [[number, number], [number, number]],
      validZips?: Set<string>,
    ) => {
      if (!container || isCleanedUp) return;

      const map = new maplibregl.Map({
        container,
        style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
        pixelRatio: 2,
        interactive: false,
        attributionControl: false,
        fadeDuration: 0,
        renderWorldCopies: false,
        // maplibre-gl v5: preserveDrawingBuffer moved out of MapOptions root into canvasContextAttributes.
        // Required for getCanvas() during PNG/PDF export to capture pixels instead of a blank buffer.
        canvasContextAttributes: { preserveDrawingBuffer: true },
        // Insets fit Alaska/Hawaii at very low zooms; without this, fitBounds picks a zoom
        // below the PMTiles tileset's minimum and the choropleth layer renders nothing.
        minZoom: PMTILES_MIN_ZOOM,
      });
      mapsRef.current[key] = map;

      map.on("load", () => {
        if (isCleanedUp) { map.remove(); return; }
        try {
          map.resize();

          if (bounds) {
            const isValid = bounds.flat().every(n => Number.isFinite(n));
            if (isValid) {
              // Inset uses tight padding so the tightened AK bbox can fit horizontally
              // at the PMTiles min zoom (the constraint is the tileset, not the bbox).
              const padding = key === "main" ? 40 : 8;
              const maxZoom = key === "main" ? 12 : 6;
              map.fitBounds(bounds, { padding, animate: false, maxZoom });
            }
          }

          const style = map.getStyle();
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
                map.setLayoutProperty(id, "visibility", showCities ? "visible" : "none");
              } else if (isWater || isBoundary) {
                map.setLayoutProperty(id, "visibility", "visible");
              } else {
                map.setLayoutProperty(id, "visibility", "none");
              }
            }
          }

          map.addSource("zips", {
            type: "vector",
            url: `pmtiles://${pmtilesUrl}`,
            promoteId: "ZCTA5CE20",
          });

          const filterExpr = validZips
            ? ["in", ["get", "ZCTA5CE20"], ["literal", Array.from(validZips)]]
            : ["has", "ZCTA5CE20"];

          map.addLayer({
            id: "zips-fill", type: "fill", source: "zips", "source-layer": "us_zip_codes",
            filter: filterExpr as import("maplibre-gl").FilterSpecification,
            paint: { "fill-color": stepExpression as unknown as string, "fill-opacity": 0.9 },
          }, firstCityLayerId);

          map.addLayer({
            id: "zips-border", type: "line", source: "zips", "source-layer": "us_zip_codes",
            filter: filterExpr as import("maplibre-gl").FilterSpecification,
            paint: { "line-color": "rgba(0,0,0,0.1)", "line-width": 0.5 },
          }, firstCityLayerId);

          const zipsToColor = validZips ?? new Set(currentFilteredData.map(z => z.zipCode));
          let featureStatesApplied = false;

          const applyFeatureStates = () => {
            if (featureStatesApplied || isCleanedUp) return;
            featureStatesApplied = true;
            zipsToColor.forEach(zipCode => {
              const data = currentZipDataMap[zipCode];
              if (data) {
                map.setFeatureState(
                  { source: "zips", sourceLayer: "us_zip_codes", id: zipCode },
                  { metricValue: getMetricValue(data, currentMetric) },
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
      const allZips = new Set(filteredData.map(z => z.zipCode));
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

  return (
    <div className="w-full h-full flex items-center justify-center overflow-hidden bg-muted/10 select-none">
      <div
        ref={containerRef}
        style={{
          width: `${BASE_WIDTH}px`,
          height: `${BASE_HEIGHT}px`,
          transform: `scale(${scale})`,
          boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
          backgroundColor: "#ffffff",
        }}
        className="flex flex-col flex-shrink-0 origin-center rounded-md"
        onContextMenu={(e) => { e.preventDefault(); return false; }}
      >
        <div className="flex items-start justify-between px-8 pt-6 pb-4">
          {includeTitle && (
            <div>
              <h1 className="text-3xl font-bold leading-tight text-gray-900">
                {getMetricLabel(selectedMetric)} by ZIP Code
              </h1>
              <p className="text-base mt-1 text-gray-500">{regionName} • {getDate()}</p>
            </div>
          )}
          <div className="flex items-center gap-2 text-xs text-gray-400 whitespace-nowrap flex-shrink-0 ml-auto mt-1">
            <span>
              Built by{" "}
              <a href="https://jasperwchen.github.io/Domapus/" target="_blank" rel="noopener noreferrer" className="text-cyan-600 hover:underline">
                Domapus
              </a>
            </span>
            <span className="opacity-60">•</span>
            <span>
              Data:{" "}
              <a href="https://www.redfin.com/news/data-center/" target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: "#0c82a5" }}>
                Redfin
              </a>{" "}
              &{" "}
              <a href="https://www.zillow.com/research/data/" target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: "#0c82a5" }}>
                Zillow
              </a>
            </span>
          </div>
        </div>

        <div className="flex-1 mx-8 mb-6 relative bg-slate-50">
          <div ref={mainMapRef} className="absolute inset-0" />

          {regionScope === "national" && (
            <div className="absolute bottom-4 left-4 flex gap-4 z-10">
              {alaskaZips.size > 0 && (
                <div className="flex flex-col bg-white border border-black">
                  <span className="text-[10px] uppercase tracking-wider font-semibold py-0.5 px-2 bg-slate-50 text-slate-500 border-b">
                    Alaska
                  </span>
                  <div className="w-56 h-36 relative">
                    <div ref={alaskaMapRef} className="absolute inset-0" />
                  </div>
                </div>
              )}
              {hawaiiZips.size > 0 && (
                <div className="flex flex-col bg-white border border-black">
                  <span className="text-[10px] uppercase tracking-wider font-semibold py-0.5 px-2 bg-slate-50 text-slate-500 border-b">
                    Hawaii
                  </span>
                  <div className="w-56 h-36 relative">
                    <div ref={hawaiiMapRef} className="absolute inset-0" />
                  </div>
                </div>
              )}
            </div>
          )}

          {includeLegend && (
            <div className="absolute bottom-4 right-4 z-10 p-4 bg-white/95 backdrop-blur rounded-md">
              <div
                className="h-4 w-56"
                style={{ background: `linear-gradient(to right, ${CHOROPLETH_COLORS.join(", ")})`, borderRadius: "4px" }}
              />
              <div className="mt-2 flex justify-between text-xs font-semibold w-56 text-gray-600">
                <span>{legendDisplay.min}</span>
                <span>{legendDisplay.mid}</span>
                <span>{legendDisplay.max}</span>
              </div>
            </div>
          )}

          {!mapsLoaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/90 z-50 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-3">
                <div className="animate-spin rounded-full h-10 w-10 border-4 border-slate-200 border-t-cyan-600" />
                <span className="text-sm font-medium text-slate-500">Rendering map…</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

PrintStage.displayName = "PrintStage";
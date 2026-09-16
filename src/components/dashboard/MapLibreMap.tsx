import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import * as maplibregl from 'maplibre-gl';
import type { MapMouseEvent, LayerSpecification } from 'maplibre-gl';
import "maplibre-gl/dist/maplibre-gl.css";
import "@/lib/maplibre-worker";
import { createMetricPopupContent } from "./map/utils";
import { ZipData } from "./map/types";
import { dataUrl } from "@/lib/data-url";
import { addPMTilesProtocol } from "@/lib/pmtiles-protocol";
import { trackError } from "@/lib/analytics";
import { Fullscreen } from "lucide-react";
import {
  ChoroplethPainter, classOpacityExpression, classPaintExpression, outlierColorExpression,
  countZipPaintRewrites, loadedZips,
} from "@/lib/choropleth-painter";
import type { ClassSource } from "@/lib/class-source";
import type { ZipTable } from "@/lib/zip-table";
import { mark, measure } from "@/lib/perf";
import type { ProgressData } from "@/workers/worker-types";


interface MapProps {
  selectedMetric: string;
  onZipSelect: (zipData: ZipData) => void;
  searchZip?: string;
  searchTrigger?: number;
  /** Null until the snapshot lands. The map still paints without it — the paint
   *  table colours the fill — so nothing here may block on it. */
  store: ZipTable | null;
  isLoading: boolean;
  loadingProgress?: ProgressData;
  /** The one live class authority. Swapping it bumps an epoch; the painter
   *  rewrites the full ZIP set and the paint expression never changes. */
  classSource: ClassSource | null;
  /** Lazy accessor for ZIPs on loaded tiles (a `querySourceFeatures` over every tile), so
   *  only auto-scale, which is off by default, pays for it. */
  onMapMove: (
    loaded: () => readonly string[],
    bounds: maplibregl.LngLatBounds,
    view?: { lat: number; lng: number; zoom: number }
  ) => void;
  onUserInteraction?: () => void;
  /** Mark the ZIPs whose price disagrees with their neighbours. Off by default. */
  showLisa?: boolean;
  initialCenter?: [number, number];
  initialZoom?: number;
}

const MAP_RELOAD_DELAY_MS = 800;
const RELOAD_ATTEMPTS_KEY = "domapus:map-reload-attempts";
const MAX_RELOAD_ATTEMPTS = 2;

const LABEL_SOURCE = "zip-labels";
const OUTLIER_SOURCE = "zip-outliers";
const OUTLIER_LAYER = "zip-outliers-dots";
/** ZIP numbers appear here. Below it the polygons are too small to label. */
const LABEL_MIN_ZOOM = 9.5;
/** Degrees of slack around the viewport, so a label near the edge is already
 *  placed when the pan brings it in rather than popping in afterwards. */
const LABEL_MARGIN_DEG = 0.25;

type PointFC = GeoJSON.FeatureCollection<GeoJSON.Point>;
const EMPTY_FC: PointFC = { type: "FeatureCollection", features: [] };

/** The lower 48, and the view the map opens on. Was written out twice, once at
 *  init and once in the reset button; the zoom floor below needs its width too. */
const DEFAULT_BOUNDS: [[number, number], [number, number]] = [
  [-124.7844079, 24.7433195],
  [-66.9513812, 49.3457868],
];

/** What the tileset actually carries (`geometry.lock.json` min_zoom). */
const TILESET_MIN_ZOOM = 2;
/** The floor that guarantees every ZCTA has a polygon. z2 is 75 short of
 *  33,780, which is why the map prefers to stop here. */
const COVERAGE_MIN_ZOOM = 3;
/** How much of the container width the country is allowed to fill when the
 *  floor has to be relaxed, leaving a visible margin rather than bleeding the
 *  coasts off both edges. */
const FIT_WIDTH_FRACTION = 0.92;


/**
 * Zoom floor. z3 guarantees every ZCTA has a polygon, but a 375 px phone cannot fit the lower
 * 48 at z3, so narrow viewports may go to the tileset's z2 (missing 75 of 33,780 ZCTAs, all
 * sub-pixel there). Viewports wider than ~715 px keep z3.
 */
function zoomFloorFor(containerWidthPx: number): number {
  const spanDeg = DEFAULT_BOUNDS[1][0] - DEFAULT_BOUNDS[0][0];
  const usable = Math.max(1, containerWidthPx * FIT_WIDTH_FRACTION);
  // World width at zoom z is 512 * 2^z CSS px.
  const fitZoom = Math.log2((usable * 360) / (512 * spanDeg));
  return Math.max(TILESET_MIN_ZOOM, Math.min(COVERAGE_MIN_ZOOM, fitZoom));
}

export function MapLibreMap({
  selectedMetric,
  onZipSelect,
  searchZip,
  searchTrigger,
  store,
  isLoading,
  loadingProgress,
  classSource,
  onMapMove,
  onUserInteraction,
  showLisa = false,
  initialCenter,
  initialZoom,
}: MapProps) {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [isMapReady, setIsMapReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const interactionsSetup = useRef(false);
  const [pmtilesLoaded, setPmtilesLoaded] = useState(false);
  const mousemoveRafRef = useRef<number | null>(null);
  const lastMouseEventRef = useRef<MapMouseEvent | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const painterRef = useRef<ChoroplethPainter | null>(null);
  const highlightedZipRef = useRef<string | null>(null);
  /** The ZIP currently under the cursor, so the popup is rebuilt on change only. */
  const hoveredZipRef = useRef<string | null>(null);
  /** Features currently in the label source, so an already-empty source is not
   *  re-set to empty on every moveend below the label zoom. */
  const labelCountRef = useRef(0);
  const containerSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reloadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userInteractionNotifiedRef = useRef(false);
  const initialViewRef = useRef({ center: initialCenter, zoom: initialZoom });

  const getDynamicPadding = useCallback((container: HTMLDivElement) => {
    const minDim = Math.min(container.clientWidth, container.clientHeight);
    // Cap padding at 6% a side on phones, where the short side is the width.
    const cap = container.clientWidth < 700 ? container.clientWidth * 0.06 : 100;
    return Math.min(minDim * 0.12, cap);
  }, []);

  const applyLabelContrast = useCallback((map: maplibregl.Map) => {
    const style = map.getStyle();
    if (!style?.layers) return;

    style.layers.forEach((layer: LayerSpecification) => {
      if (layer.type !== "symbol") return;
      const layout = (layer.layout ?? {}) as Record<string, unknown>;
      if (!layout["text-field"]) return;

      try {
        map.setPaintProperty(layer.id, "text-halo-color", "rgba(255,255,255,0.95)");
        map.setPaintProperty(layer.id, "text-halo-width", 1);
        map.setPaintProperty(layer.id, "text-halo-blur", 0.2);
      } catch (err) {
        console.warn(`[Map] Could not update label contrast for ${layer.id}`, err);
      }
    });
  }, []);

  // Refs for current data to avoid stale closures
  const propsRef = useRef({ store, selectedMetric, onZipSelect });
  useEffect(() => {
    propsRef.current = { store, selectedMetric, onZipSelect };
  }, [store, selectedMetric, onZipSelect]);
  const hasData = useMemo(() => (store?.n ?? 0) > 0, [store]);
  const scheduleReload = useCallback(() => {
    const attempts = Number(sessionStorage.getItem(RELOAD_ATTEMPTS_KEY) ?? "0");
    if (attempts >= MAX_RELOAD_ATTEMPTS) {
      setError("The map failed to load. Please refresh the page or try a different browser.");
      return;
    }
    sessionStorage.setItem(RELOAD_ATTEMPTS_KEY, String(attempts + 1));

    if (reloadTimeoutRef.current) {
      clearTimeout(reloadTimeoutRef.current);
    }
    reloadTimeoutRef.current = setTimeout(() => {
      window.location.reload();
    }, MAP_RELOAD_DELAY_MS);
  }, []);

  const recoverMapView = useCallback((map: maplibregl.Map) => {
    setError(null);
    requestAnimationFrame(() => {
      map.resize();
      map.triggerRepaint();
    });
  }, []);

  // 1. Initialize Map
  const createAndInitializeMap = useCallback((container: HTMLDivElement) => {
    addPMTilesProtocol();
    const dynamicPadding = getDynamicPadding(container);

    // The starting view comes from props. This used to re-read lat/lng/zoom from
    // the URL here as well, so two places independently decided where the map
    // opens and could disagree.
    const view = initialViewRef.current;
    const hasInitialView =
      view.center !== undefined && view.zoom !== undefined &&
      isFinite(view.center[0]) && isFinite(view.center[1]) && isFinite(view.zoom);

    const map = new maplibregl.Map({
      container,
      style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
      // Tiles go to z10; MapLibre overzooms to 12 with ~0.25 px error. Re-tile before raising
      // maxZoom past 14.
      minZoom: zoomFloorFor(container.clientWidth),
      maxZoom: 12,
      ...(hasInitialView
        ? { center: view.center!, zoom: view.zoom! }
        : { bounds: DEFAULT_BOUNDS, fitBoundsOptions: { padding: dynamicPadding } }),
      attributionControl: false,
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("error", (e) => {
      const mapError = e as { error?: { message?: string } };
      const errMsg = mapError?.error?.message ?? "Map internal error";
      const normalizedErr = errMsg.toLowerCase();
      const isDecodingError = normalizedErr.includes('decoding') || normalizedErr.includes('decode');
      const isContextLossError =
        normalizedErr.includes("webgl context") ||
        /context.*lost|lost.*context/.test(normalizedErr);
      if (isDecodingError || isContextLossError) {
        console.warn("[Map] Recoverable map error (suppressed):", errMsg);
        recoverMapView(map);
        return;
      }
      console.error("[Map] Internal error:", mapError?.error ?? e);
      trackError("map_internal_error", errMsg);
      setError("Map internal error. Reloading...");
      scheduleReload();
    });

    map.once("load", () => {
      mark("map:styleLoad");
      sessionStorage.removeItem(RELOAD_ATTEMPTS_KEY);
      applyLabelContrast(map);
      setIsMapReady(true);
      const center = map.getCenter();
      onMapMoveRef.current(
        () => loadedZips(map),
        map.getBounds(),
        { lat: center.lat, lng: center.lng, zoom: map.getZoom() }
      );
    });

    return map;
  }, [applyLabelContrast, getDynamicPadding, recoverMapView, scheduleReload]);

  // 2. Setup Map Instance
  useEffect(() => {
    if (!mapContainer.current) return;
    if (mapRef.current) return;

    const container = mapContainer.current;
    let didUnmount = false;

    const tryInit = () => {
      if (didUnmount) return;
      if (container.clientWidth === 0 || container.clientHeight === 0) return;

      try {
        const m = createAndInitializeMap(container);
        mapRef.current = m;
        containerSizeRef.current = { width: container.clientWidth, height: container.clientHeight };
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : "Map initialization failed";
        console.error("Map init failed", err);
        trackError("map_init_failed", errMsg);
      }
    };

    const handleResize = () => {
      if (didUnmount) return;

      // Retry init, not just resize: `tryInit` gives up on a 0x0 container, which left a blank
      // map with no error whenever layout had not settled yet.
      if (!mapRef.current) {
        tryInit();
        return;
      }

      const newWidth = container.clientWidth;
      const newHeight = container.clientHeight;
      const widthDiff = Math.abs(newWidth - containerSizeRef.current.width);
      const heightDiff = Math.abs(newHeight - containerSizeRef.current.height);

      if (widthDiff > 5 || heightDiff > 5) {
        if (resizeTimeoutRef.current) {
          clearTimeout(resizeTimeoutRef.current);
        }

        resizeTimeoutRef.current = setTimeout(() => {
          if (!didUnmount && mapRef.current) {
            containerSizeRef.current = { width: newWidth, height: newHeight };
            mapRef.current.resize();
          }
        }, 150);
      }
    };

    const ro = new ResizeObserver(handleResize);
    ro.observe(container);
    tryInit();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && mapRef.current) {
        recoverMapView(mapRef.current);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      didUnmount = true;
      ro.disconnect();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      if (reloadTimeoutRef.current !== null) {
        clearTimeout(reloadTimeoutRef.current);
        reloadTimeoutRef.current = null;
      }
      if (mousemoveRafRef.current) {
        cancelAnimationFrame(mousemoveRafRef.current);
        mousemoveRafRef.current = null;
      }
      if (popupRef.current) {
        popupRef.current.remove();
        popupRef.current = null;
      }
      painterRef.current?.dispose();
      painterRef.current = null;
      if (mapRef.current) {
        try {
          mapRef.current.remove();
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : "Map removal failed";
          console.warn("[MapLibreMap] error removing map", err);
          trackError("map_removal_failed", errMsg);
        }
        mapRef.current = null;
      }
      setIsMapReady(false);
      interactionsSetup.current = false;
    };
  }, [createAndInitializeMap, recoverMapView]);

  const onMapMoveRef = useRef(onMapMove);
  useEffect(() => {
    onMapMoveRef.current = onMapMove;
  }, [onMapMove]);
  const onUserInteractionRef = useRef(onUserInteraction);
  useEffect(() => {
    onUserInteractionRef.current = onUserInteraction;
  }, [onUserInteraction]);

  // 3. Setup Interactions
  const setupMapInteractions = useCallback(() => {
    const map = mapRef.current;
    if (!map || interactionsSetup.current) return;

    const layerId = "zips-fill";

    const notifyUserInteraction = () => {
      if (userInteractionNotifiedRef.current) return;
      userInteractionNotifiedRef.current = true;
      onUserInteractionRef.current?.();
    };

    /** Clear the hover outline, wherever it currently is. */
    const clearHover = () => {
      if (hoveredZipRef.current === null) return;
      map.setFeatureState(
        { source: "zips", sourceLayer: "us_zip_codes", id: hoveredZipRef.current },
        { hovered: false },
      );
      hoveredZipRef.current = null;
    };

    const mousemoveHandler = (e: MapMouseEvent) => {
      notifyUserInteraction();
      lastMouseEventRef.current = e;
      if (mousemoveRafRef.current) return;
      mousemoveRafRef.current = requestAnimationFrame(() => {
        const ev = lastMouseEventRef.current;
        mousemoveRafRef.current = null;
        if (!ev) return;

        try {
          const features = map.queryRenderedFeatures(ev.point, { layers: [layerId] });
          const isHovering = features.length > 0;
          map.getCanvas().style.cursor = isHovering ? "pointer" : "";

          if (!isHovering) {
            popupRef.current?.remove();
            clearHover();
            return;
          }

          const props = features[0].properties ?? {};
          const zipCode = (props.ZCTA5CE20 || props.zipCode || props.id) as string;
          const { store: currentStore, selectedMetric: currentMetric } = propsRef.current;

          // Rebuild popup DOM only when the hovered ZIP changes; within a ZIP just move it.
          if (zipCode && zipCode === hoveredZipRef.current && popupRef.current) {
            popupRef.current.setLngLat(ev.lngLat);
            return;
          }

          // One object per hover, materialised on demand — not 33,771 at load.
          const row = zipCode ? currentStore?.get(zipCode) : null;

          if (!row) {
            popupRef.current?.remove();
            clearHover();
            return;
          }

          // The map itself reacting to the cursor. Without this the only hover
          // feedback was the popup, so the surface being pointed at never
          // acknowledged the pointer and the map read as unresponsive.
          clearHover();
          map.setFeatureState(
            { source: "zips", sourceLayer: "us_zip_codes", id: zipCode },
            { hovered: true },
          );
          hoveredZipRef.current = zipCode;

          if (!popupRef.current) {
            popupRef.current = new maplibregl.Popup({
              closeButton: false, offset: [0, -10], maxWidth: "320px"
            });
          }

          popupRef.current
            .setLngLat(ev.lngLat)
            .setDOMContent(createMetricPopupContent(row, currentMetric))
            .addTo(map);

        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : "Mousemove error";
          console.error("mousemove error", err);
          trackError("map_mousemove_error", errMsg);
        }
      });
    };

    const clickHandler = (e: MapMouseEvent) => {
      notifyUserInteraction();
      // Markers first, with a small hit box, then fall through to the fill.
      const hit = map.getLayer(OUTLIER_LAYER)
        ? map.queryRenderedFeatures(
            [[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]],
            { layers: [OUTLIER_LAYER] },
          )
        : [];
      const features = hit.length
        ? hit
        : map.queryRenderedFeatures(e.point, { layers: [layerId] });

      if (!features.length) return;

      const props = features[0].properties ?? {};
      const zipCode = (props.ZCTA5CE20 || props.zip || props.zipCode || props.id) as string;
      const { store: currentStore, onZipSelect: currentOnSelect } = propsRef.current;
      const row = zipCode ? currentStore?.get(zipCode) : null;
      if (row) currentOnSelect(row);
    };

    const mouseoutHandler = () => {
      map.getCanvas().style.cursor = "";
      popupRef.current?.remove();
      clearHover();
    };

    const moveEndHandler = () => {
      const center = map.getCenter();
      labelBuildRef.current();
      onMapMoveRef.current(
        () => loadedZips(map),
        map.getBounds(),
        { lat: center.lat, lng: center.lng, zoom: map.getZoom() }
      );
    };

    map.on("mousemove", mousemoveHandler);
    map.on("click", clickHandler);
    map.on("mouseout", mouseoutHandler);
    map.on("moveend", moveEndHandler);

    interactionsSetup.current = true;
  }, []);

  // 4. Add PMTiles Source & Layer
  useEffect(() => {
    if (!isMapReady || !mapRef.current) return;
    const map = mapRef.current;

    if (map.getSource("zips")) return;

    try {
      // Hide transportation layers for cleaner look
      const style = map.getStyle();
      if (!style || !style.layers) return;
      const styleLayers = style.layers;
      styleLayers.forEach((layer: LayerSpecification) => {
        if ('source-layer' in layer) {
          const sourceLayer = layer['source-layer'] as string;
          if (sourceLayer === "transportation" || sourceLayer === "transportation_name") {
            map.setLayoutProperty(layer.id, "visibility", "none");
          }
        }
      });

      const pmtilesUrl = dataUrl("us_zip_codes.pmtiles");

      map.addSource("zips", {
        type: "vector",
        url: `pmtiles://${pmtilesUrl}`,
        promoteId: "ZCTA5CE20"
      });

      const layers = map.getStyle().layers;
      const stateBoundaryLayer = layers.find((l: LayerSpecification) => l.id === "boundary_state");
      const labelLayer = layers.find((l: LayerSpecification) => l.id === "watername_ocean");
      const beforeId = stateBoundaryLayer?.id || labelLayer?.id;

      // Fill layer. BOTH paint values are CONSTANT and are never rewritten:
      // that is the entire choropleth fix. The class index lives in
      // feature-state, which setFeatureState updates without a source reload.
      map.addLayer({
        id: "zips-fill",
        type: "fill",
        source: "zips",
        "source-layer": "us_zip_codes",
        paint: {
          "fill-color": classPaintExpression() as never,
          "fill-opacity": classOpacityExpression() as never,
        }
      }, beforeId);

      // Point sources for labels and outlier markers. A polygon clipped across tiles gets one
      // symbol per piece (duplicate labels), and 47 outlier polygons are invisible at national zoom.
      map.addSource(LABEL_SOURCE, { type: "geojson", data: EMPTY_FC });
      map.addSource(OUTLIER_SOURCE, { type: "geojson", data: EMPTY_FC });

      painterRef.current = new ChoroplethPainter(map);
      countZipPaintRewrites(map);
      // Debug handle. bench/verify-choropleth.mjs and any console session need
      // a way to reach the map; without one the acceptance check cannot be run
      // against a production build, which is the only build worth checking.
      (window as unknown as Record<string, unknown>).__map = map;

      // Border layer
      map.addLayer({
        id: "zips-border",
        type: "line",
        source: "zips",
        "source-layer": "us_zip_codes",
        paint: {
          // Priority: searched ZIP, hovered ZIP, everything else. Feature-state, never a paint rewrite.
          "line-color": [
            "case",
            ["boolean", ["feature-state", "highlighted"], false], "#ff6b35",
            ["boolean", ["feature-state", "hovered"], false], "#1f2937",
            "rgba(0,0,0,0.15)"
          ],
          "line-width": [
            "interpolate", ["linear"], ["zoom"],
            3, ["case",
                ["boolean", ["feature-state", "highlighted"], false], 2,
                ["boolean", ["feature-state", "hovered"], false], 1.2, 0.3],
            6, ["case",
                ["boolean", ["feature-state", "highlighted"], false], 3,
                ["boolean", ["feature-state", "hovered"], false], 1.8, 0.6],
            10, ["case",
                ["boolean", ["feature-state", "highlighted"], false], 4,
                ["boolean", ["feature-state", "hovered"], false], 2.5, 1.5],
            12, ["case",
                ["boolean", ["feature-state", "highlighted"], false], 5,
                ["boolean", ["feature-state", "hovered"], false], 3, 2]
          ],
          // Below z4 the border network packs into fewer pixels and greys the choropleth (stroke ink
          // ~0.198 km per km2 x width x km/px: darkening 4.8% at z4, 13.7% at z2). Opacity holds ink at
          // its z4 level: 0.33 at z2, 0.67 at z3, 1 from z4. Hovered and searched ZIPs stay full.
          // Recompute if line-width changes. ["zoom"] must be the outer interpolate, hence the repeats.
          "line-opacity": [
            "interpolate", ["linear"], ["zoom"],
            2, ["case", ["any",
                ["boolean", ["feature-state", "highlighted"], false],
                ["boolean", ["feature-state", "hovered"], false]], 1, 0.33],
            3, ["case", ["any",
                ["boolean", ["feature-state", "highlighted"], false],
                ["boolean", ["feature-state", "hovered"], false]], 1, 0.67],
            4, ["case", ["any",
                ["boolean", ["feature-state", "highlighted"], false],
                ["boolean", ["feature-state", "hovered"], false]], 1, 1]
          ]
        }
      }, beforeId);

      // Price outliers: 47 ZIPs nationally, so this is cheap at any zoom and is
      // built once rather than per view. Above the borders, below the labels.
      map.addLayer({
        id: OUTLIER_LAYER,
        type: "circle",
        source: OUTLIER_SOURCE,
        layout: { visibility: "none" },
        paint: {
          "circle-color": outlierColorExpression() as never,
          "circle-radius": [
            "interpolate", ["linear"], ["zoom"], 3, 4, 7, 6, 12, 9,
          ] as never,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5,
          "circle-opacity": 0.95,
        },
      });

      // One label per ZIP at its inner point. Overlap stays off to declutter dense metros.
      map.addLayer({
        id: "zips-labels",
        type: "symbol",
        source: LABEL_SOURCE,
        minzoom: LABEL_MIN_ZOOM,
        layout: {
          "text-field": ["get", "zip"],
          "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 9, 10, 12, 14],
          "text-allow-overlap": false,
          "text-padding": 8,
        },
        paint: {
          "text-color": "#1E40AF",
          "text-halo-color": "rgba(255,255,255,0.95)",
          "text-halo-width": 1.5,
        },
      });


      map.once("idle", () => {
        mark("map:firstTiles");
      });

      // Proactively set loaded when source is added
      setPmtilesLoaded(true);
      setupMapInteractions();

    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : "Failed to load PMTiles";
      console.error("Add PMTiles layer failed", err);
      trackError("pmtiles_layer_failed", errMsg);
      setError("Failed to load map data. Try refreshing.");
    }
  }, [isMapReady, setupMapInteractions]);

  // 5. Paint the choropleth: feature-state only; the paint expression is constant.
  useEffect(() => {
    if (!isMapReady || !pmtilesLoaded || !classSource) return;
    const painter = painterRef.current;
    if (!painter) return;
    painter.schedule(classSource);
  }, [isMapReady, pmtilesLoaded, classSource]);

  // Metric-switch timing, end to end, so the headline number is measured by the
  // page rather than asserted.
  const firstMetricRef = useRef<string | null>(null);
  useEffect(() => {
    if (firstMetricRef.current === null) {
      firstMetricRef.current = selectedMetric;
      return;
    }
    if (firstMetricRef.current === selectedMetric) return;
    firstMetricRef.current = selectedMetric;
    mark("map:metricSwitch:start");
    const id = requestAnimationFrame(() =>
      requestAnimationFrame(() => measure("map:metricSwitch", "map:metricSwitch:start", {
        metric: selectedMetric,
      })),
    );
    return () => cancelAnimationFrame(id);
  }, [selectedMetric]);

  // 5b. Price outliers: 47 ZIPs, built once from the snapshot; the toggle flips visibility.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapReady || !store) return;
    const src = map.getSource(OUTLIER_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    const { lng, lat } = store.anchors();
    const features: PointFC["features"] = [];
    for (let row = 0; row < store.n; row++) {
      const cls = store.valueAt("lisa", row);
      if ((cls !== 3 && cls !== 4) || Number.isNaN(lng[row]) || Number.isNaN(lat[row])) continue;
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lng[row], lat[row]] },
        properties: { zip: store.zips[row], cls },
      });
    }
    src.setData({ type: "FeatureCollection", features });
  }, [isMapReady, store]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapReady || !map.getLayer(OUTLIER_LAYER)) return;
    map.setLayoutProperty(OUTLIER_LAYER, "visibility", showLisa ? "visible" : "none");
  }, [isMapReady, showLisa]);

  // 5c. ZIP number labels, refreshed on view change above LABEL_MIN_ZOOM. Filters
  // on the anchor point (where the label is drawn), not the bbox, so it does not
  // depend on the bbox columns passing their scale check.
  const labelBuild = useCallback(() => {
    const map = mapRef.current;
    const s = propsRef.current.store;
    if (!map || !s) return;
    const src = map.getSource(LABEL_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    if (map.getZoom() < LABEL_MIN_ZOOM) {
      if (labelCountRef.current !== 0) {
        src.setData(EMPTY_FC);
        labelCountRef.current = 0;
      }
      return;
    }

    const b = map.getBounds();
    const west = b.getWest() - LABEL_MARGIN_DEG;
    const east = b.getEast() + LABEL_MARGIN_DEG;
    const south = b.getSouth() - LABEL_MARGIN_DEG;
    const north = b.getNorth() + LABEL_MARGIN_DEG;

    const anchors = s.anchors();
    const features: PointFC["features"] = [];
    for (let row = 0; row < s.n; row++) {
      // NaN (no anchor) fails both comparisons.
      const lng = anchors.lng[row];
      if (!(lng >= west && lng <= east)) continue;
      const lat = anchors.lat[row];
      if (!(lat >= south && lat <= north)) continue;
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lng, lat] },
        properties: { zip: s.zips[row] },
      });
    }
    src.setData({ type: "FeatureCollection", features });
    labelCountRef.current = features.length;
  }, []);

  const labelBuildRef = useRef(labelBuild);
  useEffect(() => { labelBuildRef.current = labelBuild; }, [labelBuild]);
  // The snapshot can land after the first moveend, so build once when it does.
  useEffect(() => { if (isMapReady && store) labelBuild(); }, [isMapReady, store, labelBuild]);

  // 6. Fly to Search and Highlight ZIP
  useEffect(() => {
    if (!isMapReady || !mapRef.current || !pmtilesLoaded) return;
    if (!searchZip) return;
    const target = store?.get(searchZip);
    if (!target) return;

    const map = mapRef.current;
    if (!map || !map.isStyleLoaded() || !map.getSource("zips") || !map.getLayer("zips-border")) return;
    const { longitude, latitude } = target;

    // Clear previous highlight
    if (highlightedZipRef.current && highlightedZipRef.current !== searchZip) {
      map.setFeatureState(
        { source: "zips", sourceLayer: "us_zip_codes", id: highlightedZipRef.current },
        { highlighted: false }
      );
    }

    // Set new highlight
    map.setFeatureState(
      { source: "zips", sourceLayer: "us_zip_codes", id: searchZip },
      { highlighted: true }
    );
    highlightedZipRef.current = searchZip;

    if (longitude && latitude) {
      map.flyTo({ center: [longitude, latitude], zoom: 10, duration: 1500 });
    }
  }, [isMapReady, pmtilesLoaded, searchZip, searchTrigger, store]);


  const handleResetBounds = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const container = mapContainer.current;
    const padding = container ? getDynamicPadding(container) : 40;
    map.fitBounds(DEFAULT_BOUNDS, { padding, duration: 1000 });

    // Clear any highlighted zip
    if (highlightedZipRef.current) {
      map.setFeatureState(
        { source: "zips", sourceLayer: "us_zip_codes", id: highlightedZipRef.current },
        { highlighted: false }
      );
      highlightedZipRef.current = null;
    }
  }, []);

  return (
    <div className="absolute inset-0 w-full h-full min-h-[400px]">
      <div 
        ref={mapContainer} 
        className="w-full h-full" 
        style={{ minHeight: "400px" }}
        role="application"
        aria-label="Interactive U.S. housing market choropleth map"
      >
        <span className="sr-only">
          Interactive map showing ZIP-code level housing data. Use the search box to find specific ZIP codes.
        </span>
      </div>
      {/* Reset to default bounds button */}
      {isMapReady && !error && (
        <button
          onClick={() => {
            handleResetBounds();
            const params = new URLSearchParams(window.location.search);
            params.delete('lat');
            params.delete('lng');
            params.delete('zoom');
            const query = params.toString();
            window.history.replaceState(
              {},
              document.title,
              query ? `${window.location.pathname}?${query}` : window.location.pathname
            );
          }}
          style={{
            position: 'absolute',
            top: 10 + 89 + 2 + 'px',
            right: '10px',
            zIndex: 2,
            width: '29px',
            height: '29px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#fff',
            border: 'none',
            borderRadius: '4px',
            boxShadow: '0 0 0 2px rgba(0,0,0,0.1)',
            cursor: 'pointer',
            padding: 0,
          }}
          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f2f2f2'}
          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#fff'}
          aria-label="Reset map to default view"
          title="Reset to default view"
        >
          <Fullscreen style={{ width: '18px', height: '18px', color: '#333' }} />
        </button>
      )}
      {/* Only blocks the view while there is nothing to look at. `isLoading` also
          goes true for the background full-data refresh, which previously threw
          this overlay back over an already-working map mid-session. */}
      {((isLoading && !hasData) || !isMapReady || error) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white/80 z-10">
          {error ? (
            <div className="text-red-500 font-bold px-6 text-center">{error}</div>
          ) : (
            <>
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
              {/* Always captioned. `phase` only exists once the snapshot worker
                  starts reporting, so the wait on the map style, which is the
                  first and longest one on a cold load, used to be a bare spinner
                  on a white screen with nothing saying what it was for. */}
              <div className="w-56 flex flex-col items-center gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  {/* `||`, not `??`: the worker reports an empty phase string
                      before it has a stage to name, and `??` let that through
                      as a blank caption. */}
                  {loadingProgress?.phase || "Loading map…"}
                </span>
                {loadingProgress?.total ? (
                  <>
                    <div
                      className="w-full h-1.5 rounded-full bg-muted overflow-hidden"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={loadingProgress.total}
                      aria-valuenow={loadingProgress.processed ?? 0}
                      aria-label="Loading housing data"
                    >
                      <div
                        className="h-full bg-primary transition-[width] duration-200"
                        style={{
                          width: `${Math.min(100, Math.round(((loadingProgress.processed ?? 0) / loadingProgress.total) * 100))}%`,
                        }}
                      />
                    </div>
                    <span className="text-[10px] tabular-nums text-muted-foreground/80">
                      {(loadingProgress.processed ?? 0).toLocaleString()} of {loadingProgress.total.toLocaleString()} ZIP codes
                    </span>
                  </>
                ) : null}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
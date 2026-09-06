import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import maplibregl, { LngLatBoundsLike, MapMouseEvent, LayerSpecification } from 'maplibre-gl';
import "maplibre-gl/dist/maplibre-gl.css";
import { createMetricPopupContent } from "./map/utils";
import { ZipData } from "./map/types";
import { dataUrl } from "@/lib/data-url";
import { addPMTilesProtocol } from "@/lib/pmtiles-protocol";
import { trackError } from "@/lib/analytics";
import { Fullscreen } from "lucide-react";
import {
  ChoroplethPainter, classOpacityExpression, classPaintExpression, lisaPaintExpression,
  loadedZips,
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
  /** `loaded` is the ZIPs on loaded TILES, which is the correct scope for
   *  painting; the viewport filter that auto-scale needs is applied upstream
   *  against real polygon bounds. */
  onMapMove: (
    loaded: readonly string[],
    bounds: maplibregl.LngLatBounds,
    view?: { lat: number; lng: number; zoom: number }
  ) => void;
  onUserInteraction?: () => void;
  /** Show the spatial-cluster overlay. Off by default: it is a second reading of
   *  the same map and it only means anything over the rankable set. */
  showLisa?: boolean;
  initialCenter?: [number, number];
  initialZoom?: number;
}

const MAP_RELOAD_DELAY_MS = 800;
const RELOAD_ATTEMPTS_KEY = "domapus:map-reload-attempts";
const MAX_RELOAD_ATTEMPTS = 2;

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
  const containerSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reloadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userInteractionNotifiedRef = useRef(false);
  const initialViewRef = useRef({ center: initialCenter, zoom: initialZoom });

  const getDynamicPadding = useCallback((container: HTMLDivElement) => {
    const minDim = Math.min(container.clientWidth, container.clientHeight);
    return Math.min(minDim * 0.12, 100);
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
    const defaultBounds: LngLatBoundsLike = [[-124.7844079, 24.7433195], [-66.9513812, 49.3457868]];
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
      minZoom: 3,
      maxZoom: 12,
      ...(hasInitialView
        ? { center: view.center!, zoom: view.zoom! }
        : { bounds: defaultBounds, fitBoundsOptions: { padding: dynamicPadding } }),
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
        loadedZips(map),
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

      // Retry initialisation, not just resizing. `tryInit` gives up when the
      // container measures 0x0, which happens whenever layout has not settled by
      // the time this effect runs — and the ResizeObserver used to be no help,
      // because it returned here on `!mapRef.current` and only ever resized a map
      // that already existed. The result was a permanently blank map with no
      // error anywhere: no canvas, no style request, no failed fetch to find.
      // Whether it reproduced came down to layout timing, which is why it looked
      // intermittent.
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
            return;
          }

          const props = features[0].properties ?? {};
          const zipCode = (props.ZCTA5CE20 || props.zipCode || props.id) as string;
          const { store: currentStore, selectedMetric: currentMetric } = propsRef.current;
          // One object per hover, materialised on demand — not 33,771 at load.
          const row = zipCode ? currentStore?.get(zipCode) : null;

          if (!row) {
            popupRef.current?.remove();
            return;
          }

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
      const features = map.queryRenderedFeatures(e.point, { layers: [layerId] });

      if (!features.length) return;

      const props = features[0].properties ?? {};
      const zipCode = (props.ZCTA5CE20 || props.zipCode || props.id) as string;
      const { store: currentStore, onZipSelect: currentOnSelect } = propsRef.current;
      const row = zipCode ? currentStore?.get(zipCode) : null;
      if (row) currentOnSelect(row);
    };

    const mouseoutHandler = () => {
      map.getCanvas().style.cursor = "";
      popupRef.current?.remove();
    };

    const moveEndHandler = () => {
      const center = map.getCenter();
      onMapMoveRef.current(
        loadedZips(map),
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

      // LISA overlay, above the fill and below the borders. Hidden until the
      // user asks for it; the toggle moves `fill-opacity` between two literals,
      // which is not a data-driven value and so costs no source reload.
      map.addLayer({
        id: "zips-lisa",
        type: "fill",
        source: "zips",
        "source-layer": "us_zip_codes",
        paint: {
          "fill-color": lisaPaintExpression() as never,
          "fill-opacity": 0,
        },
      }, beforeId);

      painterRef.current = new ChoroplethPainter(map);
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
          "line-color": [
            "case",
            ["boolean", ["feature-state", "highlighted"], false],
            "#ff6b35",
            "rgba(0,0,0,0.15)"
          ],
          "line-width": [
            "interpolate", ["linear"], ["zoom"],
            3, ["case", ["boolean", ["feature-state", "highlighted"], false], 2, 0.3],
            6, ["case", ["boolean", ["feature-state", "highlighted"], false], 3, 0.6],
            10, ["case", ["boolean", ["feature-state", "highlighted"], false], 4, 1.5],
            12, ["case", ["boolean", ["feature-state", "highlighted"], false], 5, 2]
          ]
        }
      }, beforeId);

      // ZIP labels layer - visible at high zoom
      map.addLayer({
        id: "zips-labels",
        type: "symbol",
        source: "zips",
        "source-layer": "us_zip_codes",
        minzoom: 9.5,
        layout: {
          "visibility": "visible",
          "text-field": ["get", "ZCTA5CE20"],
          "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
          "text-size": [
            "interpolate", ["linear"], ["zoom"],
            9, 10,
            12, 14
          ],
          "text-allow-overlap": false,
          "text-padding": 8,
          "symbol-placement": "point",
          "symbol-sort-key": ["to-number", ["get", "ZCTA5CE20"]],
          // Deterministic stacking so the winning duplicate doesn't jitter on pan.
          "symbol-z-order": "auto",
          "text-ignore-placement": false,
          "symbol-avoid-edges": true
        },
        paint: {
          "text-color": "#1E40AF",
          "text-halo-color": "rgba(255,255,255,0.95)",
          "text-halo-width": 1.5
        }
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

  // 5. Paint the choropleth.
  //
  // This effect used to call `map.setPaintProperty("zips-fill", "fill-color",
  // <step expression>)` on every metric change and, in auto-scale mode, on every
  // moveend. In maplibre-gl that marks the source 'reload': every loaded tile is
  // re-sent to the worker, re-parsed from its cached PBF, its fill bucket
  // rebuilt and its GPU buffers re-uploaded. Measured cost of one metric switch:
  // 3375 ms at 4x CPU on slow 4G.
  //
  // Now the paint expression is a CONSTANT set once at addLayer, and only
  // feature-state changes. setFeatureState does not trigger a relayout.
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

  // 5b. LISA overlay.
  //
  // The `lisa` feature-state is written LAZILY — once, the first time the overlay
  // is switched on — rather than alongside the class writes. It comes from the
  // snapshot rather than the paint table, so it is not available at first paint
  // anyway, and most sessions never open the overlay; paying 33,771 writes for a
  // layer at zero opacity would be work for nothing. Once written it stays, and
  // MapLibre re-applies it to every tile that loads or is revived from cache.
  const lisaWrittenRef = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapReady || !map.getLayer("zips-lisa")) return;

    if (showLisa && store && !lisaWrittenRef.current) {
      const col = store.col("lisa");
      if (col) {
        for (let row = 0; row < store.n; row++) {
          const v = store.valueAt("lisa", row);
          if (v === null) continue;
          map.setFeatureState(
            { source: "zips", sourceLayer: "us_zip_codes", id: store.zips[row] },
            { lisa: v },
          );
        }
        lisaWrittenRef.current = true;
      }
    }

    // `fill-opacity` between two literals. A literal is not a data-driven value,
    // so this is the one setPaintProperty in the file that does NOT mark the
    // source for reload.
    map.setPaintProperty("zips-lisa", "fill-opacity", showLisa ? 0.75 : 0);
  }, [isMapReady, showLisa, store]);

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
    const defaultBounds: LngLatBoundsLike = [[-124.7844079, 24.7433195], [-66.9513812, 49.3457868]];
    const container = mapContainer.current;
    const padding = container ? getDynamicPadding(container) : 40;
    map.fitBounds(defaultBounds, { padding, duration: 1000 });

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
              {loadingProgress?.phase && (
                <div className="w-56 flex flex-col items-center gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    {loadingProgress.phase}
                  </span>
                  {loadingProgress.total ? (
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
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
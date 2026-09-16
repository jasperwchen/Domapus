import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import type * as maplibregl from "maplibre-gl";
import { useDataWorker } from "@/hooks/useDataWorker";
import { ZipData } from "./map/types";
import { MapExport } from "@/components/MapExport";
import { dataUrl } from "@/lib/data-url";
import {
  PaintTableSource,
  ViewportClassSource,
  visibleZipRows,
  type ClassSource,
} from "@/lib/class-source";
import { CHOROPLETH_COLORS } from "@/lib/choropleth";
import { boot, takeSnapshotPrefetch, fetchManifest, fetchPaint, outlierCount, type Manifest } from "@/lib/manifest";
import { PaintTable } from "@/lib/paint-table";
import { ZipTable } from "@/lib/zip-table";
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "@/hooks/use-toast";
import { TopBar } from "./TopBar";
import { MapLibreMap } from "./MapLibreMap";
import { Legend } from "./Legend";
import { SponsorBanner } from "./SponsorBanner";
import { Sidebar } from "./Sidebar";
import { MetricType } from "./MetricSelector";
import { useUrlState } from "@/hooks/useUrlState";
import { MobileBottomSheet } from "./MobileBottomSheet";

function getInitialUrlParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    zip: params.get('zip') || undefined,
    metric: params.get('metric') || undefined,
    lat: params.get('lat') ? parseFloat(params.get('lat')!) : undefined,
    lng: params.get('lng') ? parseFloat(params.get('lng')!) : undefined,
    zoom: params.get('zoom') ? parseFloat(params.get('zoom')!) : undefined,
  };
}

const initialUrlParams = getInitialUrlParams();

export function HousingDashboard() {
  const isMobile = useIsMobile();
  const { setUrlState } = useUrlState();
  const initialUrlStateRef = useRef(initialUrlParams);

  const [selectedMetric, setSelectedMetric] = useState<MetricType>((initialUrlStateRef.current.metric as MetricType) || "zhvi");
  const [selectedZip, setSelectedZip] = useState<ZipData | null>(null);
  // Compare mode lives here, not in `Sidebar`: a map click in compare mode must set the
  // comparison ZIP rather than replace the primary one, and closing the panel must reset it.
  const [mode, setMode] = useState<"detail" | "compare">("detail");
  const [compareZip, setCompareZip] = useState<ZipData | null>(null);
  const [searchZip, setSearchZip] = useState<string>(initialUrlStateRef.current.zip || "");
  const [searchTrigger, setSearchTrigger] = useState<number>(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showSponsorBanner, setShowSponsorBanner] = useState(false);
  const [isExportMode, setIsExportMode] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [autoScale, setAutoScale] = useState(false);
  const [showLisa, setShowLisa] = useState(false);

  // Two independent artifacts, and the whole point is that they arrive
  // independently. The paint table colours the map; the snapshot backs hover,
  // search, the sidebar and export. Nothing waits for the snapshot to paint.
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [paint, setPaint] = useState<PaintTable | null>(null);
  const [store, setStore] = useState<ZipTable | null>(null);
  const [visibleRows, setVisibleRows] = useState<Int32Array | null>(null);

  const lastBoundsRef = useRef<maplibregl.LngLatBounds | null>(null);
  const lastLoadedRef = useRef<(() => readonly string[]) | null>(null);
  const initialLoadRef = useRef(false);
  const hasUserInteractedRef = useRef(false);

  const { processData, isLoading, progress } = useDataWorker();

  // --- The paint path: manifest + one 100,000-byte table ---------------------
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        // index.html started both fetches in one tick before the bundle parsed.
        const booted = await boot();
        const mf = booted?.manifest ?? (await fetchManifest());
        if (!alive) return;
        setManifest(mf);

        const buf =
          booted && booted.metric === selectedMetric
            ? booted.paint
            : await fetchPaint(mf, selectedMetric);
        if (!alive) return;

        // Refuses to paint rather than painting a lie: a wrong byteLength or a
        // class count the ramp cannot render means the legend and the map would
        // disagree about what a colour means.
        setPaint(PaintTable.from(buf, selectedMetric, mf.classes, CHOROPLETH_COLORS.length));
      } catch (err) {
        console.error("[HousingDashboard] paint table failed:", err);
        if (alive) {
          setLoadError(
            err instanceof Error && err.message
              ? err.message
              : "Could not load the map colours. Check your connection and try again.",
          );
        }
      }
    })();

    return () => { alive = false; };
  }, [selectedMetric]);

  // --- The interaction path: the snapshot, off the critical path -------------
  useEffect(() => {
    let alive = true;

    (async () => {
      const url = dataUrl("zip-data.json");
      // Once only: the buffer is transferred below and this component remounts
      // on browser Back out of the methodology route. See takeSnapshotPrefetch.
      const early: ArrayBuffer | null = await takeSnapshotPrefetch();

      try {
        const result = await processData(
          { type: "LOAD_SNAPSHOT", data: { url, prefetchedBuffer: early ?? undefined } },
          { transfer: early ? [early] : [] },
        );
        if (!alive) return;
        setStore(ZipTable.from(result.header, result.buffers));
      } catch (error: unknown) {
        console.error("[HousingDashboard] Failed to load housing data:", error);
        // A failed snapshot degrades hover and search; it does NOT blank the map,
        // because the paint table is what colours it. Only surface a full-page
        // error if the paint path also failed.
        if (alive) {
          setLoadError((prev) => prev ?? (
            error instanceof Error && error.message
              ? error.message
              : "Could not load ZIP details. The map still works; try refreshing."
          ));
        }
      }
    })();

    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A map click in compare mode means "compare against this one", not "switch to
  // this one". The URL keeps naming the primary ZIP: it is what the panel is
  // about, and a shared link should reopen on it.
  const handleZipSelect = useCallback((zip: ZipData) => {
    hasUserInteractedRef.current = true;
    setSidebarOpen(true);
    if (mode === "compare" && zip.zipCode !== selectedZip?.zipCode) {
      setCompareZip(zip);
      return;
    }
    setSelectedZip(zip);
    setUrlState({ zip: zip.zipCode, metric: selectedMetric });
  }, [mode, selectedZip, selectedMetric, setUrlState]);

  const handleSearch = useCallback((zip: string, trigger: number) => {
    setSearchZip(zip);
    setSearchTrigger(trigger);
    hasUserInteractedRef.current = true;
    setUrlState({ zip, metric: selectedMetric });

    // Search selects like a map click, obeying the same compare-mode rule.
    const row = store?.get(zip);
    if (row) {
      handleZipSelect(row);
      return;
    }

    // A miss was silent, which reads as a broken search box rather than as an
    // answer. The two cases are different and the reader can act on both.
    toast(
      store
        ? {
            title: `No data for ZIP ${zip}`,
            description:
              "Check the code, or try a nearby one. Not every ZIP code has a housing market either source reports on.",
          }
        : {
            title: "Still loading ZIP details",
            description: "The map is ready but the data behind it is not. Try again in a moment.",
          },
    );
  }, [selectedMetric, setUrlState, store, handleZipSelect]);

  // Closing the panel ends compare mode. The next ZIP the user clicks opens on
  // its details, which is what closing a panel means everywhere else.
  const handleSidebarClose = useCallback(() => {
    setSidebarOpen(false);
    setMode("detail");
    setCompareZip(null);
  }, []);

  const handleModeChange = useCallback((next: "detail" | "compare") => {
    setMode(next);
    if (next === "detail") setCompareZip(null);
  }, []);

  const handleMetricChange = useCallback((metric: MetricType) => {
    setSelectedMetric(metric);
    hasUserInteractedRef.current = true;
    setUrlState({ metric, zip: selectedZip?.zipCode });
  }, [selectedZip, setUrlState]);

  const autoScaleRef = useRef(autoScale);
  useEffect(() => { autoScaleRef.current = autoScale; }, [autoScale]);

  // Auto-load ZIP from URL once the snapshot exists.
  useEffect(() => {
    const initialZip = initialUrlStateRef.current.zip;
    if (!initialLoadRef.current && store && initialZip) {
      initialLoadRef.current = true;
      const row = store.get(initialZip);
      if (row) {
        setSelectedZip(row);
        setSidebarOpen(true);
        setSearchZip(initialZip);
        setSearchTrigger(prev => prev + 1);
      }
    }
  }, [store]);

  // Viewport rows from real polygon bounds; a flat scan (~0.1 ms), no index.
  const recomputeVisible = useCallback((
    loaded: () => readonly string[], bounds: maplibregl.LngLatBounds | null,
  ) => {
    if (!autoScaleRef.current || !store || !bounds) {
      setVisibleRows(null);
      return;
    }
    // `loaded()` queries every loaded tile, so only the auto-scale path calls it.
    setVisibleRows(visibleZipRows(loaded(), store, bounds));
  }, [store]);

  const handleMapMove = useCallback((
    loaded: () => readonly string[],
    bounds: maplibregl.LngLatBounds,
    view?: { lat: number; lng: number; zoom: number },
  ) => {
    lastBoundsRef.current = bounds;
    lastLoadedRef.current = loaded;
    recomputeVisible(loaded, bounds);

    if (!hasUserInteractedRef.current) return;
    if (view) {
      setUrlState({ lat: view.lat, lng: view.lng, zoom: view.zoom }, true);
      return;
    }
    setUrlState({
      lat: (bounds.getSouth() + bounds.getNorth()) / 2,
      lng: (bounds.getWest() + bounds.getEast()) / 2,
      zoom: Math.log2(360 / Math.abs(bounds.getEast() - bounds.getWest())),
    }, true);
  }, [recomputeVisible, setUrlState]);

  const handleUserInteraction = useCallback(() => {
    hasUserInteractedRef.current = true;
  }, []);

  // Toggling on re-reads the last move's tiles and bounds instead of waiting for a pan.
  useEffect(() => {
    if (!autoScale) {
      setVisibleRows(null);
      return;
    }
    const loaded = lastLoadedRef.current;
    const bounds = lastBoundsRef.current;
    if (loaded && bounds) recomputeVisible(loaded, bounds);
  }, [autoScale, selectedMetric, recomputeVisible]);

  // EXACTLY ONE class authority is live at a time. Constructing a source bumps
  // its epoch; the painter sees a new epoch and rewrites the full ZIP set, so the
  // two modes can never overlap or leave stale colours behind.
  const classSource: ClassSource | null = useMemo(() => {
    if (!paint) return null;
    const spec = manifest?.classing?.[selectedMetric];
    const breaks = spec?.breaks;

    if (autoScale && store && visibleRows && visibleRows.length > 0) {
      // The scheme and the break gate travel with the breaks. Auto-scale re-cuts
      // the pipeline's own scheme on a smaller sample; it never picks its own.
      return new ViewportClassSource(store, paint, selectedMetric, visibleRows, spec ?? {});
    }
    // The paint table can answer for every ZIP it has a byte for, which is the
    // full national set — it does not need the snapshot to have arrived.
    return new PaintTableSource(
      paint, breaks, store ? store.zips : paint.zips(), selectedMetric,
    );
  }, [paint, manifest, store, selectedMetric, autoScale, visibleRows]);

  // Only a failure of BOTH paths is fatal. A dead snapshot with a live paint
  // table still shows the map.
  if (loadError && !paint) {
    return (
      <div className="w-full h-screen-safe bg-dashboard-bg flex items-center justify-center">
        <div className="bg-card p-8 rounded-lg shadow-lg max-w-md text-center">
          <h2 className="text-xl font-bold text-foreground mb-2">Unable to Load Data</h2>
          <p className="text-muted-foreground mb-4">{loadError}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-screen-safe bg-dashboard-bg overflow-hidden flex flex-col">
      <a
        href="#main-map"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[9999] focus:bg-primary focus:text-primary-foreground focus:px-4 focus:py-2 focus:rounded-md"
      >
        Skip to map
      </a>

      {showSponsorBanner && <SponsorBanner onClose={() => setShowSponsorBanner(false)} />}
      <TopBar
        selectedMetric={selectedMetric}
        onMetricChange={handleMetricChange}
        onSearch={handleSearch}
        hideMobileControls={isMobile && (sidebarOpen || isExportMode)}
      >
        <MapExport
          store={store}
          selectedMetric={selectedMetric}
          // Published national breaks, not the viewport cut, so exports are comparable.
          breaks={manifest?.classing?.[selectedMetric]?.breaks ?? null}
          onExportModeChange={setIsExportMode}
        />
      </TopBar>
      <div className="flex flex-1 relative min-h-[400px] overflow-hidden">
        {isMobile && (
          <MobileBottomSheet isOpen={sidebarOpen} onClose={handleSidebarClose}>
            <Sidebar
              isOpen={sidebarOpen}
              zipData={selectedZip}
              store={store}
              onClose={handleSidebarClose}
              selectedMetric={selectedMetric}
              mode={mode}
              onModeChange={handleModeChange}
              compareZip={compareZip}
              onCompareZipChange={setCompareZip}
            />
          </MobileBottomSheet>
        )}

        <div className="hidden md:flex absolute top-0 bottom-0 left-0 z-20 flex-col">
          <Sidebar
            isOpen={sidebarOpen}
            onClose={handleSidebarClose}
            zipData={selectedZip}
            store={store}
            selectedMetric={selectedMetric}
            mode={mode}
            onModeChange={handleModeChange}
            compareZip={compareZip}
            onCompareZipChange={setCompareZip}
          />
        </div>
        <div className="flex-1 relative">
          <div id="main-map" className="absolute inset-0 min-h-[400px]">
            <MapLibreMap
              selectedMetric={selectedMetric}
              onZipSelect={handleZipSelect}
              searchZip={searchZip}
              searchTrigger={searchTrigger}
              store={store}
              isLoading={isLoading}
              loadingProgress={progress}
              classSource={classSource}
              onMapMove={handleMapMove}
              onUserInteraction={handleUserInteraction}
              showLisa={showLisa}
              initialCenter={initialUrlStateRef.current.lng !== undefined && initialUrlStateRef.current.lat !== undefined ? [initialUrlStateRef.current.lng, initialUrlStateRef.current.lat] : undefined}
              initialZoom={initialUrlStateRef.current.zoom}
            />
          </div>
          {!isExportMode && !(isMobile && sidebarOpen) && (
            <div className={`absolute ${isMobile ? 'top-4 left-4' : 'bottom-4 right-4'} ${isMobile ? 'w-auto' : 'w-64'} z-[10] pointer-events-auto`}>
              <Legend
                selectedMetric={selectedMetric}
                breaks={classSource?.breaks ?? null}
                autoScale={autoScale}
                onAutoScaleChange={setAutoScale}
                showLisa={showLisa}
                onShowLisaChange={store ? setShowLisa : undefined}
                reliability={manifest ? {
                  rankableShare: manifest.noise.rankable_zips / manifest.noise.reporting_zips,
                  impliedN: manifest.noise.rankable_n_implied,
                } : null}
                outliers={outlierCount(manifest) !== null
                  ? { total: outlierCount(manifest)! }
                  : null}
                // Counts describe the published breaks, so withhold them under auto-scale.
                classCounts={
                  autoScale ? null : manifest?.classing?.[selectedMetric]?.class_counts ?? null
                }
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

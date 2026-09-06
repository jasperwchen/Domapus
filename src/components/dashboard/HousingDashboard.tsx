import { useState, useCallback, useEffect, useMemo, useRef } from "react";
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
import { boot, fetchManifest, fetchPaint, type Manifest } from "@/lib/manifest";
import { PaintTable } from "@/lib/paint-table";
import { ZipTable, WIRE_OF } from "@/lib/zip-table";
import { useIsMobile } from "@/hooks/use-mobile";
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
      const early: ArrayBuffer | null = await ((window as unknown as Record<string, unknown>)
        .__zipDataPromise as Promise<ArrayBuffer | null> | undefined ?? Promise.resolve(null));

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

  const handleSearch = useCallback((zip: string, trigger: number) => {
    setSearchZip(zip);
    setSearchTrigger(trigger);
    hasUserInteractedRef.current = true;
    setUrlState({ zip, metric: selectedMetric });
  }, [selectedMetric, setUrlState]);

  const handleZipSelect = useCallback((zip: ZipData) => {
    setSelectedZip(zip);
    setSidebarOpen(true);
    hasUserInteractedRef.current = true;
    setUrlState({ zip: zip.zipCode, metric: selectedMetric });
  }, [selectedMetric, setUrlState]);

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

  // The viewport set, from REAL polygon bounds. There is no index to build and
  // no `isIndexReady` gate: `visibleZipRows` is a flat scan of four comparisons
  // over the loaded ZIPs, ~0.1 ms at this size, so it just runs. The old
  // R-tree-plus-readiness-flag machinery existed to amortise a cost that was
  // never there, and three effects used to wait on that flag.
  const recomputeVisible = useCallback((
    loaded: readonly string[], bounds: maplibregl.LngLatBounds | null,
  ) => {
    if (!autoScaleRef.current || !store || !bounds) {
      setVisibleRows(null);
      return;
    }
    setVisibleRows(visibleZipRows(loaded, store, bounds));
  }, [store]);

  const handleMapMove = useCallback((
    loaded: readonly string[],
    bounds: maplibregl.LngLatBounds,
    view?: { lat: number; lng: number; zoom: number },
  ) => {
    lastBoundsRef.current = bounds;
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

  // Turning auto-scale off drops the viewport sample immediately; turning it on
  // waits for the next map move to supply one.
  useEffect(() => {
    if (!autoScale) setVisibleRows(null);
  }, [autoScale, selectedMetric]);

  // EXACTLY ONE class authority is live at a time. Constructing a source bumps
  // its epoch; the painter sees a new epoch and rewrites the full ZIP set, so the
  // two modes can never overlap or leave stale colours behind.
  const classSource: ClassSource | null = useMemo(() => {
    if (!paint) return null;
    const breaks = manifest?.classing?.[selectedMetric]?.breaks;

    if (autoScale && store && visibleRows && visibleRows.length > 0) {
      return new ViewportClassSource(store, paint, selectedMetric, visibleRows);
    }
    // The paint table can answer for every ZIP it has a byte for, which is the
    // full national set — it does not need the snapshot to have arrived.
    return new PaintTableSource(
      paint, breaks, store ? store.zips : paint.zips(), selectedMetric,
    );
  }, [paint, manifest, store, selectedMetric, autoScale, visibleRows]);

  const legendValues = useMemo(() => {
    if (!store) return [];
    const wire = WIRE_OF[selectedMetric] ?? selectedMetric;
    const out: number[] = [];
    if (visibleRows && visibleRows.length > 0) {
      for (let i = 0; i < visibleRows.length; i++) {
        const v = store.valueAt(wire, visibleRows[i]);
        if (v !== null && v > 0) out.push(v);
      }
      return out;
    }
    const col = store.col(wire);
    if (!col) return out;
    for (let row = 0; row < store.n; row++) {
      const v = store.valueAt(wire, row);
      if (v !== null && v > 0) out.push(v);
    }
    return out;
  }, [visibleRows, store, selectedMetric]);

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
          onExportModeChange={setIsExportMode}
        />
      </TopBar>
      <div className="flex flex-1 relative min-h-[400px] overflow-hidden">
        {isMobile && (
          <MobileBottomSheet isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)}>
            <Sidebar
              isOpen={sidebarOpen}
              zipData={selectedZip}
              store={store}
              onClose={() => setSidebarOpen(false)}
            />
          </MobileBottomSheet>
        )}

        <div className="hidden md:flex absolute top-0 bottom-0 left-0 z-20 flex-col">
          <Sidebar
            isOpen={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            zipData={selectedZip}
            store={store}
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
                metricValues={legendValues}
                breaks={classSource?.breaks ?? null}
                autoScale={autoScale}
                onAutoScaleChange={setAutoScale}
                showLisa={showLisa}
                onShowLisaChange={store ? setShowLisa : undefined}
                reliability={manifest ? {
                  rankableShare: manifest.noise.rankable_zips / manifest.noise.reporting_zips,
                  impliedN: manifest.noise.rankable_n_implied,
                } : null}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

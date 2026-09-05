import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useDataWorker } from "@/hooks/useDataWorker";
import { ZipData } from "./map/types";
import { MapExport } from "@/components/MapExport";
import { dataUrl } from "@/lib/data-url";
import { buildSpatialIndex, queryZipsInBounds } from "@/lib/spatial-index";
import { getMetricValue } from "./map/utils";
import { LegacyClassSource, ViewportClassSource, type ClassSource } from "@/lib/class-source";
import { useIsMobile } from "@/hooks/use-mobile";
import { TopBar } from "./TopBar";
import { MapLibreMap } from "./MapLibreMap";
import { Legend } from "./Legend";
import { SponsorBanner } from "./SponsorBanner";
import { Sidebar } from "./Sidebar";
import { MetricType } from "./MetricSelector";
import { useUrlState } from "@/hooks/useUrlState";
import { MobileBottomSheet } from "./MobileBottomSheet";


interface DataPayload {
  last_updated_utc: string;
  zip_codes: Record<string, ZipData>;
  bounds: { min: number; max: number; };
}

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
  
  // Initialize selectedMetric from URL or default to 'zhvi'
  const [selectedMetric, setSelectedMetric] = useState<MetricType>((initialUrlStateRef.current.metric as MetricType) || "zhvi");
  const [selectedZip, setSelectedZip] = useState<ZipData | null>(null);
  const [searchZip, setSearchZip] = useState<string>(initialUrlStateRef.current.zip || "");
  const [searchTrigger, setSearchTrigger] = useState<number>(0);
  const [zipData, setZipData] = useState<Record<string, ZipData>>({});
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showSponsorBanner, setShowSponsorBanner] = useState(false);
  const [isExportMode, setIsExportMode] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [visibleZipCodes, setVisibleZipCodes] = useState<string[] | null>(null);
  const [autoScale, setAutoScale] = useState(false);
  const [isIndexReady, setIsIndexReady] = useState(false);
  const lastBoundsRef = useRef<[[number, number], [number, number]] | null>(null);
  const initialLoadRef = useRef(false);
  const hasUserInteractedRef = useRef(false);

  const { processData, isLoading, progress } = useDataWorker();

  useEffect(() => {
    let isMounted = true;
    let hasRun = false;

    const loadInitialData = async () => {
      if (hasRun) return;
      hasRun = true;

      // index.html starts this fetch in <head>, before the bundle parses, so the
      // buffer is usually already in flight by the time we get here.
      const url = dataUrl("zip-data.json");
      const earlyBuffer: ArrayBuffer | null = await ((window as unknown as Record<string, unknown>).__zipDataPromise as Promise<ArrayBuffer | null> | undefined ?? Promise.resolve(null));

      try {
        setLoadError(null);

        const transfer: Transferable[] = earlyBuffer ? [earlyBuffer] : [];
        const result = await processData({
          type: 'LOAD_AND_PROCESS_DATA',
          data: { url, selectedMetric: 'zhvi', prefetchedBuffer: earlyBuffer ?? undefined }
        }, { transfer }) as DataPayload;

        if (!isMounted) return;

        if (result) {
          setZipData(result.zip_codes);

          // Build spatial index during idle time
          const scheduleIndexBuild = () => {
            buildSpatialIndex(result.zip_codes);
            setIsIndexReady(true);
          };

          if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(scheduleIndexBuild, { timeout: 2000 });
          } else {
            setTimeout(scheduleIndexBuild, 100);
          }
        }
      } catch (error: unknown) {
        console.error("[HousingDashboard] Failed to load housing data:", error);
        if (isMounted) {
          setLoadError(
            error instanceof Error && error.message
              ? error.message
              : "Could not load housing data. Check your connection and try again."
          );
        }
      }
    };
    loadInitialData();
    ///const timer = setTimeout(() => setShowSponsorBanner(true), 30000);

    return () => {
      isMounted = false;
      ///clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Search handler - also updates URL
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

  // Update URL when metric changes
  const handleMetricChange = useCallback((metric: MetricType) => {
    setSelectedMetric(metric);
    hasUserInteractedRef.current = true;
    setUrlState({ metric, zip: selectedZip?.zipCode });
  }, [selectedZip, setUrlState]);

  // Use ref to always access latest autoScale state in callbacks
  const autoScaleRef = useRef(autoScale);
  useEffect(() => {
    autoScaleRef.current = autoScale;
  }, [autoScale]);

  // Auto-load ZIP from URL on initial data load
  useEffect(() => {
    const initialZip = initialUrlStateRef.current.zip;
    if (!initialLoadRef.current && Object.keys(zipData).length > 0 && initialZip) {
      initialLoadRef.current = true;
      const zipFromUrl = zipData[initialZip];
      if (zipFromUrl) {
        setSelectedZip(zipFromUrl);
        setSidebarOpen(true);
        setSearchZip(initialZip);
        setSearchTrigger(prev => prev + 1);
      }
    }
  }, [zipData]);

  // Only the visible SET is tracked here now. Classing moved into ClassSource,
  // so there is one authority for "which class is this ZIP in" rather than two
  // that could disagree — the map used to compute its own buckets while the
  // Legend computed different ones from a different sample.
  const updateColors = useCallback((bounds: [[number, number], [number, number]] | null) => {
    if (!autoScaleRef.current) {
      setVisibleZipCodes(null);
      return;
    }
    if (!bounds) return;

    // Still the centroid-box index. It under-counts large ZCTAs (its 0.01-degree
    // box is ~1.1 km against a measured median ZCTA span of 7.45 km); Phase 4
    // replaces it with real polygon bounds from zcta-geom.csv.
    setVisibleZipCodes(queryZipsInBounds({
      west: bounds[0][0], south: bounds[0][1], east: bounds[1][0], north: bounds[1][1],
    }));
  }, []);

  const handleMapMove = useCallback((
    bounds: [[number, number], [number, number]],
    view?: { lat: number; lng: number; zoom: number }
  ) => {
    lastBoundsRef.current = bounds;
    if (autoScaleRef.current) {
      updateColors(bounds);
    }
    
    // Update URL with map position (debounced)
    if (!hasUserInteractedRef.current) return;
    if (view) {
      setUrlState({ lat: view.lat, lng: view.lng, zoom: view.zoom }, true);
      return;
    }

    const fallbackCenter = {
      lng: (bounds[0][0] + bounds[1][0]) / 2,
      lat: (bounds[0][1] + bounds[1][1]) / 2,
    };
    const fallbackZoom = Math.log2(360 / Math.abs(bounds[1][0] - bounds[0][0]));
    setUrlState({ lat: fallbackCenter.lat, lng: fallbackCenter.lng, zoom: fallbackZoom }, true);
  }, [updateColors, setUrlState]);

  const handleUserInteraction = useCallback(() => {
    hasUserInteractedRef.current = true;
  }, []);

  useEffect(() => {
    if (autoScale && lastBoundsRef.current && isIndexReady) {
      updateColors(lastBoundsRef.current);
    } else if (!autoScale) {
      setVisibleZipCodes(null);
    }
  }, [autoScale, isIndexReady, updateColors]);

  useEffect(() => {
    setVisibleZipCodes(null);

    if (autoScale && lastBoundsRef.current) {
      const timer = setTimeout(() => {
        updateColors(lastBoundsRef.current);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [selectedMetric, searchZip, autoScale, updateColors]);

  useEffect(() => {
    if (isIndexReady && autoScale && lastBoundsRef.current) {
      updateColors(lastBoundsRef.current);
    }
  }, [isIndexReady, autoScale, updateColors]);

  useEffect(() => {
    const handleFocus = () => {
      if (document.visibilityState === 'visible' && autoScale && lastBoundsRef.current) {
        updateColors(lastBoundsRef.current);
      }
    };
    document.addEventListener('visibilitychange', handleFocus);
    return () => document.removeEventListener('visibilitychange', handleFocus);
  }, [autoScale, updateColors]);

  // EXACTLY ONE class authority is live at a time. Constructing a source bumps
  // its epoch; the painter sees a new epoch and rewrites the full ZIP set, so
  // the two modes can never overlap or leave stale colours behind.
  //
  // In Phase 4 the fixed-scale branch becomes `PaintTable`, which is one line
  // here — the painter never learns where classes come from.
  const classSource: ClassSource | null = useMemo(() => {
    if (Object.keys(zipData).length === 0) return null;
    if (autoScale && visibleZipCodes && visibleZipCodes.length > 0) {
      return new ViewportClassSource(zipData, selectedMetric, visibleZipCodes);
    }
    return new LegacyClassSource(zipData, selectedMetric);
  }, [zipData, selectedMetric, autoScale, visibleZipCodes]);

  const legendValues = useMemo(() => {
    const source = (visibleZipCodes && visibleZipCodes.length > 0)
      ? visibleZipCodes.map(zip => zipData[zip]).filter(Boolean)
      : Object.values(zipData);
    return source.map(d => getMetricValue(d, selectedMetric)).filter(v => v > 0);
  }, [visibleZipCodes, zipData, selectedMetric]);

  // Show error state if data failed to load
  if (loadError) {
    return (
      <div className="w-full h-screen-safe bg-dashboard-bg flex items-center justify-center">
        <div className="bg-card p-8 rounded-lg shadow-lg max-w-md text-center">
          <div className="text-destructive text-6xl mb-4">⚠️</div>
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
      {/* Skip Navigation Link */}
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
          allZipData={zipData}
          selectedMetric={selectedMetric}
          onExportModeChange={setIsExportMode}
        />
      </TopBar>
      <div className="flex flex-1 relative min-h-[400px] overflow-hidden">
        {/* Mobile Bottom Sheet */}
        {isMobile && (
          <MobileBottomSheet
            isOpen={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
          >
            <Sidebar
              isOpen={sidebarOpen}
              zipData={selectedZip}
              allZipData={zipData}
              onClose={() => setSidebarOpen(false)}
            />
          </MobileBottomSheet>
        )}
        
        {/* Desktop Sidebar */}
        <div className="hidden md:flex absolute top-0 bottom-0 left-0 z-20 flex-col">
          <Sidebar
            isOpen={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            zipData={selectedZip}
            allZipData={zipData}
          />
        </div>
        <div className="flex-1 relative">
          <div id="main-map" className="absolute inset-0 min-h-[400px]">
            <MapLibreMap
              selectedMetric={selectedMetric}
              onZipSelect={handleZipSelect}
              searchZip={searchZip}
              searchTrigger={searchTrigger}
              zipData={zipData}
              isLoading={isLoading}
              loadingProgress={progress}
              classSource={classSource}
              onMapMove={handleMapMove}
              onUserInteraction={handleUserInteraction}
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
                isIndexReady={isIndexReady}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

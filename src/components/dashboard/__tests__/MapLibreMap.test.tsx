import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, fireEvent, screen } from "@testing-library/react";
import { MapLibreMap } from "../MapLibreMap";
import * as maplibregl from "maplibre-gl";
import type { ZipTable } from "@/lib/zip-table";
import type { ZipData } from "../map/types";

// Hoisted so vi.mock (which is hoisted to the top of the module) can access these.
const mocks = vi.hoisted(() => {
  const mockResize = vi.fn();
  const mockTriggerRepaint = vi.fn();
  const mockSetStyle = vi.fn();

  class MockMap {
    static lastInstance: MockMap | null = null;
    /** False models a basemap that never answers: no `load` until a test emits one. */
    static autoLoad = true;
    handlers: Record<string, Array<(payload?: unknown) => void>> = {};
    sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
    layers = new Map<string, { id: string; paint?: Record<string, unknown> }>();
    setFeatureState = vi.fn();
    flyTo = vi.fn();
    fitBounds = vi.fn();
    paintWrites = vi.fn();
    setPaintProperty = this.paintWrites;
    setLayoutProperty = vi.fn();

    constructor(public options: { style?: unknown } = {}) {
      MockMap.lastInstance = this;
      if (MockMap.autoLoad) setTimeout(() => this.emit("load"), 0);
    }

    setStyle(style: unknown, options?: unknown) {
      mockSetStyle(style, options);
    }

    on(event: string, cb: (payload?: unknown) => void) {
      if (!this.handlers[event]) this.handlers[event] = [];
      this.handlers[event].push(cb);
    }

    off(event: string, cb: (payload?: unknown) => void) {
      this.handlers[event] = (this.handlers[event] || []).filter(h => h !== cb);
    }

    once(event: string, cb: (payload?: unknown) => void) {
      const onceHandler = (payload?: unknown) => {
        cb(payload);
        this.handlers[event] = (this.handlers[event] || []).filter((h) => h !== onceHandler);
      };
      this.on(event, onceHandler);
    }

    emit(event: string, payload?: unknown) {
      (this.handlers[event] || []).forEach((cb) => cb(payload));
    }

    addControl() {}
    getCenter() {
      return { lat: 0, lng: 0 };
    }
    getBounds() {
      // `onMapMove` now takes real LngLatBounds: the viewport filter compares
      // against per-ZIP polygon bounds rather than a centroid box.
      return {
        toArray: () => [
          [-1, -1],
          [1, 1],
        ] as [[number, number], [number, number]],
        getWest: () => -1,
        getSouth: () => -1,
        getEast: () => 1,
        getNorth: () => 1,
      };
    }
    querySourceFeatures() {
      return [] as Array<{ id?: string }>;
    }
    getZoom() {
      return 5;
    }
    resize() {
      mockResize();
    }
    triggerRepaint() {
      mockTriggerRepaint();
    }
    remove() {}
    isStyleLoaded() {
      return true;
    }
    loaded() {
      return true;
    }
    addSource(id: string) {
      this.sources.set(id, { setData: vi.fn() });
    }
    getSource(id: string) {
      return this.sources.get(id);
    }
    addLayer(layer: { id: string; paint?: Record<string, unknown> }) {
      this.layers.set(layer.id, layer);
    }
    getLayer(id: string) {
      return this.layers.get(id);
    }
    getStyle() {
      return { layers: [] };
    }
    scrollZoom = { setZoomRate() {}, setWheelZoomRate() {} };
  }

  class MockPopup {
    setLngLat() {
      return this;
    }
    setHTML() {
      return this;
    }
    addTo() {
      return this;
    }
    remove() {}
  }

  return { MockMap, MockPopup, mockResize, mockTriggerRepaint, mockSetStyle };
});

afterEach(() => vi.useRealTimers());

interface MockMapLibreModule {
  Map: typeof mocks.MockMap;
  Popup: typeof mocks.MockPopup;
  AttributionControl: new () => unknown;
  NavigationControl: new () => unknown;
  setWorkerUrl: (url: string) => void;
  addProtocol: (scheme: string, handler: unknown) => void;
  __getLastMap: () => InstanceType<typeof mocks.MockMap> | null;
  __getMockResize: () => ReturnType<typeof vi.fn>;
  __getMockTriggerRepaint: () => ReturnType<typeof vi.fn>;
}

vi.mock("maplibre-gl", () => {
  const mod: MockMapLibreModule = {
    Map: mocks.MockMap,
    Popup: mocks.MockPopup,
    AttributionControl: class {},
    NavigationControl: class {},
    setWorkerUrl: () => undefined,
    addProtocol: () => undefined,
    __getLastMap: () => mocks.MockMap.lastInstance,
    __getMockResize: () => mocks.mockResize,
    __getMockTriggerRepaint: () => mocks.mockTriggerRepaint,
  };
  return { ...mod, default: mod };
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.MockMap.autoLoad = true;
  // Ensure container has size so map initializes
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 800 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 });

  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
});

describe("MapLibreMap", () => {
  const selectionProps = {
    selectedMetric: "zhvi", onZipSelect: vi.fn(), store: null,
    isLoading: false, classSource: null, onMapMove: vi.fn(),
  };

  it("applies a selection after the map loads, moves it, and clears it without flying", async () => {
    const { rerender } = render(<MapLibreMap {...selectionProps} selectedZip="00501" />);
    await act(async () => { vi.runAllTimers(); });
    const map = mocks.MockMap.lastInstance!;
    expect(map.setFeatureState).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "00501" }), { highlighted: true },
    );
    map.setFeatureState.mockClear();
    rerender(<MapLibreMap {...selectionProps} selectedZip="10001" searchZip="00501" />);
    expect(map.setFeatureState.mock.calls).toEqual([
      [expect.objectContaining({ id: "00501" }), { highlighted: false }],
      [expect.objectContaining({ id: "10001" }), { highlighted: true }],
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Reset map to default view" }));
    expect(map.fitBounds).toHaveBeenCalled();
    expect(map.setFeatureState).toHaveBeenCalledTimes(2);
    rerender(<MapLibreMap {...selectionProps} />);
    expect(map.setFeatureState).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "10001" }), { highlighted: false },
    );
    expect(map.flyTo).not.toHaveBeenCalled();
    expect(map.paintWrites).not.toHaveBeenCalled();
    expect(map.layers.get("zips-border")?.paint?.["line-color"]).toContain("#0086B3");
    expect(map.layers.get("zips-selection-halo")?.paint?.["line-color"]).toBe("#ffffff");
  });

  it("flies again on a repeated search without changing the primary highlight", async () => {
    const store = {
      n: 0, anchors: () => ({ lng: [], lat: [] }),
      get: (zip: string) => ({ zipCode: zip, longitude: -75, latitude: 40 } as ZipData),
    } as unknown as ZipTable;
    const props = { ...selectionProps, store, selectedZip: "10001", searchZip: "00501", searchTrigger: 1 };
    const { rerender } = render(<MapLibreMap {...props} />);
    await act(async () => { vi.runAllTimers(); });
    const map = mocks.MockMap.lastInstance!;
    expect(map.flyTo).toHaveBeenCalledTimes(1);
    expect(map.setFeatureState).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "10001" }), { highlighted: true },
    );
    rerender(<MapLibreMap {...props} searchTrigger={2} />);
    expect(map.flyTo).toHaveBeenCalledTimes(2);
    expect(map.setFeatureState).toHaveBeenCalledTimes(1);
  });

  it("removes roads before the basemap loads, without waiting for ZIP data", () => {
    mocks.MockMap.autoLoad = false;
    renderMap();
    expect(mocks.MockMap.lastInstance?.options.style).toBeUndefined();
    const [url, options] = mocks.mockSetStyle.mock.calls[0] ?? [];
    expect(url).toContain("positron-gl-style");
    expect(options?.transformStyle).toBeTypeOf("function");
    const style = options.transformStyle(undefined, {
      version: 8, sources: {}, layers: [
        { id: "background", type: "background" },
        { id: "road_mot_fill_noramp", type: "line", source: "carto", "source-layer": "roads", minzoom: 12 },
        { id: "road_path_areas", type: "line", source: "carto", "source-layer": "landuse" },
        { id: "boundary_state", type: "line", source: "carto", "source-layer": "boundary" },
      ],
    });
    expect(style.layers.map((layer: { id: string }) => layer.id)).toEqual(["background", "boundary_state"]);
  });

  it("suppresses non-fatal decoding errors", async () => {
    render(
      <MapLibreMap
        selectedMetric="zhvi"
        onZipSelect={() => undefined}
        store={null}
        isLoading={false}
        classSource={null}
        onMapMove={() => undefined}
      />
    );

    await act(async () => {
      vi.runAllTimers();
    });

    const mod = maplibregl as unknown as MockMapLibreModule;
    const lastMapInstance = mod.__getLastMap();
    await act(async () => {
      lastMapInstance?.emit("error", { error: { message: "decoding failed" } });
    });

    expect(mocks.mockSetStyle.mock.calls.filter(([style]) => isFallback(style))).toHaveLength(0);
  });

  it("suppresses recoverable context-loss errors", async () => {
    render(
      <MapLibreMap
        selectedMetric="zhvi"
        onZipSelect={() => undefined}
        store={null}
        isLoading={false}
        classSource={null}
        onMapMove={() => undefined}
      />
    );

    await act(async () => {
      vi.runAllTimers();
    });

    const mod = maplibregl as unknown as MockMapLibreModule;
    const lastMapInstance = mod.__getLastMap();
    await act(async () => {
      lastMapInstance?.emit("error", { error: { message: "WebGL context lost." } });
      vi.runAllTimers();
    });

    expect(mod.__getMockResize()).toHaveBeenCalled();
    expect(mod.__getMockTriggerRepaint()).toHaveBeenCalled();
    expect(mocks.mockSetStyle.mock.calls.filter(([style]) => isFallback(style))).toHaveLength(0);
  });

  const renderMap = () => render(
    <MapLibreMap
      selectedMetric="zhvi"
      onZipSelect={() => undefined}
      store={null}
      isLoading={false}
      classSource={null}
      onMapMove={() => undefined}
    />
  );
  const isFallback = (style: unknown) =>
    (style as { sources?: object }).sources !== undefined &&
    Object.keys((style as { sources: object }).sources).length === 0;

  it("draws without the basemap when its style fails to load", async () => {
    mocks.MockMap.autoLoad = false;
    renderMap();
    await act(async () => {
      mocks.MockMap.lastInstance?.emit("error", { error: { message: "Failed to fetch" } });
    });
    expect(mocks.mockSetStyle).toHaveBeenCalledTimes(2);
    expect(isFallback(mocks.mockSetStyle.mock.calls[1][0])).toBe(true);
  });

  it("draws without the basemap when its style never arrives", async () => {
    mocks.MockMap.autoLoad = false;
    renderMap();
    await act(async () => { vi.advanceTimersByTime(9_000); });
    expect(mocks.mockSetStyle.mock.calls.filter(([style]) => isFallback(style))).toHaveLength(0);
    await act(async () => { vi.advanceTimersByTime(2_000); });
    expect(mocks.mockSetStyle).toHaveBeenCalledTimes(2);
    expect(isFallback(mocks.mockSetStyle.mock.calls[1][0])).toBe(true);
  });

  it("keeps the basemap when its style arrived but the first tiles are slow", async () => {
    // `load` also waits for the first ZIP tiles. A cold dev server or a slow connection
    // passes 10 s with a working basemap, and falling back then blanked the background.
    mocks.MockMap.autoLoad = false;
    renderMap();
    await act(async () => { mocks.MockMap.lastInstance?.emit("styledata"); });
    await act(async () => { vi.advanceTimersByTime(20_000); });
    expect(mocks.mockSetStyle.mock.calls.filter(([style]) => isFallback(style))).toHaveLength(0);
  });

  it("keeps the basemap once it has loaded", async () => {
    renderMap();
    await act(async () => { vi.advanceTimersByTime(20_000); });
    expect(mocks.mockSetStyle.mock.calls.filter(([style]) => isFallback(style))).toHaveLength(0);
  });
});

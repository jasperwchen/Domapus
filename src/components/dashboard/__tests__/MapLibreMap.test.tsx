import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { MapLibreMap } from "../MapLibreMap";
import * as maplibregl from "maplibre-gl";

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

    constructor() {
      MockMap.lastInstance = this;
      if (MockMap.autoLoad) setTimeout(() => this.emit("load"), 0);
    }

    setStyle(style: unknown) {
      mockSetStyle(style);
    }

    on(event: string, cb: (payload?: unknown) => void) {
      if (!this.handlers[event]) this.handlers[event] = [];
      this.handlers[event].push(cb);
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
    getSource() {
      return null;
    }
    getLayer() {
      return null;
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

    expect(mocks.mockSetStyle).not.toHaveBeenCalled();
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
    expect(mocks.mockSetStyle).not.toHaveBeenCalled();
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
    expect(mocks.mockSetStyle).toHaveBeenCalledTimes(1);
    expect(isFallback(mocks.mockSetStyle.mock.calls[0][0])).toBe(true);
  });

  it("draws without the basemap when its style never arrives", async () => {
    mocks.MockMap.autoLoad = false;
    renderMap();
    await act(async () => { vi.advanceTimersByTime(9_000); });
    expect(mocks.mockSetStyle).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(2_000); });
    expect(mocks.mockSetStyle).toHaveBeenCalledTimes(1);
    expect(isFallback(mocks.mockSetStyle.mock.calls[0][0])).toBe(true);
  });

  it("keeps the basemap when its style arrived but the first tiles are slow", async () => {
    // `load` also waits for the first ZIP tiles. A cold dev server or a slow connection
    // passes 10 s with a working basemap, and falling back then blanked the background.
    mocks.MockMap.autoLoad = false;
    renderMap();
    await act(async () => { mocks.MockMap.lastInstance?.emit("styledata"); });
    await act(async () => { vi.advanceTimersByTime(20_000); });
    expect(mocks.mockSetStyle).not.toHaveBeenCalled();
  });

  it("keeps the basemap once it has loaded", async () => {
    renderMap();
    await act(async () => { vi.advanceTimersByTime(20_000); });
    expect(mocks.mockSetStyle).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MapLibreMap } from "../MapLibreMap";
import maplibregl from "maplibre-gl";

// Hoisted so vi.mock (which is hoisted to the top of the module) can access these.
const mocks = vi.hoisted(() => {
  const mockResize = vi.fn();
  const mockTriggerRepaint = vi.fn();

  class MockMap {
    static lastInstance: MockMap | null = null;
    handlers: Record<string, Array<(payload?: unknown) => void>> = {};

    constructor() {
      MockMap.lastInstance = this;
      setTimeout(() => this.emit("load"), 0);
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
      return {
        toArray: () => [
          [-1, -1],
          [1, 1],
        ] as [[number, number], [number, number]],
      };
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

  return { MockMap, MockPopup, mockResize, mockTriggerRepaint };
});

interface MockMapLibreModule {
  Map: typeof mocks.MockMap;
  Popup: typeof mocks.MockPopup;
  AttributionControl: new () => unknown;
  NavigationControl: new () => unknown;
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
    __getLastMap: () => mocks.MockMap.lastInstance,
    __getMockResize: () => mocks.mockResize,
    __getMockTriggerRepaint: () => mocks.mockTriggerRepaint,
  };
  return { ...mod, default: mod };
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
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
        zipData={{}}
        isLoading={false}
        customBuckets={null}
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

    expect(screen.queryByText("Map internal error. Reloading...")).toBeNull();
  });

  it("suppresses recoverable context-loss errors", async () => {
    render(
      <MapLibreMap
        selectedMetric="zhvi"
        onZipSelect={() => undefined}
        zipData={{}}
        isLoading={false}
        customBuckets={null}
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
    expect(screen.queryByText("Map internal error. Reloading...")).toBeNull();
  });
});

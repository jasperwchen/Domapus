/**
 * Tests for the export feature (ExportSidebar + PrintStage).
 *
 * Strategy:
 *  - maplibre-gl is mocked so no WebGL is required in jsdom.
 *  - PrintStage's exportToCanvas is tested by verifying it returns a canvas.
 *  - ExportSidebar tests verify UI state transitions (region selection,
 *    button states, checkbox toggling, etc.).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { createRef } from "react";
import { ExportSidebar } from "../export/ExportSidebar";
import { PrintStage, PrintStageRef } from "../export/PrintStage";
import { ZipData } from "../map/types";

// ---------------------------------------------------------------------------
// maplibre-gl mock — WebGL-free, simulates source loading correctly
// ---------------------------------------------------------------------------
vi.mock("maplibre-gl", () => {
  class MockMap {
    static lastInstance: MockMap | null = null;
    handlers: Record<string, Array<(payload?: unknown) => void>> = {};
    _loaded = true;
    _styleLoaded = true;
    _sourcesLoaded: Record<string, boolean> = {};

    constructor() {
      MockMap.lastInstance = this;
      setTimeout(() => this.emit("load"), 0);
    }

    on(event: string, cb: (payload?: unknown) => void) {
      if (!this.handlers[event]) this.handlers[event] = [];
      this.handlers[event].push(cb);
    }

    once(event: string, cb: (payload?: unknown) => void) {
      const handler = (payload?: unknown) => {
        cb(payload);
        this.handlers[event] = (this.handlers[event] || []).filter(h => h !== handler);
      };
      this.on(event, handler);
    }

    off(event: string, cb: (payload?: unknown) => void) {
      if (this.handlers[event]) {
        this.handlers[event] = this.handlers[event].filter(h => h !== cb);
      }
    }

    emit(event: string, payload?: unknown) {
      (this.handlers[event] || []).forEach(cb => cb(payload));
    }

    resize() {}
    remove() {}
    loaded() { return this._loaded; }
    isStyleLoaded() { return this._styleLoaded; }
    isSourceLoaded(id: string) { return !!this._sourcesLoaded[id]; }
    getStyle() { return { layers: [] }; }
    getLayer() { return null; }

    addSource(id: string) {
      this._sourcesLoaded[id] = true;
      // Emit sourcedata so the onSourceData listener fires immediately
      setTimeout(() => {
        this.emit("sourcedata", { sourceId: id, isSourceLoaded: true });
      }, 0);
    }

    addLayer() {}
    setLayoutProperty() {}
    setFeatureState() {}
    fitBounds() {}

    triggerRepaint() {
      // Emit 'render' so captureMapCanvas resolves
      setTimeout(() => this.emit("render"), 0);
    }

    getCanvas() {
      const canvas = document.createElement("canvas");
      canvas.width = 100;
      canvas.height = 100;
      return canvas;
    }
  }

  class MockPopup {
    setLngLat() { return this; }
    setHTML() { return this; }
    addTo() { return this; }
    remove() {}
  }

  const mod = {
    Map: MockMap,
    Popup: MockPopup,
    AttributionControl: class {},
    NavigationControl: class {},
    __getLastMap: () => MockMap.lastInstance,
  };
  return { ...mod, default: mod };
});

vi.mock("@/lib/pmtiles-protocol", () => ({ addPMTilesProtocol: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ trackError: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------
function makeZip(overrides: Partial<ZipData> = {}): ZipData {
  return {
    zipCode: "90210",
    city: "Beverly Hills",
    county: "Los Angeles",
    state: "CA",
    metro: "Los Angeles",
    latitude: 34.09,
    longitude: -118.41,
    period_end: "2024-01-31",
    zhvi: 1_500_000,
    zhvi_mom: null, zhvi_yoy: null,
    median_sale_price: 1_200_000, median_sale_price_yoy: null,
    median_list_price: null, median_list_price_yoy: null,
    median_ppsf: null, median_ppsf_yoy: null,
    median_list_ppsf: null, median_list_ppsf_yoy: null,
    homes_sold: null, homes_sold_yoy: null,
    pending_sales: null, pending_sales_yoy: null,
    new_listings: null, new_listings_yoy: null,
    active_listings: null, active_listings_yoy: null,
    inventory: null, inventory_yoy: null,
    median_dom: null, median_dom_yoy: null,
    months_of_supply: null, months_of_supply_yoy: null,
    avg_sale_to_list_ratio: null, avg_sale_to_list_ratio_yoy: null,
    sold_above_list: null, sold_above_list_yoy: null,
    off_market_in_two_weeks: null, off_market_in_two_weeks_yoy: null,
    ...overrides,
  };
}

const SAMPLE_ZIP_DATA: Record<string, ZipData> = {
  "90210": makeZip(),
  "99501": makeZip({
    zipCode: "99501", city: "Anchorage", state: "AK",
    metro: "Anchorage", latitude: 61.21, longitude: -149.9,
    zhvi: 350_000,
  }),
  "96815": makeZip({
    zipCode: "96815", city: "Honolulu", state: "HI",
    metro: "Honolulu", latitude: 21.28, longitude: -157.83,
    zhvi: 850_000,
  }),
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 800 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 });
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  // Stub canvas 2D context
  HTMLCanvasElement.prototype.getContext = function (type: string) {
    if (type !== "2d") return null;
    return {
      fillStyle: "",
      font: "",
      textAlign: "left" as CanvasTextAlign,
      fillRect: vi.fn(),
      fillText: vi.fn(),
      strokeRect: vi.fn(),
      drawImage: vi.fn(),
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      fill: vi.fn(),
      createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    } as unknown as CanvasRenderingContext2D;
  } as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/**
 * Advance fake timers enough for mock maps to load + polling to fire.
 * runAllTimers is called twice to handle the nested setTimeout chains:
 * 1st pass: 'load' event fires, addSource schedules 'sourcedata'
 * 2nd pass: 'sourcedata' fires (featureStates applied), safety timeout (10s) fires → markReady
 */
async function advanceToMapReady() {
  await act(async () => { vi.runAllTimers(); });
  await act(async () => { vi.runAllTimers(); });
}

// ---------------------------------------------------------------------------
// ExportSidebar UI tests
// ---------------------------------------------------------------------------
describe("ExportSidebar", () => {
  it("renders the Export Settings heading", () => {
    render(<ExportSidebar allZipData={SAMPLE_ZIP_DATA} selectedMetric="zhvi" onClose={vi.fn()} />);
    expect(screen.getByText("Export Settings")).toBeInTheDocument();
  });

  it("defaults to national scope and PNG format", () => {
    render(<ExportSidebar allZipData={SAMPLE_ZIP_DATA} selectedMetric="zhvi" onClose={vi.fn()} />);
    expect(screen.getByRole("radio", { name: /national/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /png/i })).toBeChecked();
  });

  it("shows the Cancel button and calls onClose when clicked", () => {
    const onClose = vi.fn();
    render(<ExportSidebar allZipData={SAMPLE_ZIP_DATA} selectedMetric="zhvi" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("export button is disabled while map is rendering", () => {
    render(<ExportSidebar allZipData={SAMPLE_ZIP_DATA} selectedMetric="zhvi" onClose={vi.fn()} />);
    // Button has id="btn-map-export"; its accessible name is its text content
    const btn = document.getElementById("btn-map-export") as HTMLButtonElement;
    expect(btn).toBeDisabled();
  });

  it("export button becomes enabled after map reports ready", async () => {
    render(<ExportSidebar allZipData={SAMPLE_ZIP_DATA} selectedMetric="zhvi" onClose={vi.fn()} />);
    await advanceToMapReady();
    // After fake timers drain, React has processed state updates synchronously inside act
    const btn = document.getElementById("btn-map-export") as HTMLButtonElement;
    expect(btn).not.toBeDisabled();
  }, 10_000);

  it("switches to state scope and shows state dropdown trigger", () => {
    render(<ExportSidebar allZipData={SAMPLE_ZIP_DATA} selectedMetric="zhvi" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: /^state$/i }));
    // Select trigger placeholder is rendered as a button with "Select a state" text
    const trigger = screen.getByRole("combobox");
    expect(trigger).toBeInTheDocument();
  });

  it("switches to metro scope and shows metro search input", () => {
    render(<ExportSidebar allZipData={SAMPLE_ZIP_DATA} selectedMetric="zhvi" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: /^metro$/i }));
    expect(screen.getByPlaceholderText(/type to search metros/i)).toBeInTheDocument();
  });

  it("toggles the Include Legend checkbox", () => {
    render(<ExportSidebar allZipData={SAMPLE_ZIP_DATA} selectedMetric="zhvi" onClose={vi.fn()} />);
    const checkbox = screen.getByRole("checkbox", { name: /include legend/i });
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });

  it("toggles the Include Title checkbox", () => {
    render(<ExportSidebar allZipData={SAMPLE_ZIP_DATA} selectedMetric="zhvi" onClose={vi.fn()} />);
    const checkbox = screen.getByRole("checkbox", { name: /include title/i });
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });

  it("renders with empty allZipData without crashing", () => {
    render(<ExportSidebar allZipData={{}} selectedMetric="zhvi" onClose={vi.fn()} />);
    expect(screen.getByText("Export Settings")).toBeInTheDocument();
  });

  it("shows PDF radio option", () => {
    render(<ExportSidebar allZipData={SAMPLE_ZIP_DATA} selectedMetric="zhvi" onClose={vi.fn()} />);
    expect(screen.getByRole("radio", { name: /pdf/i })).toBeInTheDocument();
  });

  it("switching to PDF selects the PDF radio", () => {
    render(<ExportSidebar allZipData={SAMPLE_ZIP_DATA} selectedMetric="zhvi" onClose={vi.fn()} />);
    const pdfRadio = screen.getByRole("radio", { name: /pdf/i });
    fireEvent.click(pdfRadio);
    expect(pdfRadio).toBeChecked();
  });
});

// ---------------------------------------------------------------------------
// PrintStage unit tests
// ---------------------------------------------------------------------------
const defaultProps = {
  filteredData: Object.values(SAMPLE_ZIP_DATA),
  selectedMetric: "zhvi",
  regionScope: "national" as const,
  regionName: "United States",
  includeLegend: true,
  includeTitle: true,
  showCities: false,
};

describe("PrintStage", () => {
  it("renders without crashing", () => {
    render(<PrintStage {...defaultProps} />);
    expect(screen.getByText(/rendering map/i)).toBeInTheDocument();
  });

  it("renders title and subtitle when includeTitle is true", () => {
    render(<PrintStage {...defaultProps} />);
    expect(screen.getByText(/by ZIP Code/i)).toBeInTheDocument();
    expect(screen.getByText(/United States/)).toBeInTheDocument();
  });

  it("dates the subtitle from the data, not from today's clock", () => {
    // A Redfin metric takes its period from the records themselves. The fixture
    // is period_end 2024-01-31, and every Redfin row is a rolling 3-month window,
    // so the subtitle must name that window no matter when the test runs. This
    // previously printed `today minus one month`.
    render(<PrintStage {...defaultProps} selectedMetric="median_sale_price" />);
    expect(
      screen.getByText(/United States • 3 months ending Jan 31, 2024/)
    ).toBeInTheDocument();

    // The exact string the old clock-based implementation would have produced.
    const clockDerived = new Date(new Date().setMonth(new Date().getMonth() - 1))
      .toLocaleDateString("en-US", { month: "long", year: "numeric" });
    expect(screen.queryByText(`United States • ${clockDerived}`)).toBeNull();
  });

  it("omits the date rather than inventing one when the period is unknown", () => {
    const undated = Object.values(SAMPLE_ZIP_DATA).map(z => ({ ...z, period_end: null }));
    render(<PrintStage {...defaultProps} selectedMetric="median_sale_price" filteredData={undated} />);
    expect(screen.getByText("United States")).toBeInTheDocument();
  });

  it("does not render title when includeTitle is false", () => {
    render(<PrintStage {...defaultProps} includeTitle={false} />);
    expect(screen.queryByText(/by ZIP Code/i)).toBeNull();
  });

  it("renders inset labels for national scope when AK and HI data present", () => {
    render(<PrintStage {...defaultProps} />);
    expect(screen.getByText("Alaska")).toBeInTheDocument();
    expect(screen.getByText("Hawaii")).toBeInTheDocument();
  });

  it("does not render insets for state scope", () => {
    render(
      <PrintStage
        {...defaultProps}
        filteredData={[makeZip()]}
        regionScope="state"
        regionName="California"
      />
    );
    expect(screen.queryByText("Alaska")).toBeNull();
    expect(screen.queryByText("Hawaii")).toBeNull();
  });

  it("getElement returns the container div", async () => {
    const ref = createRef<PrintStageRef>();
    render(<PrintStage {...defaultProps} ref={ref} />);
    await act(async () => { vi.runAllTimers(); });
    expect(ref.current?.getElement()).toBeInstanceOf(HTMLDivElement);
  });

  it("calls onReady after maps load", async () => {
    const onReady = vi.fn();
    render(<PrintStage {...defaultProps} onReady={onReady} />);
    await advanceToMapReady();
    // onReady is called synchronously inside the safety-timeout path; after act it should be set
    expect(onReady).toHaveBeenCalled();
  }, 10_000);

  it("exportToCanvas returns an HTMLCanvasElement", async () => {
    const ref = createRef<PrintStageRef>();
    render(<PrintStage {...defaultProps} ref={ref} />);

    await advanceToMapReady();

    let canvas: HTMLCanvasElement | undefined;
    await act(async () => {
      const exportPromise = ref.current!.exportToCanvas();
      // triggerRepaint → setTimeout(emit render) → needs one more timer pass
      vi.runAllTimers();
      canvas = await exportPromise;
    });

    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(canvas!.width).toBe(3600);
    expect(canvas!.height).toBe(2700);
  }, 10_000);

  it("calls onReady only once for a given config (no double-fire)", async () => {
    const onReady = vi.fn();
    render(<PrintStage {...defaultProps} onReady={onReady} />);
    await advanceToMapReady();
    // Extra timer pass to confirm no additional calls
    await act(async () => { vi.runAllTimers(); });
    expect(onReady).toHaveBeenCalledTimes(1);
  }, 10_000);
});
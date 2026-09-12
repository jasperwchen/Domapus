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
import { PrintStage, PrintStageRef, ExportRender } from "../export/PrintStage";
import * as maplibregl from "maplibre-gl";
import { ZipData } from "../map/types";

// ---------------------------------------------------------------------------
// maplibre-gl mock — WebGL-free, simulates source loading correctly
// ---------------------------------------------------------------------------
vi.mock("maplibre-gl", () => {
  class MockMap {
    static instances: MockMap[] = [];
    static lastInstance: MockMap | null = null;
    handlers: Record<string, Array<(payload?: unknown) => void>> = {};
    _loaded = true;
    _styleLoaded = true;
    _sourcesLoaded: Record<string, boolean> = {};
    /** Recorded so tests can assert WHAT was painted, not merely that something
     *  was. The old mock swallowed addLayer, which is how a paint expression
     *  MapLibre rejects outright shipped for months. */
    addedLayers: Array<Record<string, unknown>> = [];
    stateWrites: Array<{ id: unknown; state: Record<string, number> }> = [];
    layoutCalls: Array<[string, string, unknown]> = [];
    fitCalls: Array<{ bounds: unknown; options: Record<string, unknown> }> = [];
    removed = false;

    constructor(public options: Record<string, unknown> = {}) {
      MockMap.lastInstance = this;
      MockMap.instances.push(this);
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
    remove() { this.removed = true; }
    loaded() { return this._loaded; }
    isStyleLoaded() { return this._styleLoaded; }
    isSourceLoaded(id: string) { return !!this._sourcesLoaded[id]; }
    getStyle() {
      return {
        layers: [
          { id: "water_line", "source-layer": "water" },
          { id: "place_city_large" },
          { id: "place_city_small" },
        ],
      };
    }
    getLayer() { return null; }

    addSource(id: string) {
      this._sourcesLoaded[id] = true;
      // Emit sourcedata so the onSourceData listener fires immediately
      setTimeout(() => {
        this.emit("sourcedata", { sourceId: id, isSourceLoaded: true });
      }, 0);
    }

    addLayer(spec: Record<string, unknown>) { this.addedLayers.push(spec); }
    setLayoutProperty(id: string, prop: string, value: unknown) {
      this.layoutCalls.push([id, prop, value]);
    }
    setFeatureState(target: { id: unknown }, state: Record<string, number>) {
      this.stateWrites.push({ id: target.id, state });
    }
    fitBounds(bounds: unknown, options: Record<string, unknown> = {}) {
      this.fitCalls.push({ bounds, options });
    }
    getZoom() { return 4; }

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
    setWorkerUrl: () => undefined,
    addProtocol: () => undefined,
    __getLastMap: () => MockMap.lastInstance,
    __getMaps: () => MockMap.instances,
    __resetMaps: () => { MockMap.instances = []; MockMap.lastInstance = null; },
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

    // Statistics columns. Phase 5 fills four of these; the rest ship real.
    msp_rse: null,
    dom_rse: null,
    rel: null,
    msp_yoy_se: null,
    f_h12: null,
    f_sigma: null,
    f_tier: null,
    lisa: null,

    // Real polygon bbox, as offsets from the anchor.
    bw: null,
    bs: null,
    be: null,
    bn: null,
    cov: null,
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

/**
 * The shipped `manifest.classing.zhvi.breaks` — the boundaries the live map is
 * painting. The export takes these; it must never cut its own.
 *
 * The three fixture ZIPs fall in classes 5, 10 and 12 under them, which is what
 * `paints the classes the manifest's breaks imply` asserts. Under the 14 plain
 * quantiles the export used to compute, three values become classes 0, 6 and 13,
 * so the test fails loudly if the old behaviour comes back.
 */
const BREAKS = [
  127911.2096, 157294.2195, 193426.9214, 237859.8149, 292499.5709,
  359690.85, 442316.9141, 543923.351, 668870.2204, 822519.1489,
  1011463.4044, 1243810.8218, 1529531.7198,
];


// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
/** A ZIP in each far corner of the lower 48, so the mainland fit has the same
 *  shape it has in production: wider than the frame, with vertical slack. */
const CONUS_ZIP_DATA: Record<string, ZipData> = {
  "98101": makeZip({ zipCode: "98101", state: "WA", latitude: 47.6, longitude: -122.3 }),
  "33101": makeZip({ zipCode: "33101", state: "FL", latitude: 25.8, longitude: -80.2 }),
  "04101": makeZip({ zipCode: "04101", state: "ME", latitude: 43.7, longitude: -70.3 }),
  "99501": makeZip({ zipCode: "99501", state: "AK", latitude: 61.21, longitude: -149.9 }),
  "96815": makeZip({ zipCode: "96815", state: "HI", latitude: 21.28, longitude: -157.83 }),
};

interface RecordedMap {
  options: Record<string, unknown>;
  addedLayers: Array<Record<string, unknown>>;
  stateWrites: Array<{ id: unknown; state: Record<string, number> }>;
  layoutCalls: Array<[string, string, unknown]>;
  fitCalls: Array<{ bounds: unknown; options: Record<string, unknown> }>;
}
const mapMock = maplibregl as unknown as {
  __getMaps: () => RecordedMap[];
  __resetMaps: () => void;
};

beforeEach(() => {
  mapMock.__resetMaps();
  vi.useFakeTimers();
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 800 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 });
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  // Stub canvas 2D context. measureText has to return a real width: the footer
  // is right-aligned by measuring its own segments, and a zero width would put
  // every PDF link box in the same place.
  HTMLCanvasElement.prototype.getContext = function (type: string) {
    if (type !== "2d") return null;
    return {
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      font: "",
      textAlign: "left" as CanvasTextAlign,
      textBaseline: "alphabetic" as CanvasTextBaseline,
      fillRect: vi.fn(),
      fillText: vi.fn(),
      strokeRect: vi.fn(),
      drawImage: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      roundRect: vi.fn(),
      fill: vi.fn(),
      measureText: (t: string) => ({ width: t.length * 8 }),
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
    render(<ExportSidebar allZipData={SAMPLE_ZIP_DATA} selectedMetric="zhvi" breaks={BREAKS} onClose={vi.fn()} />);
    expect(screen.getByText("Export Settings")).toBeInTheDocument();
  });

  it("defaults to national scope and PNG format", () => {
    render(<ExportSidebar allZipData={SAMPLE_ZIP_DATA} selectedMetric="zhvi" breaks={BREAKS} onClose={vi.fn()} />);
    expect(screen.getByRole("radio", { name: /national/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /png/i })).toBeChecked();
  });

  it("shows the Cancel button and calls onClose when clicked", () => {
    const onClose = vi.fn();
    render(<ExportSidebar allZipData={SAMPLE_ZIP_DATA} selectedMetric="zhvi" breaks={BREAKS} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("export button is disabled while map is rendering", () => {
    render(<ExportSidebar allZipData={SAMPLE_ZIP_DATA} selectedMetric="zhvi" breaks={BREAKS} onClose={vi.fn()} />);
    // Button has id="btn-map-export"; its accessible name is its text content
    const btn = document.getElementById("btn-map-export") as HTMLButtonElement;
    expect(btn).toBeDisabled();
  });

  it("export button becomes enabled after map reports ready", async () => {
    render(<ExportSidebar allZipData={SAMPLE_ZIP_DATA} selectedMetric="zhvi" breaks={BREAKS} onClose={vi.fn()} />);
    await advanceToMapReady();
    // After fake timers drain, React has processed state updates synchronously inside act
    const btn = document.getElementById("btn-map-export") as HTMLButtonElement;
    expect(btn).not.toBeDisabled();
  }, 10_000);

  it("switches to state scope and shows state dropdown trigger", () => {
    render(<ExportSidebar allZipData={SAMPLE_ZIP_DATA} selectedMetric="zhvi" breaks={BREAKS} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: /^state$/i }));
    // Select trigger placeholder is rendered as a button with "Select a state" text
    const trigger = screen.getByRole("combobox");
    expect(trigger).toBeInTheDocument();
  });

  it("switches to metro scope and shows metro search input", () => {
    render(<ExportSidebar allZipData={SAMPLE_ZIP_DATA} selectedMetric="zhvi" breaks={BREAKS} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: /^metro$/i }));
    expect(screen.getByPlaceholderText(/type to search metros/i)).toBeInTheDocument();
  });

  it("takes the top metro suggestion on Enter", () => {
    render(<ExportSidebar allZipData={SAMPLE_ZIP_DATA} selectedMetric="zhvi" breaks={BREAKS} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: /^metro$/i }));
    const input = screen.getByPlaceholderText(/type to search metros/i);
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByDisplayValue("Anchorage")).toBeInTheDocument();
  });

  it("moves the metro highlight with the arrow keys", () => {
    render(<ExportSidebar allZipData={SAMPLE_ZIP_DATA} selectedMetric="zhvi" breaks={BREAKS} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: /^metro$/i }));
    const input = screen.getByPlaceholderText(/type to search metros/i);
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByDisplayValue("Honolulu")).toBeInTheDocument();
  });

  it("wraps the metro highlight to the last suggestion on ArrowUp", () => {
    render(<ExportSidebar allZipData={SAMPLE_ZIP_DATA} selectedMetric="zhvi" breaks={BREAKS} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: /^metro$/i }));
    const input = screen.getByPlaceholderText(/type to search metros/i);
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByDisplayValue("Los Angeles")).toBeInTheDocument();
  });

  it("toggles the Include Legend checkbox", () => {
    render(<ExportSidebar allZipData={SAMPLE_ZIP_DATA} selectedMetric="zhvi" breaks={BREAKS} onClose={vi.fn()} />);
    const checkbox = screen.getByRole("checkbox", { name: /include legend/i });
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });

  it("toggles the Include Title checkbox", () => {
    render(<ExportSidebar allZipData={SAMPLE_ZIP_DATA} selectedMetric="zhvi" breaks={BREAKS} onClose={vi.fn()} />);
    const checkbox = screen.getByRole("checkbox", { name: /include title/i });
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });

  it("renders with empty allZipData without crashing", () => {
    render(<ExportSidebar allZipData={{}} selectedMetric="zhvi" breaks={BREAKS} onClose={vi.fn()} />);
    expect(screen.getByText("Export Settings")).toBeInTheDocument();
  });

  it("shows PDF radio option", () => {
    render(<ExportSidebar allZipData={SAMPLE_ZIP_DATA} selectedMetric="zhvi" breaks={BREAKS} onClose={vi.fn()} />);
    expect(screen.getByRole("radio", { name: /pdf/i })).toBeInTheDocument();
  });

  it("switching to PDF selects the PDF radio", () => {
    render(<ExportSidebar allZipData={SAMPLE_ZIP_DATA} selectedMetric="zhvi" breaks={BREAKS} onClose={vi.fn()} />);
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
  breaks: BREAKS,
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
    // is period_end 2024-01-31, so the subtitle must name that date no matter
    // when the test runs. This previously printed `today minus one month`.
    render(<PrintStage {...defaultProps} selectedMetric="median_sale_price" />);
    expect(
      screen.getByText(/United States\s+·\s+Data through January 31, 2024/)
    ).toBeInTheDocument();

    // The exact string the old clock-based implementation would have produced.
    const clockDerived = new Date(new Date().setMonth(new Date().getMonth() - 1))
      .toLocaleDateString("en-US", { month: "long", year: "numeric" });
    expect(screen.queryByText(`United States • ${clockDerived}`)).toBeNull();
  });

  it("says 'Data through', never Redfin's rolling-window phrasing", () => {
    // Deliberate, and commented at `dataDate` in PrintStage: "3 months ending
    // Jul 31, 2026" is the honest description of the statistic and an unreadable
    // chart subtitle. `formatRedfinWindow` stays correct everywhere else.
    render(<PrintStage {...defaultProps} selectedMetric="median_sale_price" />);
    expect(screen.queryByText(/3 months ending/)).toBeNull();
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
    expect(screen.getByText("ALASKA")).toBeInTheDocument();
    expect(screen.getByText("HAWAII")).toBeInTheDocument();
  });

  it("labels each inset with its scale against the main map", async () => {
    // The two boxes are the same size on the page but hold states an order of
    // magnitude apart, so the multiplier is the only thing that says Alaska is
    // drawn at about a fifth of the mainland's scale and Hawaii at about twice.
    render(<PrintStage {...defaultProps} />);
    await advanceToMapReady();
    expect(screen.getByText(/^ALASKA · [\d.]+× scale$/)).toBeInTheDocument();
    expect(screen.getByText(/^HAWAII · [\d.]+× scale$/)).toBeInTheDocument();
  }, 10_000);

  it("spends the mainland fit's spare height pushing the states off the insets", async () => {
    // Measured on the shipped snapshot: with symmetric padding the Hawaii box was
    // drawn over 3 to 8 Texas ZCTAs around Big Bend. A map of the lower 48 is
    // wider than its frame, so the leftover height is free to spend.
    render(
      <PrintStage {...defaultProps} filteredData={Object.values(CONUS_ZIP_DATA)} />
    );
    await advanceToMapReady();
    const opts = mapMock.__getMaps()[0].fitCalls.at(-1)!.options;
    const padding = opts.padding as { top: number; bottom: number };
    expect(typeof padding).toBe("object");
    expect(padding.bottom).toBeGreaterThan(padding.top);
  }, 10_000);

  it("keeps padding symmetric where no inset is drawn", async () => {
    render(
      <PrintStage
        {...defaultProps}
        filteredData={[makeZip()]}
        regionScope="state"
        regionName="California"
      />
    );
    await advanceToMapReady();
    expect(mapMock.__getMaps()[0].fitCalls.at(-1)!.options.padding).toBe(24);
  }, 10_000);

  it("does not render insets for state scope", () => {
    render(
      <PrintStage
        {...defaultProps}
        filteredData={[makeZip()]}
        regionScope="state"
        regionName="California"
      />
    );
    expect(screen.queryByText("ALASKA")).toBeNull();
    expect(screen.queryByText("HAWAII")).toBeNull();
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

    let render_: ExportRender | undefined;
    await act(async () => {
      const exportPromise = ref.current!.exportToCanvas();
      // triggerRepaint → setTimeout(emit render) → needs one more timer pass
      vi.runAllTimers();
      render_ = await exportPromise;
    });

    expect(render_!.canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(render_!.canvas.width).toBe(3600);
    expect(render_!.canvas.height).toBe(2700);
    // One clickable box per brand name in the footer, measured where they were
    // actually drawn rather than guessed at by the PDF writer.
    expect(render_!.links.map(l => l.url)).toEqual([
      "https://jasperwchen.github.io/Domapus/",
      "https://www.redfin.com/news/data-center/",
      "https://www.zillow.com/research/data/",
    ]);
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

// ---------------------------------------------------------------------------
// Colour: the export takes the map's scale, it does not invent one
//
// These are the tests that were missing. The old mock swallowed `addLayer` and
// `setFeatureState`, so nothing here could be checked, and an export that
// coloured 73% of the country differently from the site — and, on 670 of 869
// metros, coloured none of it at all — passed the suite.
// ---------------------------------------------------------------------------
describe("PrintStage colour", () => {
  const flatten = () => mapMock.__getMaps().flatMap(m => m.stateWrites);

  it("paints the classes the manifest's breaks imply", async () => {
    render(<PrintStage {...defaultProps} />);
    await advanceToMapReady();

    const byZip = new Map(flatten().map(w => [String(w.id), w.state.k]));
    // 1,500,000 / 350,000 / 850,000 against the shipped zhvi boundaries.
    expect(byZip.get("90210")).toBe(12);
    expect(byZip.get("99501")).toBe(5);
    expect(byZip.get("96815")).toBe(10);
  }, 10_000);

  it("uses the live map's match expression, never a step on thresholds", async () => {
    render(<PrintStage {...defaultProps} />);
    await advanceToMapReady();

    const fills = mapMock.__getMaps()
      .flatMap(m => m.addedLayers)
      .filter(l => l.id === "zips-fill");
    expect(fills.length).toBeGreaterThan(0);
    for (const layer of fills) {
      const paint = layer.paint as Record<string, unknown>;
      const color = paint["fill-color"] as unknown[];
      expect(color[0]).toBe("match");
      expect(color[1]).toEqual(["coalesce", ["feature-state", "k"], -1]);
      // Reliability is not an opacity channel; the export must not reintroduce
      // the fade the map dropped.
      expect(paint["fill-opacity"]).toBe(1);
    }
  }, 10_000);

  it("still adds a fill layer when every value in the region is identical", async () => {
    // The Pittsburgh + Homes Sold case. Ties made the old quantile thresholds
    // repeat; MapLibre rejects a `step` whose inputs are not strictly ascending,
    // and `addLayer` answers that by firing an error event and RETURNING WITHOUT
    // ADDING THE LAYER. The export came out as outlines with no fill and still
    // said "Export Complete".
    const tied = Array.from({ length: 20 }, (_, i) =>
      makeZip({ zipCode: `1500${i}`, state: "PA", metro: "Pittsburgh, PA", zhvi: 250_000 }));
    render(<PrintStage {...defaultProps} filteredData={tied} regionScope="metro" regionName="Pittsburgh, PA" />);
    await advanceToMapReady();

    const fills = mapMock.__getMaps().flatMap(m => m.addedLayers).filter(l => l.id === "zips-fill");
    expect(fills.length).toBe(1);
    expect(new Set(flatten().map(w => w.state.k))).toEqual(new Set([4]));
  }, 10_000);

  it("holds the export back rather than inventing a scale when breaks are missing", async () => {
    render(<PrintStage {...defaultProps} breaks={null} />);
    await advanceToMapReady();
    expect(screen.getByText(/colour scale unavailable/i)).toBeInTheDocument();
    expect(mapMock.__getMaps()).toHaveLength(0);
  }, 10_000);

  it("renders the main map at the export canvas resolution", async () => {
    // pixelRatio EXPORT_SCALE over a container measured in stage units is what
    // makes `drawImage` 1:1. It was 2, which upscaled the map 1.51x into a file
    // whose selling point is that it is 3600 px across.
    render(<PrintStage {...defaultProps} />);
    await advanceToMapReady();
    expect(mapMock.__getMaps()[0].options.pixelRatio).toBe(3);
  }, 10_000);
});

// ---------------------------------------------------------------------------
// City labels
// ---------------------------------------------------------------------------
describe("city labels", () => {
  it("are unavailable at national scale", () => {
    render(<ExportSidebar allZipData={SAMPLE_ZIP_DATA} selectedMetric="zhvi" breaks={BREAKS} onClose={vi.fn()} />);
    expect(screen.getByRole("checkbox", { name: /show cities/i })).toBeDisabled();
  });

  it("become available once a metro is in scope", () => {
    render(<ExportSidebar allZipData={SAMPLE_ZIP_DATA} selectedMetric="zhvi" breaks={BREAKS} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: /^metro$/i }));
    expect(screen.getByRole("checkbox", { name: /show cities/i })).not.toBeDisabled();
  });

  it("toggle as a visibility change, without rebuilding the maps", async () => {
    const one = [makeZip({ state: "PA", metro: "Pittsburgh, PA" })];
    const props = { ...defaultProps, filteredData: one, regionScope: "metro" as const, regionName: "Pittsburgh, PA" };
    const { rerender } = render(<PrintStage {...props} showCities={false} />);
    await advanceToMapReady();
    const built = mapMock.__getMaps().length;

    rerender(<PrintStage {...props} showCities />);
    await act(async () => { vi.runAllTimers(); });

    expect(mapMock.__getMaps()).toHaveLength(built);
    const shown = mapMock.__getMaps()[0].layoutCalls
      .filter(([id, prop, value]) => id.includes("place_city") && prop === "visibility" && value === "visible");
    expect(shown.length).toBeGreaterThan(0);
  }, 10_000);
});

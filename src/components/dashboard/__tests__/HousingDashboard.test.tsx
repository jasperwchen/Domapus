import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { ZipData } from "../map/types";
import { SearchBox } from "../SearchBox";

// The dashboard's own decisions are under test, not the map or the panels, so every child
// is a stub that shows the one prop that matters.
const m = vi.hoisted(() => ({
  boot: vi.fn(),
  fetchManifest: vi.fn(),
  fetchPaint: vi.fn(),
  toast: vi.fn(),
  processData: vi.fn(),
  isMobile: false,
}));

vi.mock("@/lib/manifest", () => ({
  boot: m.boot,
  fetchManifest: m.fetchManifest,
  fetchPaint: m.fetchPaint,
  takeSnapshotPrefetch: () => Promise.resolve(null),
  outlierCount: () => null,
}));
vi.mock("@/lib/paint-table", () => ({
  PaintTable: { from: (buf: ArrayBuffer, metric: string) => ({ metric, zips: () => [], tag: (buf as unknown as { tag?: string }).tag }) },
}));
vi.mock("@/lib/class-source", () => ({
  PaintTableSource: class { epoch = 0; breaks = null; zips = []; },
  ViewportClassSource: class {},
  visibleZipRows: () => [],
}));
vi.mock("@/hooks/useDataWorker", () => ({
  useDataWorker: () => ({ processData: m.processData, isLoading: false, progress: null }),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: m.toast }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => m.isMobile }));
vi.mock("../MapLibreMap", () => ({
  MapLibreMap: ({ classSource, onMapMove, selectedZip, searchZip, searchTrigger, onZipSelect }: {
    classSource: unknown;
    selectedZip?: string;
    searchZip?: string;
    searchTrigger?: number;
    onZipSelect: (zip: ZipData) => void;
    onMapMove: (loaded: () => string[], bounds: null, view: object, reset: boolean) => void;
  }) => (
    <div data-testid="map" data-painted={classSource ? "yes" : "no"}
      data-selected={selectedZip ?? ""} data-search={searchZip} data-trigger={searchTrigger}>
      {["00501", "10001", "90210"].map(zip => (
        <button key={zip} onClick={() => onZipSelect({ zipCode: zip } as ZipData)}>map {zip}</button>
      ))}
      <button onClick={() => onMapMove(() => [], null, { lat: 40, lng: -75, zoom: 8 }, false)}>
        pan map
      </button>
      <button onClick={() => onMapMove(() => [], null, { lat: 39.8, lng: -98.6, zoom: 3 }, true)}>
        reset view
      </button>
    </div>
  ),
}));
vi.mock("../TopBar", () => ({
  TopBar: ({ selectedMetric, onMetricChange, onSearch }: {
    selectedMetric: string;
    onMetricChange: (x: string) => void;
    onSearch: (zip: string, trigger: number) => void;
  }) => (
    <div>
      <span data-testid="metric">{selectedMetric}</span>
      <button onClick={() => onMetricChange("median_sale_price")}>switch</button>
      <SearchBox onSearch={onSearch} />
    </div>
  ),
}));
vi.mock("../Legend", () => ({ Legend: () => null }));
vi.mock("../Sidebar", () => ({
  Sidebar: ({ isOpen, zipData, compareZip, mode, onClose, onModeChange }: {
    isOpen: boolean; zipData: ZipData | null; compareZip: ZipData | null;
    mode: string; onClose: () => void; onModeChange: (mode: string) => void;
  }) => isOpen && zipData ? (
    <div data-testid="details" data-mode={mode} data-compare={compareZip?.zipCode ?? ""}>
      {zipData.zipCode}
      <button onClick={onClose}>close details</button>
      <button onClick={() => onModeChange(mode === "detail" ? "compare" : "detail")}>toggle compare</button>
    </div>
  ) : null,
}));
vi.mock("../MobileBottomSheet", () => ({
  MobileBottomSheet: ({ isOpen, onClose, children }: {
    isOpen: boolean; onClose: () => void; children: React.ReactNode;
  }) => isOpen ? <div>{children}<button onClick={onClose}>dismiss sheet</button></div> : null,
}));
vi.mock("@/components/MapExport", () => ({ MapExport: () => null }));

const manifest = (tag: string) => ({
  tag, classes: 14, noise: { rankable_zips: 1, reporting_zips: 1, rankable_n_implied: 1 },
  generated_utc: tag, redfin: { period_end: "2026-08-31", period_begin: "2026-06-01" },
  zhvi: { period_end: "2026-08-31" }, assets: { snapshot: "zip-data.json" },
});
const buffer = (tag: string) => Object.assign(new ArrayBuffer(1), { tag });

function Where() {
  return <span data-testid="where">{useLocation().search}</span>;
}

async function mount(search = "") {
  window.history.replaceState(null, "", `/${search}`);
  vi.resetModules();
  const { HousingDashboard } = await import("../HousingDashboard");
  return render(<MemoryRouter initialEntries={[`/${search}`]}><HousingDashboard /><Where /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  m.isMobile = false;
  m.processData.mockImplementation(() => new Promise(() => {}));
  m.boot.mockResolvedValue({ manifest: manifest("live"), paint: buffer("zhvi"), metric: "zhvi" });
});
afterEach(() => {
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

function snapshot() {
  return {
    header: { built_utc: "live", f: [], z: ["00501", "10001", "90210"], dicts: {}, scales: {} },
    buffers: {},
  };
}

function search(zip: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "Search for ZIP code" }), { target: { value: zip } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
}

function expectSelection(zip: string) {
  expect(screen.getByTestId("map").dataset.selected).toBe(zip);
  expect(screen.getByTestId("details")).toHaveTextContent(zip);
  expect(new URLSearchParams(screen.getByTestId("where").textContent!).get("zip")).toBe(zip);
}

describe("HousingDashboard", () => {
  it("moves the highlight from the searched ZIP to the clicked detail ZIP", async () => {
    m.processData.mockResolvedValue(snapshot());
    await mount();
    await waitFor(() => expect(m.processData).toHaveBeenCalled());
    search("501");
    expectSelection("00501");
    fireEvent.click(screen.getByText("map 10001"));
    expectSelection("10001");
    expect(screen.getByTestId("map").dataset.search).toBe("00501");
    search("99999");
    expectSelection("10001");
    expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "No data for ZIP 99999" }));
  });

  it("keeps the primary ZIP selected when searching or clicking in compare mode", async () => {
    m.processData.mockResolvedValue(snapshot());
    await mount();
    await waitFor(() => expect(m.processData).toHaveBeenCalled());
    search("10001");
    fireEvent.click(screen.getByText("toggle compare"));
    search("90210");
    expectSelection("10001");
    expect(screen.getByTestId("details").dataset.compare).toBe("90210");
    fireEvent.click(screen.getByText("map 00501"));
    expectSelection("10001");
    expect(screen.getByTestId("details").dataset.compare).toBe("00501");
    fireEvent.click(screen.getByText("toggle compare"));
    expectSelection("10001");
  });

  it.each([false, true])("clears selection on close and cannot restore it through a delayed pan (mobile=%s)", async mobile => {
    m.isMobile = mobile;
    m.processData.mockResolvedValue(snapshot());
    m.fetchPaint.mockResolvedValue(buffer("median_sale_price"));
    await mount("?metric=zhvi&keep=1");
    await waitFor(() => expect(m.processData).toHaveBeenCalled());
    search("00501");
    fireEvent.click(screen.getByText("toggle compare"));
    fireEvent.click(screen.getByText("map 90210"));
    vi.useFakeTimers();
    fireEvent.click(screen.getByText("pan map"));
    fireEvent.click(screen.getByText(mobile ? "dismiss sheet" : "close details"));
    expect(screen.queryByTestId("details")).toBeNull();
    expect(screen.getByTestId("map").dataset.selected).toBe("");
    expect(screen.getByTestId("map").dataset.search).toBe("");
    act(() => vi.advanceTimersByTime(600));
    const params = new URLSearchParams(screen.getByTestId("where").textContent!);
    expect(params.has("zip")).toBe(false);
    expect(params.get("lat")).toBe("40");
    expect(params.get("keep")).toBe("1");
    await act(async () => { fireEvent.click(screen.getByText("switch")); });
    expect(screen.getByTestId("where").textContent).not.toContain("zip=");
    fireEvent.click(screen.getByText("map 10001"));
    expectSelection("10001");
    expect(screen.getByTestId("details").dataset.mode).toBe("detail");
    expect(screen.getByTestId("details").dataset.compare).toBe("");
  });

  it("restores a shared ZIP once details arrive and can search that same ZIP again", async () => {
    let resolve!: (value: ReturnType<typeof snapshot>) => void;
    m.processData.mockReturnValue(new Promise(r => { resolve = r; }));
    await mount("?zip=00501&metric=zhvi");
    await waitFor(() => expect(m.processData).toHaveBeenCalled());
    expect(screen.getByTestId("map").dataset.selected).toBe("");
    await act(async () => { resolve(snapshot()); });
    expectSelection("00501");
    const trigger = Number(screen.getByTestId("map").dataset.trigger);
    search("00501");
    expect(Number(screen.getByTestId("map").dataset.trigger)).toBeGreaterThan(trigger);
    fireEvent.click(screen.getByText("close details"));
    search("00501");
    expectSelection("00501");
  });

  it.each(["99999", "1e4", "not-a-zip"])("clears an unavailable or malformed shared ZIP: %s", async zip => {
    m.processData.mockResolvedValue(snapshot());
    await mount(`?zip=${zip}&metric=zhvi`);
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("?metric=zhvi"));
    expect(screen.getByTestId("map").dataset.selected).toBe("");
    expect(screen.queryByTestId("details")).toBeNull();
  });

  it("does not write a failed search to the URL before details load", async () => {
    await mount("?metric=zhvi");
    search("00501");
    expect(screen.getByTestId("where").textContent).toBe("?metric=zhvi");
    expect(screen.getByTestId("map").dataset.search).toBe("");
    expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Still loading ZIP details" }));
  });

  it("does not reopen a closed ZIP when the dashboard remounts without that URL parameter", async () => {
    m.processData.mockResolvedValue(snapshot());
    const view = await mount("?zip=00501&metric=zhvi");
    await waitFor(() => expectSelection("00501"));
    fireEvent.click(screen.getByText("close details"));
    view.unmount();
    window.history.replaceState(null, "", "/?metric=zhvi");
    const { HousingDashboard } = await import("../HousingDashboard");
    await act(async () => {
      render(<MemoryRouter initialEntries={["/?metric=zhvi"]}><HousingDashboard /><Where /></MemoryRouter>);
    });
    expect(screen.queryByTestId("details")).toBeNull();
    expect(screen.getByTestId("map").dataset.selected).toBe("");
  });

  it("keeps colors visible and offers retry when ZIP details fail", async () => {
    m.processData.mockRejectedValue(new Error("503"));
    await mount();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("ZIP details could not load"));
    expect(screen.getByTestId("map").dataset.painted).toBe("yes");
    const calls = m.processData.mock.calls.length;
    fireEvent.click(screen.getByText("Retry details"));
    await waitFor(() => expect(m.processData.mock.calls.length).toBeGreaterThan(calls));
  });

  it("refuses a snapshot from another release", async () => {
    m.processData.mockResolvedValue({ header: { built_utc: "older" }, buffers: {} });
    await mount();
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByTestId("map").dataset.painted).toBe("yes");
  });
  it("ignores a ?metric= that is not a painted metric and clears it from the URL", async () => {
    await mount("?metric=__proto__");
    expect(screen.getByTestId("metric").textContent).toBe("zhvi");
    await waitFor(() =>
      expect(new URLSearchParams(screen.getByTestId("where").textContent!).get("metric")).toBe("zhvi"),
    );
    await mount("?metric=zhvi_yoy");
    expect(screen.getAllByTestId("metric").at(-1)!.textContent).toBe("zhvi");
    await waitFor(() =>
      expect(new URLSearchParams(screen.getAllByTestId("where").at(-1)!.textContent!).get("metric")).toBe("zhvi"),
    );
  });

  it("recovers from a stale manifest by refetching it past the cache", async () => {
    m.boot.mockResolvedValue(null);
    m.fetchManifest.mockImplementation((fresh?: boolean) =>
      Promise.resolve(manifest(fresh ? "live" : "stale")));
    m.fetchPaint.mockImplementation((mf: { tag: string }) =>
      mf.tag === "stale" ? Promise.reject(new Error("404")) : Promise.resolve(buffer("zhvi")));

    await mount();
    await waitFor(() => expect(screen.getByTestId("map").dataset.painted).toBe("yes"));
    expect(m.fetchManifest).toHaveBeenCalledWith(true);
    expect(screen.queryByText("Unable to Load Data")).toBeNull();
  });

  it("goes back to the previous metric when the new one cannot load", async () => {
    await mount();
    await waitFor(() => expect(screen.getByTestId("map").dataset.painted).toBe("yes"));
    m.fetchManifest.mockResolvedValue(manifest("live"));
    m.fetchPaint.mockRejectedValue(new Error("offline"));

    await act(async () => { fireEvent.click(screen.getByText("switch")); });
    await waitFor(() => expect(m.toast).toHaveBeenCalled());
    expect(screen.getByTestId("metric").textContent).toBe("zhvi");
    expect(screen.getByTestId("map").dataset.painted).toBe("yes");
  });

  it("clears a shared link's view on reset, even before the map was touched", async () => {
    await mount("?metric=zhvi&lat=39.7392&lng=-104.9903&zoom=9");
    await act(async () => { fireEvent.click(screen.getByText("reset view")); });
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("?metric=zhvi"));
  });

  it("shows the error page only when the first paint fails", async () => {
    m.boot.mockResolvedValue(null);
    m.fetchManifest.mockRejectedValue(new Error("manifest.json returned 500"));
    await mount();
    await waitFor(() => expect(screen.getByText("Unable to Load Data")).toBeTruthy());
  });
});

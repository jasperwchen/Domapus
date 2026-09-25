import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

// The dashboard's own decisions are under test, not the map or the panels, so every child
// is a stub that shows the one prop that matters.
const m = vi.hoisted(() => ({
  boot: vi.fn(),
  fetchManifest: vi.fn(),
  fetchPaint: vi.fn(),
  toast: vi.fn(),
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
  useDataWorker: () => ({ processData: () => new Promise(() => {}), isLoading: false, progress: null }),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: m.toast }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("../MapLibreMap", () => ({
  MapLibreMap: ({ classSource, onMapMove }: {
    classSource: unknown;
    onMapMove: (loaded: () => string[], bounds: null, view: object, reset: boolean) => void;
  }) => (
    <div data-testid="map" data-painted={classSource ? "yes" : "no"}>
      <button onClick={() => onMapMove(() => [], null, { lat: 39.8, lng: -98.6, zoom: 3 }, true)}>
        reset view
      </button>
    </div>
  ),
}));
vi.mock("../TopBar", () => ({
  TopBar: ({ selectedMetric, onMetricChange }: { selectedMetric: string; onMetricChange: (x: string) => void }) => (
    <div>
      <span data-testid="metric">{selectedMetric}</span>
      <button onClick={() => onMetricChange("median_sale_price")}>switch</button>
    </div>
  ),
}));
vi.mock("../Legend", () => ({ Legend: () => null }));
vi.mock("../Sidebar", () => ({ Sidebar: () => null }));
vi.mock("../MobileBottomSheet", () => ({ MobileBottomSheet: () => null }));
vi.mock("@/components/MapExport", () => ({ MapExport: () => null }));

const manifest = (tag: string) => ({
  tag, classes: 14, noise: { rankable_zips: 1, reporting_zips: 1, rankable_n_implied: 1 },
});
const buffer = (tag: string) => Object.assign(new ArrayBuffer(1), { tag });

function Where() {
  return <span data-testid="where">{useLocation().search}</span>;
}

async function mount(search = "") {
  window.history.replaceState(null, "", `/${search}`);
  vi.resetModules();
  const { HousingDashboard } = await import("../HousingDashboard");
  render(<MemoryRouter initialEntries={[`/${search}`]}><HousingDashboard /><Where /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  m.boot.mockResolvedValue({ manifest: manifest("live"), paint: buffer("zhvi"), metric: "zhvi" });
});
afterEach(() => window.history.replaceState(null, "", "/"));

describe("HousingDashboard", () => {
  it("ignores a ?metric= that is not a painted metric", async () => {
    await mount("?metric=__proto__");
    expect(screen.getByTestId("metric").textContent).toBe("zhvi");
    await mount("?metric=zhvi_yoy");
    expect(screen.getAllByTestId("metric").at(-1)!.textContent).toBe("zhvi");
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

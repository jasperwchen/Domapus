import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const INDEX = {
  bucket_depth: 4, periods: ["2026-07-31"], zhvi_months: ["2026-07-31"],
  scales: { sig: 10000 }, horizons: [12], q: { "12": { "80": [-1, 1] } }, notes: {}, buckets: ["0100"],
};
const BUCKET = { bucket: "0100", zips: { "01001": { msp: [300000] }, "01002": { msp: [400000] } } };

const json = (body: unknown, ok = true) =>
  Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);

let fetchMock: ReturnType<typeof vi.fn>;
let history: typeof import("../history");

beforeEach(async () => {
  vi.resetModules();
  fetchMock = vi.fn((url: string) =>
    url.endsWith("index.json") ? json(INDEX) : url.endsWith("0100.json") ? json(BUCKET) : json(null, false));
  vi.stubGlobal("fetch", fetchMock);
  history = await import("../history");
});

afterEach(() => vi.unstubAllGlobals());

const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));

describe("loadHistory", () => {
  it("keeps the leading zero when picking the bucket", async () => {
    const r = await history.loadHistory("01001");
    expect(r?.series.msp).toEqual([300000]);
    expect(urls().some((u) => u.endsWith("history/0100.json"))).toBe(true);
  });

  it("serves a neighbour from the bucket already fetched", async () => {
    await history.loadHistory("01001");
    await history.loadHistory("01002");
    expect(urls().filter((u) => u.endsWith("0100.json"))).toHaveLength(1);
  });

  it("retries the index after a failed fetch instead of caching the failure", async () => {
    fetchMock.mockImplementationOnce(() => json(null, false));
    expect(await history.loadHistory("01001")).toBeNull();
    expect((await history.loadHistory("01001"))?.series.msp).toEqual([300000]);
  });

  it("retries a bucket after a failed fetch", async () => {
    fetchMock.mockImplementation((url: string) =>
      url.endsWith("index.json") ? json(INDEX) : json(null, false));
    expect(await history.loadHistory("01001")).toBeNull();
    fetchMock.mockImplementation((url: string) =>
      url.endsWith("index.json") ? json(INDEX) : json(BUCKET));
    expect((await history.loadHistory("01001"))?.series.msp).toEqual([300000]);
  });
});

describe("forecastBand", () => {
  it("scales the band by the ZIP's own sigma on the log scale", () => {
    const band = history.forecastBand(INDEX as never, { f: [100], sig: 1000 }, 0, "80");
    expect(band?.point).toBe(100);
    expect(band?.lo).toBeCloseTo(100 * Math.exp(-0.1));
    expect(band?.hi).toBeCloseTo(100 * Math.exp(0.1));
  });
});

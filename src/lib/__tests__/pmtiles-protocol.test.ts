import { describe, it, expect, vi } from "vitest";
import type { RequestParameters } from "maplibre-gl";
import { shareTileFetches } from "../pmtiles-protocol";

const tile = (url: string) => ({ url, type: "arrayBuffer" }) as RequestParameters;

function deferredLoad() {
  // pmtiles resolves with a Uint8Array, not an ArrayBuffer.
  const calls: { controller: AbortController; resolve: (b: Uint8Array) => void }[] = [];
  const load = vi.fn((_p: RequestParameters, controller: AbortController) =>
    new Promise<{ data: Uint8Array }>((resolve, reject) => {
      controller.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      calls.push({ controller, resolve: (data) => resolve({ data }) });
    }));
  return { load, calls };
}

describe("shareTileFetches", () => {
  it("fetches a tile once for two sources and gives each its own bytes", async () => {
    const { load, calls } = deferredLoad();
    const fetchTile = shareTileFetches(load);
    const a = fetchTile(tile("pmtiles://t/4/3/5"), new AbortController());
    const b = fetchTile(tile("pmtiles://t/4/3/5"), new AbortController());
    calls[0].resolve(new Uint8Array([1, 2, 3]));
    const [ra, rb] = await Promise.all([a, b]);
    expect(load).toHaveBeenCalledTimes(1);
    const da = ra.data as Uint8Array;
    const db = rb.data as Uint8Array;
    expect(da.buffer).not.toBe(db.buffer);
    // MapLibre transfers each caller's buffer to a worker; the other copy must survive it.
    structuredClone(da.buffer, { transfer: [da.buffer] });
    expect(db).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("keeps fetching while any caller still wants the tile", async () => {
    const { load, calls } = deferredLoad();
    const fetchTile = shareTileFetches(load);
    const abortA = new AbortController();
    const a = fetchTile(tile("pmtiles://t/4/3/5"), abortA);
    const b = fetchTile(tile("pmtiles://t/4/3/5"), new AbortController());
    a.catch(() => {});
    abortA.abort();
    expect(calls[0].controller.signal.aborted).toBe(false);
    calls[0].resolve(new Uint8Array(4));
    await expect(b).resolves.toBeDefined();
  });

  it("aborts the fetch when every caller has aborted, and refetches afterwards", async () => {
    const { load, calls } = deferredLoad();
    const fetchTile = shareTileFetches(load);
    const abortA = new AbortController();
    const abortB = new AbortController();
    fetchTile(tile("pmtiles://t/4/3/5"), abortA).catch(() => {});
    fetchTile(tile("pmtiles://t/4/3/5"), abortB).catch(() => {});
    abortA.abort();
    abortB.abort();
    expect(calls[0].controller.signal.aborted).toBe(true);
    fetchTile(tile("pmtiles://t/4/3/5"), new AbortController());
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not share TileJSON requests", () => {
    const { load } = deferredLoad();
    const fetchTile = shareTileFetches(load);
    const json = { url: "pmtiles://t", type: "json" } as RequestParameters;
    fetchTile(json, new AbortController());
    fetchTile(json, new AbortController());
    expect(load).toHaveBeenCalledTimes(2);
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { takeSnapshotPrefetch, boot } from "@/lib/manifest";

// The snapshot buffer index.html prefetches is TRANSFERRED to the worker, which
// detaches it. Reading it twice hands postMessage a detached buffer and it throws
// DataCloneError, leaving the map on its loading state forever.
//
// This only became reachable when the methodology page became a client-side
// route: browser Back out of it remounts HousingDashboard against the same window
// instead of loading a fresh document. Nothing in the types says "once", so it is
// asserted here.

type W = Record<string, unknown>;
const w = window as unknown as W;

beforeEach(() => {
  w.__zipDataPromise = undefined;
  w.__domapusBoot = undefined;
});

describe("takeSnapshotPrefetch", () => {
  it("hands the buffer over on the first read", async () => {
    const buf = new ArrayBuffer(1024);
    w.__zipDataPromise = Promise.resolve(buf);
    expect(await takeSnapshotPrefetch()).toBe(buf);
  });

  it("returns null on the second read, so the caller fetches the URL instead", async () => {
    w.__zipDataPromise = Promise.resolve(new ArrayBuffer(1024));
    await takeSnapshotPrefetch();
    expect(await takeSnapshotPrefetch()).toBeNull();
  });

  it("clears the handle before awaiting, so two mounts in one tick cannot both take it", async () => {
    w.__zipDataPromise = Promise.resolve(new ArrayBuffer(1024));
    const [first, second] = await Promise.all([takeSnapshotPrefetch(), takeSnapshotPrefetch()]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
  });

  // A transferred buffer stays reachable and reports byteLength 0. jsdom does not
  // implement transfer, so an empty buffer stands in for the detached one.
  it("treats a detached buffer as absent rather than passing it on", async () => {
    w.__zipDataPromise = Promise.resolve(new ArrayBuffer(0));
    expect(await takeSnapshotPrefetch()).toBeNull();
  });

  it("returns null when index.html never started a prefetch", async () => {
    expect(await takeSnapshotPrefetch()).toBeNull();
  });

  it("returns null when the prefetch failed", async () => {
    w.__zipDataPromise = Promise.resolve(null);
    expect(await takeSnapshotPrefetch()).toBeNull();
  });
});

describe("boot", () => {
  // The opposite contract, and the reason the two are separate functions:
  // PaintTable.from takes a view over this buffer rather than consuming it, which
  // the metric-change path has always relied on.
  it("survives repeated reads, unlike the snapshot prefetch", async () => {
    const payload = { manifest: {}, paint: new ArrayBuffer(8), metric: "zhvi" };
    w.__domapusBoot = Promise.resolve(payload);
    expect(await boot()).toBe(payload);
    expect(await boot()).toBe(payload);
  });

  it("returns null when index.html skipped the boot, as it does on /methodology", async () => {
    expect(await boot()).toBeNull();
  });
});

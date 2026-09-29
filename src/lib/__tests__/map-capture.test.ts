import { afterEach, describe, expect, it, vi } from "vitest";
import { captureMapCanvas } from "../map-capture";

function fakeMap() {
  const handlers = new Map<string, Set<() => void>>();
  const map = {
    on: (event: string, callback: () => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(callback);
    },
    off: (event: string, callback: () => void) => handlers.get(event)?.delete(callback),
    emit: (event: string) => [...handlers.get(event) ?? []].forEach(callback => callback()),
    loaded: () => true, isStyleLoaded: () => true, triggerRepaint: vi.fn(),
    getCanvas: () => document.createElement("canvas"),
    listenerCount: () => [...handlers.values()].reduce((n, set) => n + set.size, 0),
  };
  return map;
}

afterEach(() => vi.useRealTimers());

describe("map capture", () => {
  it("keeps the timeout active until the final render and removes all listeners", async () => {
    vi.useFakeTimers();
    const map = fakeMap();
    const assertion = expect(captureMapCanvas(map as never)).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    expect(map.listenerCount()).toBe(0);
  });

  it.each(["error", "remove"])("rejects on %s instead of returning an incomplete canvas", async event => {
    const map = fakeMap();
    const assertion = expect(captureMapCanvas(map as never)).rejects.toThrow();
    map.emit(event);
    await assertion;
    expect(map.listenerCount()).toBe(0);
  });

  it("captures only after the render", async () => {
    const map = fakeMap();
    const promise = captureMapCanvas(map as never);
    map.emit("render");
    expect(await promise).toBeInstanceOf(HTMLCanvasElement);
    expect(map.listenerCount()).toBe(0);
  });
});

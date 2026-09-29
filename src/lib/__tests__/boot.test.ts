// @vitest-environment node
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, expect, it, vi } from "vitest";

const html = readFileSync("index.html", "utf8");
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map(match => match[1]).find(source => source.includes("__domapusBoot"))!
  .replace(/%VITE_DATA_BASE%/g, "./data/")
  .replace(/%VITE_PAINT_MAP%/g, '{"zhvi":"paint/current.u8"}')
  .replace(/%VITE_SNAPSHOT_FILE%/g, "zip-data.json");

function start(fetch: unknown) {
  const window: { __domapusBoot?: Promise<unknown>; __zipDataPromise?: Promise<unknown> } = {};
  runInNewContext(script, {
    window, fetch, URL, URLSearchParams, document: { baseURI: "https://example.com/" },
    location: { search: "", pathname: "/" },
    AbortSignal: { timeout(ms: number) {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), ms);
      return controller.signal;
    } },
  });
  return window;
}
afterEach(() => vi.useRealTimers());

it("rejects a boot manifest naming a different paint file", async () => {
  vi.useFakeTimers();
  const window = start(vi.fn(async () => ({ ok: true,
    json: async () => ({ assets: { paint: { zhvi: { file: "paint/new.u8" } } } }),
    arrayBuffer: async () => new ArrayBuffer(1),
  })));
  expect(await window.__domapusBoot).toBeNull();
});

it("bounds stalled boot and snapshot requests", async () => {
  vi.useFakeTimers();
  const window = start(vi.fn((_url, { signal }: { signal: AbortSignal }) =>
    new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(Error("timeout"))))));
  await vi.advanceTimersByTimeAsync(30_000);
  expect(await window.__domapusBoot).toBeNull();
  await vi.advanceTimersByTimeAsync(90_000);
  expect(await window.__zipDataPromise).toBeNull();
});

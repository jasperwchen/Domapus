// Performance instrumentation. Lands FIRST, alone, changing no behavior.
//
// Until this existed there was zero instrumentation in src/ — `performance.mark`
// appeared nowhere — so every performance claim about the live site was
// unfalsifiable, and bench/run.mjs warned "no performance.measure marks — build
// is uninstrumented" on every run.
//
// Everything here is a no-op when the API is missing, and every call is wrapped:
// the User Timing buffer can fill, and a thrown mark must never take the page
// down with it.

export const PERF =
  typeof performance !== "undefined" && typeof performance.mark === "function";

export function mark(name: string): void {
  if (!PERF) return;
  try {
    performance.mark(name);
  } catch {
    /* buffer exhausted — instrumentation must never break the page */
  }
}

/** Measure from `start` to now. Returns ms, or null when unavailable. */
export function measure(name: string, start: string, detail?: unknown): number | null {
  if (!PERF) return null;
  try {
    return performance.measure(name, { start, detail })?.duration ?? null;
  } catch {
    return null;
  }
}

/** Measure a synchronous span. Returns whatever `fn` returns. */
export function span<T>(name: string, fn: () => T, detail?: unknown): T {
  if (!PERF) return fn();
  const start = `${name}:start`;
  mark(start);
  try {
    return fn();
  } finally {
    measure(name, start, detail);
  }
}

/**
 * A monotonically increasing counter surfaced as zero-duration measures, so the
 * benchmark harness can read it out of the User Timing buffer like anything else.
 *
 * `map:sourceReload` is the regression tripwire for the whole choropleth fix: it
 * must be 0 after setup. Any non-zero value means something called
 * setPaintProperty on a data-driven value, which makes MapLibre re-send every
 * loaded tile to its worker, re-parse the cached PBF, rebuild the fill bucket
 * and re-upload the GPU buffers.
 */
const counters = new Map<string, number>();

export function count(name: string, by = 1): number {
  const next = (counters.get(name) ?? 0) + by;
  counters.set(name, next);
  if (PERF) {
    try {
      performance.measure(name, { start: performance.now(), detail: { count: next } });
    } catch {
      /* ignore */
    }
  }
  return next;
}

export function counterValue(name: string): number {
  return counters.get(name) ?? 0;
}

// Exposed for the benchmark harness and for hand-checking in a console. Reading
// a counter must never require a rebuild.
declare global {
  interface Window {
    __domapusPerf?: { counterValue: (name: string) => number };
  }
}
if (typeof window !== "undefined") {
  window.__domapusPerf = { counterValue };
}

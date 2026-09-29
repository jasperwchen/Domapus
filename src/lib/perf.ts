// User Timing wrappers. No-ops without the API, and never throw (the buffer can fill).

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

let switchSequence = 0;
let pendingSwitch: { id: number; metric: string; start: string } | null = null;

export function beginMetricSwitch(metric: string): void {
  if (pendingSwitch && PERF) performance.clearMarks(pendingSwitch.start);
  const id = ++switchSequence;
  pendingSwitch = { id, metric, start: `map:metricSwitch:${id}` };
  mark(pendingSwitch.start);
}

export function metricSwitchTicket(metric: string): number | null {
  return pendingSwitch?.metric === metric ? pendingSwitch.id : null;
}

export function finishMetricSwitch(ticket: number | null): void {
  if (!pendingSwitch || pendingSwitch.id !== ticket) return;
  measure("map:metricSwitch", pendingSwitch.start, { metric: pendingSwitch.metric });
  pendingSwitch = null;
}

/** Entries kept per measure name. Every auto-scale re-cut adds a few, so an unbounded buffer
 *  grows for the life of a tab. The bench reads a whole metric cycle back, which is well
 *  under this, so only the oldest go. */
const KEEP_PER_NAME = 100;

function trim(name: string): void {
  const entries = performance.getEntriesByName(name, "measure") as PerformanceMeasure[];
  if (entries.length <= 2 * KEEP_PER_NAME) return;
  const kept = entries.slice(-KEEP_PER_NAME);
  performance.clearMeasures(name);
  for (const e of kept) {
    performance.measure(name, { start: e.startTime, duration: e.duration, detail: e.detail });
  }
}

/** Measure from `start` to now, then drop the start mark. Returns ms, or null when unavailable. */
export function measure(name: string, start: string, detail?: unknown): number | null {
  if (!PERF) return null;
  try {
    const duration = performance.measure(name, { start, detail })?.duration ?? null;
    performance.clearMarks(start);
    trim(name);
    return duration;
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

/** Counters surfaced as zero-duration measures for the bench. `map:sourceReload` must stay 0. */
const counters = new Map<string, number>();

export function count(name: string, by = 1): number {
  const next = (counters.get(name) ?? 0) + by;
  counters.set(name, next);
  if (PERF) {
    try {
      performance.measure(name, { start: performance.now(), detail: { count: next } });
      trim(name);
    } catch {
      /* ignore */
    }
  }
  return next;
}

export function counterValue(name: string): number {
  return counters.get(name) ?? 0;
}

declare global {
  interface Window {
    __domapusPerf?: { counterValue: (name: string) => number };
  }
}
if (typeof window !== "undefined") {
  window.__domapusPerf = { counterValue };
}

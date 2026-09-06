// Per-ZIP time series, fetched on click (spec §4.4). Progressive enhancement: nothing on
// the critical path reads this, and every failure path returns null rather than throwing, so
// a dead network costs the chart and nothing else in the sidebar.
//
// Two fetches on the first click — the shared index (axes, quantile table, series notes) and
// the ZIP's bucket — then one small fetch per click after that. Both are cached for the
// lifetime of the page.

import { dataUrl } from "./data-url";

export interface SeriesNote {
  /** First period of a genuine in-panel discontinuity, or null for a restatement. */
  at: string | null;
  note: string;
}

export interface HistoryIndex {
  bucket_depth: number;
  /** Redfin period ends, ascending. Measured per release — never assume a length. */
  periods: string[];
  /** ZHVI months, ascending. */
  zhvi_months: string[];
  scales: Record<string, number>;
  horizons: number[];
  /** q[horizon][level] = [lo, hi] in units of the ZIP's own residual sigma. */
  q: Record<string, Record<string, [number, number]>>;
  notes: Record<string, SeriesNote>;
  buckets: string[];
}

export interface ZipHistory {
  msp?: (number | null)[];
  hs?: (number | null)[];
  zhvi?: (number | null)[];
  /** Forecast level at each of index.horizons, in whole dollars. */
  f?: (number | null)[];
  /** Residual sigma, scaled by index.scales.sig. */
  sig?: number;
}

export interface HistoryResult {
  index: HistoryIndex;
  series: ZipHistory;
}

let indexPromise: Promise<HistoryIndex | null> | null = null;
const buckets = new Map<string, Promise<Record<string, ZipHistory> | null>>();

async function getJson<T>(file: string): Promise<T | null> {
  try {
    const res = await fetch(dataUrl(file));
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function loadIndex(): Promise<HistoryIndex | null> {
  if (!indexPromise) {
    indexPromise = getJson<HistoryIndex>("history/index.json").then((idx) => {
      // A bad index is worse than no index: it would produce a chart with the wrong x-axis.
      if (!idx || !Array.isArray(idx.periods) || !Array.isArray(idx.zhvi_months)) return null;
      return idx;
    });
  }
  return indexPromise;
}

function loadBucket(name: string): Promise<Record<string, ZipHistory> | null> {
  let p = buckets.get(name);
  if (!p) {
    p = getJson<{ zips: Record<string, ZipHistory> }>(`history/${name}.json`)
      .then((b) => b?.zips ?? null);
    buckets.set(name, p);
  }
  return p;
}

export async function loadHistory(zip: string): Promise<HistoryResult | null> {
  const index = await loadIndex();
  if (!index) return null;
  // Slice from the zero-padded string. A numeric ZIP would drop the leading zero and send
  // every New England and Puerto Rico lookup to a 404.
  const zips = await loadBucket(zip.slice(0, index.bucket_depth));
  const series = zips?.[zip];
  if (!series) return null;
  return { index, series };
}

/**
 * The forecast band at one horizon, in level units.
 *
 * `q` is published in sigma units so the client can reconstruct any confidence level with two
 * multiplies and an exp, rather than the pipeline shipping a band per level. The arithmetic is
 * in log space because the model is an AR(1) on log growth.
 */
export function forecastBand(
  index: HistoryIndex,
  series: ZipHistory,
  horizonIdx: number,
  level: string,
): { point: number; lo: number; hi: number } | null {
  const point = series.f?.[horizonIdx];
  if (point == null || series.sig == null) return null;
  const h = String(index.horizons[horizonIdx]);
  const q = index.q?.[h]?.[level];
  if (!q) return null;
  const sigma = series.sig / (index.scales.sig ?? 10000);
  return { point, lo: point * Math.exp(q[0] * sigma), hi: point * Math.exp(q[1] * sigma) };
}

/** Confidence levels the slider offers, in the order the pipeline publishes them. */
export function levelsOf(index: HistoryIndex): string[] {
  const first = index.horizons?.[0];
  const table = first == null ? undefined : index.q?.[String(first)];
  return table ? Object.keys(table).sort((a, b) => Number(a) - Number(b)) : [];
}

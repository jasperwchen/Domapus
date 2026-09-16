// `manifest.json`, plus the handoff from the boot script in index.html, which starts the
// manifest and paint fetches before the bundle parses.

import { dataUrl } from "./data-url";

export interface PaintAsset {
  file: string;
  bytes: number;
  sha256: string;
  zips_set: number;
  max_byte: number;
  fade_exempt: boolean;
}

export interface Manifest {
  generated_utc: string;
  classes: number;
  redfin: { period_end: string | null; period_begin: string | null; vintage: string };
  zhvi: { period_end: string | null };
  assets: { paint: Record<string, PaintAsset>; snapshot: string };
  /** `break_gate`: `rankable` for estimates, `all_reporting` for exact counts. */
  classing: Record<string, {
    scheme: string; breaks: number[]; class_counts: number[];
    break_gate?: string | null;
  }>;
  noise: {
    K: number;
    rankable_rse: number;
    rankable_n_implied: number;
    rankable_zips: number;
    reporting_zips: number;
    tiers: Record<string, number>;
  };
  /** ZCTA counts by reporting source. `no_data` areas are drawn grey, distinct from zero. */
  coverage?: {
    both?: number;
    redfin_only?: number;
    zhvi_only?: number;
    no_data?: number;
  } & Record<string, unknown>;
  spatial?: {
    /** LISA class -> ZIP count (`ns`, `HH`, `LL`, `LH`, `HL`). */
    class_counts?: Record<string, number>;
  } & Record<string, unknown>;
  forecast?: Record<string, unknown>;
}

/** LH + HL outlier count, or null when the spatial stage did not run. */
export function outlierCount(mf: Manifest | null): number | null {
  const c = mf?.spatial?.class_counts;
  if (!c) return null;
  return (c.LH ?? 0) + (c.HL ?? 0);
}

interface BootPayload {
  manifest: Manifest;
  paint: ArrayBuffer;
  metric: string;
}

/** The boot fetch, if it succeeded. Safe to read repeatedly: `PaintTable.from` does not consume the buffer. */
export function boot(): Promise<BootPayload | null> {
  const w = window as unknown as Record<string, unknown>;
  const p = w.__domapusBoot as Promise<BootPayload | null> | undefined;
  return p ?? Promise.resolve(null);
}

/** The prefetched snapshot, handed over exactly once. The buffer is transferred to the
 *  worker and detached, and the dashboard remounts on Back from /methodology; a second reader
 *  would post a detached buffer and hang. Returns null so the caller fetches the URL. */
export function takeSnapshotPrefetch(): Promise<ArrayBuffer | null> {
  const w = window as unknown as Record<string, unknown>;
  const p = w.__zipDataPromise as Promise<ArrayBuffer | null> | undefined;
  w.__zipDataPromise = undefined;
  return p ? p.then((buf) => (buf && buf.byteLength > 0 ? buf : null)) : Promise.resolve(null);
}

export function fetchManifest(): Promise<Manifest> {
  return fetch(dataUrl("manifest.json")).then((r) => {
    if (!r.ok) throw new Error(`manifest.json returned ${r.status}`);
    return r.json() as Promise<Manifest>;
  });
}

/** Fetch one metric's paint table. Used on a metric change, not at boot. */
export function fetchPaint(manifest: Manifest, metric: string): Promise<ArrayBuffer> {
  const asset = manifest.assets?.paint?.[metric];
  if (!asset) throw new Error(`manifest declares no paint table for ${metric}`);
  return fetch(dataUrl(asset.file)).then((r) => {
    if (!r.ok) throw new Error(`${asset.file} returned ${r.status}`);
    return r.arrayBuffer();
  });
}

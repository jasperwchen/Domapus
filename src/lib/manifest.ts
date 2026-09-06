// `manifest.json` — the pointer file, and where the paint tables live.
//
// The boot script in index.html starts the manifest and paint-table fetches in
// the SAME TICK, and that is the whole reason the paint filenames are inlined at
// build time. Chaining them — fetch the manifest, read `assets.paint[metric]`,
// then fetch the table — serialises two round trips in front of a 24 KB download,
// which on slow 4G is ~600 ms of pure latency. "24 KB to first colour" would be
// true while the number that mattered was the latency.

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
  classing: Record<string, { scheme: string; breaks: number[]; class_counts: number[] }>;
  noise: {
    K: number;
    rankable_rse: number;
    rankable_n_implied: number;
    rankable_zips: number;
    reporting_zips: number;
    tiers: Record<string, number>;
  };
  spatial?: Record<string, unknown>;
  forecast?: Record<string, unknown>;
}

interface BootPayload {
  manifest: Manifest;
  paint: ArrayBuffer;
  metric: string;
}

/** What index.html kicked off before the bundle parsed, if it succeeded. */
export function boot(): Promise<BootPayload | null> {
  const w = window as unknown as Record<string, unknown>;
  const p = w.__domapusBoot as Promise<BootPayload | null> | undefined;
  return p ?? Promise.resolve(null);
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

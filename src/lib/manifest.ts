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
  /** `break_gate` says which ZIPs were allowed to SET the boundaries: `rankable`
   *  for an estimated statistic, `all_reporting` for an exact count. Auto-scale
   *  has to reproduce that gate or it re-cuts on a different population. */
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
  /** ZCTAs by which sources report them. `no_data` areas ARE drawn — in grey —
   *  and are not the same as an area with a value of zero. */
  coverage?: {
    both?: number;
    redfin_only?: number;
    zhvi_only?: number;
    no_data?: number;
  } & Record<string, unknown>;
  spatial?: {
    /** LISA class -> ZIP count. Keys are `ns`, `HH`, `LL`, `LH`, `HL`. Only the
     *  last two are shown on the map; see `choropleth-painter.OUTLIER_COLORS`. */
    class_counts?: Record<string, number>;
  } & Record<string, unknown>;
  forecast?: Record<string, unknown>;
}

/** How many ZIPs break their neighbourhood's price pattern, or null when the
 *  spatial stage did not run. The legend labels its own toggle with this. */
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

/** What index.html kicked off before the bundle parsed, if it succeeded.
 *
 *  Safe to read repeatedly. `PaintTable.from` takes a view over the buffer and
 *  does not consume it, which the metric-change path has always relied on. */
export function boot(): Promise<BootPayload | null> {
  const w = window as unknown as Record<string, unknown>;
  const p = w.__domapusBoot as Promise<BootPayload | null> | undefined;
  return p ?? Promise.resolve(null);
}

/** The snapshot index.html started fetching, handed over exactly ONCE.
 *
 *  Unlike the paint table, this buffer is TRANSFERRED to the worker, which
 *  detaches it. A second reader gets a zero-length ArrayBuffer and postMessage
 *  refuses it outright: "ArrayBuffer at index 0 is already detached", and the
 *  map sits on its loading state forever.
 *
 *  There was no second reader until the methodology page became a client-side
 *  route. Every route change used to be a fresh document with a fresh prefetch;
 *  now browser Back out of that page remounts the dashboard against the same
 *  window object, and it read the corpse of the buffer it had already given away.
 *
 *  Cleared before the await so two mounts in one tick cannot both take it, and a
 *  detached buffer resolves to null rather than being passed on. Either way the
 *  caller falls back to fetching the URL: one round trip slower, and correct. */
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

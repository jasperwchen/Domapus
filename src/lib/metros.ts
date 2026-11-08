import type { ZipTable } from "./zip-table";

export interface MetroIndex {
  /** Metro names, biggest market (homes sold) first. */
  names: readonly string[];
  zipsOf: ReadonlyMap<string, readonly string[]>;
}

/** Every metro in the snapshot and its member ZIPs. One pass over the `me` column. */
export function buildMetroIndex(store: ZipTable): MetroIndex {
  const zipsOf = new Map<string, string[]>();
  const sold = new Map<string, number>();
  for (let row = 0; row < store.n; row++) {
    const metro = store.stringAt("me", row);
    if (!metro) continue;
    let zips = zipsOf.get(metro);
    if (!zips) zipsOf.set(metro, (zips = []));
    zips.push(store.zips[row]);
    sold.set(metro, (sold.get(metro) ?? 0) + (store.valueAt("hs", row) ?? 0));
  }
  // Homes sold, not ZIP count: Pennsylvania cuts its metros into small ZIPs, and a count
  // ranked Pittsburgh above Chicago and Los Angeles.
  const names = [...zipsOf.keys()].sort(
    (a, b) => (sold.get(b) ?? 0) - (sold.get(a) ?? 0) || a.localeCompare(b),
  );
  return { names, zipsOf };
}

/** Names containing the query, earliest match first, then biggest market. */
export function matchMetros(names: readonly string[], query: string, limit = 8): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: { name: string; at: number; rank: number }[] = [];
  names.forEach((name, rank) => {
    const at = name.toLowerCase().indexOf(q);
    if (at >= 0) hits.push({ name, at, rank });
  });
  hits.sort((a, b) => a.at - b.at || a.rank - b.rank);
  return hits.slice(0, limit).map((h) => h.name);
}

/** Union of the members' polygon bounds (anchor points where a bbox is missing). */
export function metroBounds(
  store: ZipTable, zips: readonly string[],
): [[number, number], [number, number]] | null {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const { lng, lat } = store.anchors();
  for (const zip of zips) {
    const row = store.rowOf(zip);
    const b = store.boundsOf(row);
    const box = b ?? { west: lng[row], south: lat[row], east: lng[row], north: lat[row] };
    if (!Number.isFinite(box.west) || !Number.isFinite(box.south)) continue;
    w = Math.min(w, box.west); s = Math.min(s, box.south);
    e = Math.max(e, box.east); n = Math.max(n, box.north);
  }
  return Number.isFinite(w) ? [[w, s], [e, n]] : null;
}

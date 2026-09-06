// The snapshot as typed arrays, not as 33,771 objects.
//
// The old load path built one plain object per ZIP and structured-cloned the lot
// across the worker boundary. Measured: JSON.parse 67 ms, object rebuild 173 ms,
// structuredClone 238 ms — about 85% of the cost was the object graph, not the
// parse. This keeps each column as one Int32Array, transferred rather than copied,
// and materialises an object only when something actually needs one.
//
// `materialize(row)` is what keeps Sidebar, ZipComparison, the popup builder and
// PrintStage completely unchanged: they keep taking `ZipData`. A hover costs one
// object instead of 33,771 at load.

import type { ZipData } from "@/components/dashboard/map/types";
import { NULL_SENTINEL, ZIP_SPACE, type SnapshotHeader } from "./snapshot";
import { mark, measure } from "./perf";

/** Wire short name -> the `ZipData` field it populates.
 *
 *  Only names that differ are listed; anything absent keeps its wire name. The
 *  pipeline's `SNAPSHOT_COLUMNS` is the other half of this mapping and the two
 *  must change together. */
const FIELD_OF: Record<string, keyof ZipData> = {
  st: "state",
  ci: "city",
  co: "county",
  me: "metro",
  lat: "latitude",
  lng: "longitude",
  msp: "median_sale_price",
  ppsf: "median_ppsf",
  hs: "homes_sold",
  al: "active_listings",
  dom: "median_dom",
  abv: "sold_above_list",
  mos: "months_of_supply",
  mlp: "median_list_price",
  lppsf: "median_list_ppsf",
  ps: "pending_sales",
  nl: "new_listings",
  inv: "inventory",
  s2l: "avg_sale_to_list_ratio",
  om2: "off_market_in_two_weeks",
  msp_yoy: "median_sale_price_yoy",
  ppsf_yoy: "median_ppsf_yoy",
  hs_yoy: "homes_sold_yoy",
  al_yoy: "active_listings_yoy",
  dom_yoy_d: "median_dom_yoy",
  abv_yoy: "sold_above_list_yoy",
  mos_yoy_m: "months_of_supply_yoy",
  mlp_yoy: "median_list_price_yoy",
  lppsf_yoy: "median_list_ppsf_yoy",
  ps_yoy: "pending_sales_yoy",
  nl_yoy: "new_listings_yoy",
  inv_yoy: "inventory_yoy",
  s2l_yoy: "avg_sale_to_list_ratio_yoy",
  om2_yoy: "off_market_in_two_weeks_yoy",
};

/** The wire name for a `ZipData` field, for callers that think in metric keys. */
export const WIRE_OF: Record<string, string> = Object.fromEntries(
  Object.entries(FIELD_OF).map(([wire, field]) => [field, wire]),
);

export class ZipTable {
  readonly n: number;
  readonly zips: readonly string[];
  readonly header: SnapshotHeader;

  private readonly cols = new Map<string, Int32Array>();
  private readonly dicts = new Map<string, string[]>();
  private readonly scales = new Map<string, number>();
  private readonly sentinel: number;
  /** Perfect hash: the ZIP number IS the index. -1 where no such ZIP. */
  private readonly rowByZip: Int32Array;
  private recordCache: Record<string, ZipData> | null = null;

  private constructor(header: SnapshotHeader, cols: Map<string, Int32Array>) {
    this.header = header;
    this.n = header.z.length;
    this.zips = header.z;
    this.cols = cols;
    this.sentinel = header.null_sentinel ?? NULL_SENTINEL;
    for (const [k, v] of Object.entries(header.dicts)) this.dicts.set(k, v);
    for (const [k, v] of Object.entries(header.scales)) this.scales.set(k, v);

    this.rowByZip = new Int32Array(ZIP_SPACE).fill(-1);
    for (let i = 0; i < this.n; i++) this.rowByZip[+header.z[i]] = i;
  }

  static from(header: SnapshotHeader, buffers: Record<string, ArrayBuffer>): ZipTable {
    mark("store:construct:start");
    const cols = new Map<string, Int32Array>();
    for (const name of header.f) {
      const buf = buffers[name];
      if (!buf) throw new Error(`snapshot: no buffer for column ${name}`);
      const col = new Int32Array(buf);
      if (col.length !== header.z.length) {
        throw new Error(
          `snapshot: column ${name} has ${col.length} values for ${header.z.length} ZIPs`,
        );
      }
      cols.set(name, col);
    }
    const t = new ZipTable(header, cols);
    measure("store:construct", "store:construct:start", { zips: t.n, columns: header.f.length });
    return t;
  }

  /**
   * O(1), one array read. Measured over 200,000 probes against the alternatives:
   * `Map<string, number>` was 9.77 ms and a binary search on a sorted Int32Array
   * was 16.29 ms — the binary search is SLOWER because ~15 probes across 135 KB
   * miss cache, while this is a single indexed read.
   */
  rowOf(zip: string | number): number {
    const k = typeof zip === "number" ? zip : +zip;
    return Number.isInteger(k) && k >= 0 && k < ZIP_SPACE ? this.rowByZip[k] : -1;
  }

  has(zip: string): boolean {
    return this.rowOf(zip) >= 0;
  }

  /** Raw column, on its wire scale. For hot loops that do their own scaling. */
  col(name: string): Int32Array | undefined {
    return this.cols.get(name);
  }

  /** Descaled value, or null. `name` is the WIRE name. */
  valueAt(name: string, row: number): number | null {
    const a = this.cols.get(name);
    if (!a || row < 0) return null;
    const v = a[row];
    if (v === this.sentinel) return null;
    const s = this.scales.get(name) ?? 1;
    return s === 1 ? v : v / s;
  }

  stringAt(name: string, row: number): string | null {
    const d = this.dicts.get(name);
    const a = this.cols.get(name);
    if (!d || !a || row < 0) return null;
    const code = a[row];
    return code < 0 || code >= d.length ? null : d[code];
  }

  /** Descaled value by ZIP and wire name. Convenience for one-off reads. */
  value(zip: string, name: string): number | null {
    return this.valueAt(name, this.rowOf(zip));
  }

  /**
   * Real polygon bounds in degrees, or null. The snapshot ships the bbox as four
   * offsets from the anchor so the numbers stay small enough for int32; this is
   * where they become absolute again.
   */
  boundsOf(row: number): { west: number; south: number; east: number; north: number } | null {
    const lng = this.valueAt("lng", row);
    const lat = this.valueAt("lat", row);
    if (lng === null || lat === null) return null;
    const bw = this.valueAt("bw", row);
    const bs = this.valueAt("bs", row);
    const be = this.valueAt("be", row);
    const bn = this.valueAt("bn", row);
    if (bw === null || bs === null || be === null || bn === null) return null;
    return { west: lng + bw, south: lat + bs, east: lng + be, north: lat + bn };
  }

  /** Escape hatch: ONE object, on demand. Everything downstream keeps its types. */
  materialize(row: number): ZipData | null {
    if (row < 0 || row >= this.n) return null;
    const out: Record<string, unknown> = { zipCode: this.zips[row] };
    for (const name of this.header.f) {
      const field = FIELD_OF[name] ?? name;
      out[field as string] = this.dicts.has(name)
        ? this.stringAt(name, row)
        : this.valueAt(name, row);
    }
    // `period_end` is envelope-level now: every ZIP in the snapshot is from the
    // same period by construction, because the pipeline keeps only the newest.
    out.period_end = this.header.period_end;
    return out as unknown as ZipData;
  }

  get(zip: string): ZipData | null {
    return this.materialize(this.rowOf(zip));
  }

  /**
   * Export only, and memoized. Pays the ~173 ms object build on an explicit user
   * action instead of on every page load, which is the entire point of the store.
   */
  toRecord(): Record<string, ZipData> {
    if (this.recordCache) return this.recordCache;
    mark("store:materializeAll:start");
    const rec: Record<string, ZipData> = {};
    for (let i = 0; i < this.n; i++) {
      const row = this.materialize(i);
      if (row) rec[this.zips[i]] = row;
    }
    measure("store:materializeAll", "store:materializeAll:start", { zips: this.n });
    return (this.recordCache = rec);
  }
}

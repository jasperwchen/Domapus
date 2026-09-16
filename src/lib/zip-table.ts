// The snapshot as one Int32Array per column. `materialize(row)` builds a single `ZipData`
// on demand, so consumers keep their types without 33k objects at load.

import type { ZipData } from "@/components/dashboard/map/types";
import { NULL_SENTINEL, ZIP_SPACE, type SnapshotHeader } from "./snapshot";
import { mark, measure } from "./perf";

/** Widest plausible ZCTA bounding box, in degrees. See `ZipTable.checkBounds`. */
export const MAX_BBOX_SPAN_DEG = 10;

/** Wire name -> `ZipData` field, where they differ. Other half of `serialize.COLUMNS`. */
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
  /** bw, bs, be, bn and their scales, or null when absent or failing `checkBounds`.
   *  Held directly so hot loops skip the per-cell Map lookups. */
  private readonly bbox: {
    cols: [Int32Array, Int32Array, Int32Array, Int32Array];
    scales: [number, number, number, number];
  } | null;
  private anchorCache: { lng: Float64Array; lat: Float64Array } | null = null;

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

    this.bbox = this.checkBounds();
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

  /** O(1): the ZIP number is the index (faster than a Map or binary search, measured). */
  rowOf(zip: string | number): number {
    const k = typeof zip === "number" ? zip : +zip;
    return Number.isInteger(k) && k >= 0 && k < ZIP_SPACE ? this.rowByZip[k] : -1;
  }

  has(zip: string): boolean {
    return this.rowOf(zip) >= 0;
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

  /** Absolute polygon bounds in degrees (the wire carries offsets from the anchor),
   *  or null. Null for every ZIP when `checkBounds` failed. */
  boundsOf(row: number): { west: number; south: number; east: number; north: number } | null {
    if (!this.bbox || row < 0) return null;
    const [bw, bs, be, bn] = this.bbox.cols;
    const [sBw, sBs, sBe, sBn] = this.bbox.scales;
    const S = this.sentinel;
    const { lng, lat } = this.anchors();
    const x = lng[row];
    const y = lat[row];
    if (Number.isNaN(x) || Number.isNaN(y) || bw[row] === S || bs[row] === S || be[row] === S || bn[row] === S) {
      return null;
    }
    return { west: x + bw[row] / sBw, south: y + bs[row] / sBs, east: x + be[row] / sBe, north: y + bn[row] / sBn };
  }

  /** Anchor point per row in degrees, NaN where absent. Descaled once for per-row loops. */
  anchors(): { lng: Float64Array; lat: Float64Array } {
    if (!this.anchorCache) {
      const lng = new Float64Array(this.n);
      const lat = new Float64Array(this.n);
      for (let row = 0; row < this.n; row++) {
        lng[row] = this.valueAt("lng", row) ?? NaN;
        lat[row] = this.valueAt("lat", row) ?? NaN;
      }
      this.anchorCache = { lng, lat };
    }
    return this.anchorCache;
  }

  /**
   * A mis-scaled bbox is silent: one release shipped x1e8 under a x1e4 header, every
   * box spanned ~1,500 degrees, and auto-scale quietly sampled all loaded tiles.
   * The widest real ZCTA (99503) is 8.4 degrees, so a 10 degree ceiling cannot
   * false-trip and catches any scale error.
   */
  private checkBounds(): ZipTable["bbox"] {
    const names = ["bw", "bs", "be", "bn"] as const;
    const cols = names.map((n) => this.cols.get(n));
    if (cols.some((c) => !c)) return null;
    const bbox = {
      cols: cols as NonNullable<ZipTable["bbox"]>["cols"],
      scales: names.map((n) => this.scales.get(n) ?? 1) as NonNullable<ZipTable["bbox"]>["scales"],
    };
    const [bw, bs, be, bn] = bbox.cols;
    const [sBw, sBs, sBe, sBn] = bbox.scales;
    const S = this.sentinel;

    let maxSpan = 0;
    let worstRow = -1;
    for (let row = 0; row < this.n; row++) {
      if (bw[row] === S || bs[row] === S || be[row] === S || bn[row] === S) continue;
      const span = Math.max(be[row] / sBe - bw[row] / sBw, bn[row] / sBn - bs[row] / sBs);
      if (span > maxSpan) { maxSpan = span; worstRow = row; }
    }

    if (maxSpan > MAX_BBOX_SPAN_DEG) {
      console.error(
        `[ZipTable] bbox scale check failed: widest box is ${maxSpan.toFixed(1)} degrees at ZIP ` +
          `${this.zips[worstRow]} (ceiling ${MAX_BBOX_SPAN_DEG}). Auto-scale falls back to the national scale.`,
      );
      return null;
    }
    return bbox;
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
    out.period_end = this.header.period_end;
    return out as unknown as ZipData;
  }

  get(zip: string): ZipData | null {
    return this.materialize(this.rowOf(zip));
  }

  /** Every row as an object. Export only; memoized (~173 ms). */
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

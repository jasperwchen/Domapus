// The cross-language contract: Python wrote these bytes, TypeScript reads them.
//
// `tests/golden/*.json` are cut from a REAL pipeline run, not hand-written. A
// hand-written fixture only proves that two hand-written readers agree with each
// other; this proves the shipped encoder and the shipped decoder agree, and it
// fails the moment either side changes without the other.
//
// The fixture is chosen to contain the cases that actually break: leading-zero
// ZIPs, columns holding a real `0`, columns holding `null`, and at least one ZIP
// in the top reliability tier so the maximum legal byte 0x37 is exercised.

import { describe, it, expect } from "vitest";
import paintGolden from "../../../tests/golden/paint_50.json";
import snapshotGolden from "../../../tests/golden/snapshot_50.json";
import { PaintTable } from "../paint-table";
import { ZipTable } from "../zip-table";
import { CHOROPLETH_COLORS } from "../choropleth";
import { classify } from "../class-source";
import type { SnapshotHeader } from "../snapshot";

const snap = snapshotGolden as unknown as {
  format: "domapus-snapshot";
  version: number;
  null_sentinel: number;
  classes: number;
  scales: Record<string, number>;
  dicts: Record<string, string[]>;
  breaks: Record<string, number[]>;
  f: string[];
  z: string[];
  d: number[][];
};

const paint = paintGolden as unknown as {
  classes: number;
  zips: string[];
  bytes: Record<string, Record<string, number>>;
};

function buildStore(): ZipTable {
  const header: SnapshotHeader = {
    format: snap.format,
    version: snap.version,
    null_sentinel: snap.null_sentinel,
    built_utc: "",
    period_start: null,
    period_end: null,
    frequency: "Rolling 3 Months",
    vintage: "",
    zhvi_month: null,
    classes: snap.classes,
    dicts: snap.dicts,
    scales: snap.scales,
    breaks: snap.breaks,
    classing: {},
    f: snap.f,
    z: snap.z,
  };
  const buffers: Record<string, ArrayBuffer> = {};
  snap.f.forEach((name, j) => {
    buffers[name] = new Int32Array(snap.d[j]).buffer;
  });
  return ZipTable.from(header, buffers);
}

/** The fixture's sparse bytes, rehydrated into a full 100,000-byte table. */
function buildPaint(metric: string): PaintTable {
  const bytes = new Uint8Array(100_000);
  for (const [zip, b] of Object.entries(paint.bytes[metric])) bytes[+zip] = b;
  return PaintTable.from(bytes.buffer, metric, paint.classes, CHOROPLETH_COLORS.length);
}

// Wire name of each painted column, as `serialize.PAINTED_SHORT` maps it.
const PAINTED: Record<string, string> = {
  zhvi: "zhvi",
  median_sale_price: "msp",
  median_ppsf: "ppsf",
  homes_sold: "hs",
  active_listings: "al",
  median_dom: "dom",
  sold_above_list: "abv",
  months_of_supply: "mos",
  zhvi_yoy: "zhvi_yoy",
};

describe("golden fixture: the Python encoder and the TypeScript reader agree", () => {
  it("decodes the snapshot without losing leading zeros", () => {
    const store = buildStore();
    const leading = snap.z.filter((z) => z.startsWith("0"));
    expect(leading.length).toBeGreaterThan(0);
    for (const zip of leading) {
      expect(zip).toHaveLength(5);
      expect(store.rowOf(zip)).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps a real 0 distinct from a null", () => {
    const store = buildStore();
    const j = snap.f.indexOf("dom");
    const zeros = snap.z.filter((_, i) => snap.d[j][i] === 0);
    const nulls = snap.z.filter((_, i) => snap.d[j][i] === snap.null_sentinel);
    expect(zeros.length).toBeGreaterThan(0);
    expect(nulls.length).toBeGreaterThan(0);
    for (const zip of zeros) expect(store.value(zip, "dom")).toBe(0);
    for (const zip of nulls) expect(store.value(zip, "dom")).toBeNull();
  });

  it("applies every declared scale", () => {
    const store = buildStore();
    for (const name of snap.f) {
      expect(snap.scales[name]).toBeDefined();
    }
    // `mos` ships at x100. Decoded, it must be a plausible month count rather
    // than a raw 340 — this is the class of error a missing scale produces.
    const j = snap.f.indexOf("mos");
    const row = snap.z.findIndex((_, i) => snap.d[j][i] !== snap.null_sentinel);
    if (row >= 0) {
      expect(store.valueAt("mos", row)).toBeCloseTo(snap.d[j][row] / 100, 6);
    }
  });

  it("CROSS-ARTIFACT: the paint byte's class equals the snapshot's class", () => {
    // This is the fix for the two-class-authorities flaw, asserted from the
    // client side against the same bytes the pipeline asserted from its side.
    const store = buildStore();
    let compared = 0;

    for (const [metric, wire] of Object.entries(PAINTED)) {
      const table = buildPaint(metric);
      const breaks = snap.breaks[wire];
      expect(breaks, `no breaks shipped for ${wire}`).toBeDefined();
      expect(breaks).toHaveLength(snap.classes - 1);

      for (const zip of snap.z) {
        const value = store.value(zip, wire);
        const fromPaint = table.classOf(zip);
        if (value === null) {
          expect(fromPaint, `${metric} ${zip}`).toBe(-1);
          continue;
        }
        expect(fromPaint, `${metric} ${zip}`).toBe(classify(value, breaks));
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(100);
  });

  it("CROSS-ARTIFACT: the reliability nibble equals snapshot.rel, on every metric", () => {
    // Writable only because the nibble is metric-invariant: it carries the ZIP's
    // sale-sample tier, not a per-metric one. A per-metric encoder would fail
    // this on its first run.
    const store = buildStore();
    for (const metric of Object.keys(PAINTED)) {
      const table = buildPaint(metric);
      for (const zip of snap.z) {
        if (table.classOf(zip) < 0) continue;
        expect(table.reliabilityOf(zip), `${metric} ${zip}`).toBe(store.value(zip, "rel") ?? 0);
      }
    }
  });

  it("never emits a byte above the legal maximum 0x37", () => {
    for (const [metric, bytes] of Object.entries(paint.bytes)) {
      for (const [zip, b] of Object.entries(bytes)) {
        expect(b, `${metric} ${zip}`).toBeLessThanOrEqual(0x37);
        expect(b & 0xc0, `${metric} ${zip}: bits 6-7 are reserved`).toBe(0);
      }
    }
  });

  it("reconstructs real polygon bounds that contain their own anchor", () => {
    // The Bug 3 fix: the bbox ships as four offsets from the anchor so it fits
    // int32, and this is where it becomes absolute again. If the offsets were
    // int16 anywhere, Alaska's would have wrapped and this would fail.
    const store = buildStore();
    let checked = 0;
    for (let row = 0; row < store.n; row++) {
      const b = store.boundsOf(row);
      if (!b) continue;
      const lng = store.valueAt("lng", row)!;
      const lat = store.valueAt("lat", row)!;
      expect(b.east).toBeGreaterThan(b.west);
      expect(b.north).toBeGreaterThan(b.south);
      expect(lng).toBeGreaterThanOrEqual(b.west);
      expect(lng).toBeLessThanOrEqual(b.east);
      expect(lat).toBeGreaterThanOrEqual(b.south);
      expect(lat).toBeLessThanOrEqual(b.north);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});

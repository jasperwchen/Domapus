import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  CHUNK, ChoroplethPainter, classOpacityExpression, classPaintExpression,
} from "../choropleth-painter";
import { PaintTableSource, ViewportClassSource, classify } from "../class-source";
import { CHOROPLETH_COLORS, CLASSES, NO_DATA_COLOR } from "../choropleth";
import { PaintTable } from "../paint-table";
import { computeQuantileBuckets } from "../quantiles";
import { ZipTable } from "../zip-table";
import { NULL_SENTINEL } from "../snapshot";
import type { ZipData } from "@/components/dashboard/map/types";

// Encodes a paint table exactly the way `pipeline/paint.py` does, so these tests
// exercise the SHIPPED byte layout rather than a stand-in:
//   byte = (reliability_tier << 4) | (class_index + 1),  0 = no data for this ZIP.
function encodePaint(values: Record<string, number | null>, tier = 3) {
  const present = Object.values(values).filter((v): v is number => v !== null);
  const breaks = computeQuantileBuckets(present, CLASSES);
  const bytes = new Uint8Array(100_000);
  for (const [zip, v] of Object.entries(values)) {
    if (v === null) continue;
    bytes[+zip] = (tier << 4) | (classify(v, breaks) + 1);
  }
  return {
    table: PaintTable.from(bytes.buffer, "test", CLASSES, CHOROPLETH_COLORS.length),
    breaks,
  };
}

/** A `PaintTableSource` over `data`, the way the app builds one after a fetch. */
function sourceFor(data: Record<string, ZipData>, metric: keyof ZipData) {
  const values: Record<string, number | null> = {};
  for (const [zip, row] of Object.entries(data)) {
    const v = row[metric];
    values[zip] = typeof v === "number" ? v : null;
  }
  const { table, breaks } = encodePaint(values);
  return new PaintTableSource(table, breaks, Object.keys(data));
}

/** A minimal single-column `ZipTable`, for the viewport-scale tests. */
function storeFor(zips: string[], values: (number | null)[], scale = 1): ZipTable {
  const header = {
    format: "domapus-snapshot" as const, version: 3, null_sentinel: NULL_SENTINEL,
    built_utc: "", period_start: null, period_end: null, frequency: "Rolling 3 Months",
    vintage: "", zhvi_month: null, classes: CLASSES,
    dicts: {}, scales: { zhvi: scale }, breaks: {}, classing: {},
    f: ["zhvi"], z: zips,
  };
  const col = new Int32Array(values.map((v) => (v === null ? NULL_SENTINEL : v * scale)));
  return ZipTable.from(header, { zhvi: col.buffer });
}

// A MapLibre stand-in that behaves like the real thing in the two ways this
// test depends on: feature-state accumulates per feature id, and it is re-applied
// to tiles that load or are revived from the out-of-view cache. Both are what
// makes pan-away/pan-back correct under full-set writes and broken under scoped
// ones (tile_manager.ts calls SourceFeatureState.initializeTileState in each case).
function fakeMap() {
  const state = new Map<string, Record<string, unknown>>();
  const paintWrites: Array<[string, string, unknown]> = [];
  return {
    state,
    paintWrites,
    getLayer: () => ({}),
    getSource: () => ({}),
    isStyleLoaded: () => true,
    getZoom: () => 4,
    setFeatureState: (
      target: { id: string }, value: Record<string, unknown>,
    ) => {
      state.set(target.id, { ...(state.get(target.id) ?? {}), ...value });
    },
    setPaintProperty: (layer: string, prop: string, value: unknown) => {
      paintWrites.push([layer, prop, value]);
    },
    /** What the fill layer would evaluate to for one ZIP, given the constant
     *  `match` expression. This is the colour the user actually sees. */
    colorOf(zip: string): string {
      const expr = classPaintExpression();
      const k = (state.get(zip)?.k as number) ?? -1;
      for (let i = 2; i < expr.length - 1; i += 2) {
        if (expr[i] === k) return expr[i + 1] as string;
      }
      return expr[expr.length - 1] as string;
    },
  };
}

function makeData(n: number, valueFor: (i: number) => Partial<ZipData>) {
  const out: Record<string, ZipData> = {};
  for (let i = 0; i < n; i++) {
    const zip = String(10_000 + i).padStart(5, "0");
    out[zip] = { zipCode: zip, ...valueFor(i) } as ZipData;
  }
  return out;
}

// A faithful-enough rAF: callbacks queue and are drained on demand. Running them
// synchronously inside requestAnimationFrame would be wrong for the abort test —
// the painter guards on "a frame is already pending", so a stub that registers a
// frame it never runs would wedge it in a way a real browser never does.
let pending: FrameRequestCallback[] = [];
function drain(maxFrames = 100) {
  let n = 0;
  while (pending.length && n++ < maxFrames) {
    const batch = pending;
    pending = [];
    for (const cb of batch) cb(0);
  }
}

beforeEach(() => {
  pending = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    pending.push(cb);
    return pending.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

describe("the paint expression is constant", () => {
  it("has one branch per class plus a no-data fallback", () => {
    const expr = classPaintExpression();
    expect(expr[0]).toBe("match");
    expect(expr[expr.length - 1]).toBe(NO_DATA_COLOR);
    expect(expr).toHaveLength(2 + CHOROPLETH_COLORS.length * 2 + 1);
  });

  it("does not depend on the metric, the data, or the viewport", () => {
    // If this is ever false, something has to call setPaintProperty on a
    // data-driven value again, and every loaded tile is re-parsed and
    // re-uploaded on every metric change. That was 3375 ms per switch.
    expect(classPaintExpression()).toEqual(classPaintExpression());
    expect(classOpacityExpression()).toEqual(classOpacityExpression());
  });
});

describe("ChoroplethPainter", () => {
  it("writes every ZIP, not only the visible ones", () => {
    const data = makeData(50, (i) => ({ zhvi: 100_000 + i * 10_000 }));
    const map = fakeMap();
    new ChoroplethPainter(map as never).schedule(sourceFor(data, "zhvi"));
    drain();
    expect(map.state.size).toBe(50);
  });

  it("never rewrites a paint property", () => {
    const data = makeData(50, (i) => ({ zhvi: 100_000 + i * 10_000 }));
    const map = fakeMap();
    const painter = new ChoroplethPainter(map as never);
    painter.schedule(sourceFor(data, "zhvi"));
    drain();
    painter.schedule(sourceFor(data, "median_sale_price"));
    drain();
    // The regression tripwire. Any write here is a full source reload.
    expect(map.paintWrites).toHaveLength(0);
  });

  it("shows the correct class after switch, pan away, pan back", () => {
    // The failure this guards against: under writes scoped to what is on
    // screen, a metric change leaves stale feature-state for every off-screen
    // ZIP, so panning back silently shows the PREVIOUS metric's colours.
    const data = makeData(40, (i) => ({
      zhvi: 100_000 + i * 10_000,
      median_sale_price: 1_000_000 - i * 10_000, // deliberately inverted
    }));
    const map = fakeMap();
    const painter = new ChoroplethPainter(map as never);

    painter.schedule(sourceFor(data, "zhvi"));
    drain();
    const offscreen = "10000"; // lowest zhvi, so the lowest class
    expect(map.state.get(offscreen)!.k).toBe(0);

    // Switch metric while that ZIP is off screen.
    const swapped = sourceFor(data, "median_sale_price");
    painter.schedule(swapped);
    drain();

    // Pan back: MapLibre re-applies the accumulated feature-state to the revived
    // tile, so what it shows is whatever is in `state` now.
    expect(map.state.get(offscreen)!.k).toBe(swapped.classOf(offscreen));
    expect(map.state.get(offscreen)!.k).toBe(CLASSES - 1); // highest sale price
    expect(map.colorOf(offscreen)).toBe(CHOROPLETH_COLORS[CLASSES - 1]);
  });

  it("an aborted metric change never leaves half the old classing applied", () => {
    // Sized off CHUNK so the test keeps exercising the abort path if the frame
    // budget is retuned. Below CHUNK the first frame finishes and there is no
    // partial state to abort.
    const N = CHUNK + 5_000;
    const data = makeData(N, (i) => ({ zhvi: 1000 + i, median_sale_price: 2_000_000 - i }));
    const map = fakeMap();
    const painter = new ChoroplethPainter(map as never);

    // One frame only, so the first epoch is deliberately left half applied.
    painter.schedule(sourceFor(data, "zhvi"));
    drain(1);
    expect(map.state.size).toBeLessThan(N);
    expect(map.state.size).toBeGreaterThan(0);

    // The metric changes while that partial write is still in flight.
    const next = sourceFor(data, "median_sale_price");
    painter.schedule(next);
    drain();

    // A new epoch restarts the cursor at 0, so no ZIP keeps the old classing.
    expect(map.state.size).toBe(N);
    for (const zip of [next.zips[0], next.zips[N >> 1], next.zips[N - 1]]) {
      expect(map.state.get(zip)!.k).toBe(next.classOf(zip));
    }
  });

  it("applies a reliability change even when the class is unchanged", () => {
    // The regression this guards against, which shipped and was caught in the
    // browser: the write-skip cache keyed on the class index alone, because
    // reliability used to be the same for every metric. It is not any more —
    // ACTIVE_LISTINGS is exempt from the fade and expresses that by reporting
    // every ZIP as tier 3 — so a ZIP whose class happened to match under both
    // metrics kept the previous metric's tier and stayed faded on a map that
    // must not fade anything.
    const data = makeData(20, (i) => ({ zhvi: 100_000 + i * 10_000 }));
    const map = fakeMap();
    const painter = new ChoroplethPainter(map as never);

    const values = Object.fromEntries(
      Object.entries(data).map(([zip, r]) => [zip, r.zhvi as number]),
    );
    // Same values, so IDENTICAL classes; only the tier differs.
    const low = encodePaint(values, 0);
    const high = encodePaint(values, 3);
    const zips = Object.keys(data);

    painter.schedule(new PaintTableSource(low.table, low.breaks, zips));
    drain();
    expect(map.state.get(zips[0])!.rel).toBe(0);
    const classBefore = map.state.get(zips[0])!.k;

    painter.schedule(new PaintTableSource(high.table, high.breaks, zips));
    drain();
    expect(map.state.get(zips[0])!.k).toBe(classBefore); // class really is unchanged
    expect(map.state.get(zips[0])!.rel).toBe(3);         // ...and the tier still updated
  });

  it("paints no-data ZIPs grey rather than transparent", () => {
    const data = makeData(10, (i) => (i < 5 ? { zhvi: 100_000 * (i + 1) } : { zhvi: null }));
    const map = fakeMap();
    new ChoroplethPainter(map as never).schedule(sourceFor(data, "zhvi"));
    drain();
    expect(map.state.get("10009")!.k).toBe(-1);
    expect(map.colorOf("10009")).toBe(NO_DATA_COLOR);
  });
});

describe("class sources", () => {
  it("produce CLASSES - 1 breaks", () => {
    const data = makeData(500, (i) => ({ zhvi: 100_000 + i * 1000 }));
    expect(sourceFor(data, "zhvi").breaks).toHaveLength(CLASSES - 1);
  });

  it("assign every class index in range", () => {
    const data = makeData(500, (i) => ({ zhvi: 100_000 + i * 1000 }));
    const src = sourceFor(data, "zhvi");
    for (const zip of src.zips) {
      const k = src.classOf(zip);
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThan(CLASSES);
    }
  });

  it("give each source a distinct epoch, so a redraw is never skipped", () => {
    const data = makeData(10, (i) => ({ zhvi: 1000 + i }));
    const a = sourceFor(data, "zhvi");
    const b = sourceFor(data, "zhvi");
    expect(a.epoch).not.toBe(b.epoch);
  });

  it("classify() puts values below the first break in class 0 and above the last in K-1", () => {
    const breaks = [10, 20, 30];
    expect(classify(5, breaks)).toBe(0);
    expect(classify(10, breaks)).toBe(1);
    expect(classify(999, breaks)).toBe(3);
  });

  it("ViewportClassSource answers -1 outside its sample", () => {
    // Correct rather than a gap: a ZIP outside the viewport has no place on a
    // viewport-derived scale, and the painter still writes the full set so
    // nothing keeps a stale colour.
    const zips = Array.from({ length: 100 }, (_, i) => String(10_000 + i));
    const store = storeFor(zips, zips.map((_, i) => 100_000 + i * 1000));
    const { table } = encodePaint(
      Object.fromEntries(zips.map((z, i) => [z, 100_000 + i * 1000])),
    );
    const visibleRows = new Int32Array(Array.from({ length: 40 }, (_, i) => i));

    const src = new ViewportClassSource(store, table, "zhvi", visibleRows);
    expect(src.classOf(zips[0])).toBeGreaterThanOrEqual(0);
    expect(src.classOf("10099")).toBe(-1);
    expect(src.zips).toHaveLength(100);
  });

  it("PaintTableSource reads the class and tier out of one byte", () => {
    // The layout contract, asserted from the client side. The pipeline asserts
    // the same thing from the other side, against the same bytes.
    const bytes = new Uint8Array(100_000);
    bytes[10001] = (3 << 4) | 7;   // tier 3, class 6 — the legal maximum, 0x37
    bytes[10002] = (0 << 4) | 1;   // tier 0, class 0
    bytes[10003] = 0;              // no data
    const table = PaintTable.from(bytes.buffer, "zhvi", CLASSES, CHOROPLETH_COLORS.length);

    expect(bytes[10001]).toBe(0x37);
    expect(table.classOf("10001")).toBe(6);
    expect(table.reliabilityOf("10001")).toBe(3);
    expect(table.classOf("10002")).toBe(0);
    expect(table.reliabilityOf("10002")).toBe(0);
    expect(table.classOf("10003")).toBe(-1);
    expect(table.reliabilityOf("10003")).toBe(-1);
    // Leading zeros survive: the ZIP is parsed as a base-10 integer index.
    bytes[501] = (2 << 4) | 3;
    expect(table.classOf("00501")).toBe(2);
    expect(table.reliabilityOf("00501")).toBe(2);
  });

  it("PaintTable refuses to construct rather than painting a lie", () => {
    expect(() => PaintTable.from(new ArrayBuffer(99_999), "zhvi", CLASSES, 7))
      .toThrow(/99999 bytes/);
    expect(() => PaintTable.from(new ArrayBuffer(100_000), "zhvi", 12, 7))
      .toThrow(/12 classes/);
  });
});

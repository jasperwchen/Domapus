// The honesty invariant for auto-scale: re-cutting a metric's own break
// population under its own scheme must reproduce the breaks the pipeline
// shipped. If it does not, then flipping "Adjust Contrast to View" on the full
// national extent — where the viewport sample IS that population — repaints the
// map, which is the toggle claiming to have done something it did not do.
//
// The fixture is the real published manifest, so this fails if the pipeline
// changes a scheme and the frontend does not follow.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { areaBreaks, fitBreaks } from "../classing";
import type { ZipData } from "@/components/dashboard/map/types";
import { CLASSES } from "../choropleth";
import { PAINTED_METRICS } from "../metrics";
import { WIRE_OF } from "../zip-table";

const dataDir = resolve(__dirname, "../../../public/data");
const manifest = JSON.parse(readFileSync(resolve(dataDir, "manifest.json"), "utf8"));
const snapshot = JSON.parse(readFileSync(resolve(dataDir, "zip-data.json"), "utf8"));

/** The break population for `metric`, exactly as `pipeline/classify.py` cuts it. */
function breakPopulation(metric: string, gate: string | null): number[] {
  const sentinel = snapshot.null_sentinel;
  const read = (name: string) => {
    const j = snapshot.f.indexOf(name);
    return { col: snapshot.d[j] as number[], scale: snapshot.scales[name] ?? 1 };
  };
  const value = read(WIRE_OF[metric] ?? metric);
  const rel = read("rel");

  const out: number[] = [];
  for (let i = 0; i < value.col.length; i++) {
    if (value.col[i] === sentinel) continue;
    if (gate !== "all_reporting" && (rel.col[i] === sentinel || rel.col[i] / rel.scale < 1)) continue;
    out.push(value.col[i] / value.scale);
  }
  return out;
}

// THE DEPLOY GATE. The published data and this build must agree on how many
// classes there are, and when they do not the map paints nothing at all:
// `PaintTable.from` refuses to construct on a class-count mismatch, which is the
// guard doing its job and a grey map for the reader.
//
// `deploy.yml` also runs on push, so merging a class-count change before a data
// run publishes exactly that pair. This test is what stops it — the order is push
// the branch, dispatch `update_data.yml` against it, then merge once the 14-class
// data is committed. The per-scheme comparisons below are skipped while the two
// disagree, because comparing a 14-class cut against 7-class published breaks
// produces eight diffs that all say this one thing.
const generationsAgree = manifest.classes === CLASSES;

describe("the published data and this build are the same generation", () => {
  it(`manifest declares ${manifest.classes} classes and the ramp has ${CLASSES}`, () => {
    expect(manifest.classes, "run the pipeline before merging a class-count change")
      .toBe(CLASSES);
  });
});

describe.skipIf(!generationsAgree)("fitBreaks reproduces the pipeline", () => {
  const recomputable = Object.entries(manifest.classing as Record<string, {
    scheme: string; breaks: number[]; break_gate?: string | null;
  }>).filter(([metric]) => metric in PAINTED_METRICS
      && snapshot.f.includes(WIRE_OF[metric] ?? metric));

  it("covers every recomputable painted metric", () => {
    expect(recomputable.length).toBeGreaterThanOrEqual(8);
  });

  for (const [metric, spec] of recomputable) {
    it(`${metric} (${spec.scheme})`, () => {
      const sample = breakPopulation(metric, spec.break_gate ?? null);
      const fitted = fitBreaks(spec.scheme, sample);
      expect(fitted).not.toBeNull();
      expect(fitted).toEqual(spec.breaks);
    });
  }
});

describe("fitBreaks refuses rather than guesses", () => {
  const sample = Array.from({ length: 500 }, (_, i) => i + 1);

  it("does not guess at a scheme it does not know", () => {
    expect(fitBreaks("headroom_v3", sample)).toBeNull();
  });

  it("refuses a sample too small to cut", () => {
    expect(fitBreaks("quantile", [1, 2, 3])).toBeNull();
  });

  it("refuses a degenerate sample rather than emitting tied edges", () => {
    expect(fitBreaks("quantile", Array(50).fill(7))).toBeNull();
    expect(fitBreaks("log_equal_p1_p99", Array(50).fill(7))).toBeNull();
  });

  it("keeps tied quantile edges, as the pipeline does, instead of falling back", () => {
    const counts = [...Array(160).fill(1), ...Array.from({ length: 840 }, (_, i) => 2 + i)];
    const edges = fitBreaks("quantile", counts)!;
    expect(edges).toHaveLength(CLASSES - 1);
    expect(edges[0]).toBe(edges[1]);
    for (let i = 1; i < edges.length; i++) expect(edges[i]).toBeGreaterThanOrEqual(edges[i - 1]);
  });

  it("emits CLASSES - 1 strictly increasing edges when it does cut", () => {
    const edges = fitBreaks("log_equal_p1_p99", sample)!;
    expect(edges).toHaveLength(CLASSES - 1);
    for (let i = 1; i < edges.length; i++) expect(edges[i]).toBeGreaterThan(edges[i - 1]);
  });
});

describe("areaBreaks (the export's state or metro scale)", () => {
  // 30 ZIPs with enough sales to rank, and 10 thin ones at 5M that would own the top of any
  // cut they were allowed to vote in.
  const rows = [
    ...Array.from({ length: 30 }, (_, i) => ({ zhvi: 200_000 + i * 10_000, rel: 2 })),
    ...Array.from({ length: 10 }, () => ({ zhvi: 5_000_000, rel: 0 })),
  ] as unknown as ZipData[];

  it("lets only rankable ZIPs vote on an estimated metric, as the pipeline does", () => {
    const ranked = rows.filter((r) => (r.rel ?? 0) >= 1).map((r) => r.zhvi as number);
    expect(areaBreaks(rows, "zhvi", { scheme: "quantile", break_gate: "rankable" }))
      .toEqual(fitBreaks("quantile", ranked));
  });

  it("lets every reporting ZIP vote on an exact count", () => {
    const all = rows.map((r) => r.zhvi as number);
    expect(areaBreaks(rows, "zhvi", { scheme: "quantile", break_gate: "all_reporting" }))
      .toEqual(fitBreaks("quantile", all));
  });

  it("gives up on an area too small to cut, and on a scale that ignores the area", () => {
    expect(areaBreaks(rows.slice(0, 5), "zhvi", { scheme: "quantile", break_gate: "rankable" })).toBeNull();
    expect(areaBreaks(rows, "zhvi", { scheme: "equal_interval_0_100" })).toBeNull();
  });
});

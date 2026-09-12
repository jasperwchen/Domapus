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
import { fitBreaks } from "../classing";
import { CLASSES } from "../choropleth";
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

describe("fitBreaks reproduces the pipeline", () => {
  const recomputable = Object.entries(manifest.classing as Record<string, {
    scheme: string; breaks: number[]; break_gate?: string | null;
  }>).filter(([metric, c]) => c.scheme !== "diverging"
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

  it("does not recompute a diverging scale", () => {
    expect(fitBreaks("diverging", sample)).toBeNull();
  });

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

  it("emits CLASSES - 1 strictly increasing edges when it does cut", () => {
    const edges = fitBreaks("log_equal_p1_p99", sample)!;
    expect(edges).toHaveLength(CLASSES - 1);
    for (let i = 1; i < edges.length; i++) expect(edges[i]).toBeGreaterThan(edges[i - 1]);
  });
});

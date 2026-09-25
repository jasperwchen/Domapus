// @vitest-environment node
// Node's User Timing is complete; jsdom's is not.
import { afterEach, describe, expect, it } from "vitest";
import { mark, measure } from "../perf";

afterEach(() => {
  performance.clearMarks();
  performance.clearMeasures();
});

describe("measure", () => {
  it("drops its start mark", () => {
    mark("t:start");
    measure("t", "t:start");
    expect(performance.getEntriesByName("t:start", "mark")).toHaveLength(0);
    expect(performance.getEntriesByName("t", "measure")).toHaveLength(1);
  });

  it("keeps a bounded, most-recent window per name", () => {
    for (let i = 0; i < 500; i++) {
      mark("t:start");
      measure("t", "t:start", { i });
    }
    const kept = performance.getEntriesByName("t", "measure") as PerformanceMeasure[];
    expect(kept.length).toBeLessThanOrEqual(200);
    expect(kept.length).toBeGreaterThanOrEqual(100);
    expect((kept[kept.length - 1].detail as { i: number }).i).toBe(499);
    const starts = kept.map((e) => e.startTime);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });
});

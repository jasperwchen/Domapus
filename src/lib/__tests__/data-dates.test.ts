import { describe, expect, it } from "vitest";
import { stalePeriod } from "../data-dates";

const release = {
  last_updated_utc: "2026-09-20T02:35:22Z",
  period_end: "2026-08-31",
  zhvi_period_end: "2026-08-31",
};

describe("stalePeriod", () => {
  it("is quiet through a normal monthly cycle", () => {
    expect(stalePeriod(release, new Date("2026-09-21"))).toBeNull();
    // The day before the next release is ~48 days old and still healthy.
    expect(stalePeriod(release, new Date("2026-10-18"))).toBeNull();
  });

  it("fires once a monthly release has been missed", () => {
    expect(stalePeriod(release, new Date("2026-11-10"))).toBe("2026-08-31");
  });

  it("fires when the pipeline already published stale data", () => {
    const late = { ...release, last_updated_utc: "2026-10-20T00:00:00Z", zhvi_period_end: "2026-09-30" };
    expect(stalePeriod(late, new Date("2026-10-21"))).toBe("2026-08-31");
  });

  it("stays quiet when the dates are unknown", () => {
    expect(stalePeriod({ last_updated_utc: null, period_end: null, zhvi_period_end: null })).toBeNull();
  });
});

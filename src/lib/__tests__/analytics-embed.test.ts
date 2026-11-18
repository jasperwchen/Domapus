import { beforeEach, describe, expect, it } from "vitest";
import { track, trackOnce } from "../analytics";
import { embedCode, isEmbed } from "../embed";

describe("track", () => {
  beforeEach(() => { window.dataLayer = []; });

  it("clears every key the event does not set", () => {
    track("metric_change", { metric: "zhvi" });
    track("zip_select", { state: "CO", method: "map" });
    const last = window.dataLayer.at(-1) as Record<string, unknown>;
    expect(last.event).toBe("zip_select");
    expect(last.state).toBe("CO");
    expect("metric" in last).toBe(true);
    expect(last.metric).toBeUndefined();
  });

  it("sends a trackOnce event once per page load", () => {
    trackOnce("map_first_colour", { value_ms: 1 });
    trackOnce("map_first_colour", { value_ms: 2 });
    expect(window.dataLayer.filter((e) => (e as { event: string }).event === "map_first_colour")).toHaveLength(1);
  });
});

describe("embed", () => {
  it("recognises only embed=1", () => {
    expect(isEmbed("?embed=1&metric=zhvi")).toBe(true);
    expect(isEmbed("?embed=0")).toBe(false);
    expect(isEmbed("")).toBe(false);
  });

  it("drops the ZIP, sets embed=1 and escapes ampersands", () => {
    const code = embedCode("https://x.github.io/Domapus/?metric=zhvi&zip=80202&lat=39.7", "/Domapus/");
    const src = code.match(/src="([^"]+)"/)![1];
    expect(src).not.toContain("zip=");
    expect(src).toContain("embed=1");
    expect(src).not.toMatch(/&(?!amp;)/);
    expect(src.startsWith("https://x.github.io/Domapus/?metric=zhvi&amp;lat=39.7")).toBe(true);
  });
});

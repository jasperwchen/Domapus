import { expect, it } from "vitest";
import { parseView } from "@/hooks/useUrlState";

it.each(["lat=999&lng=0&zoom=6", "lat=40junk&lng=0", "lat=40", "lat=40&lng=Infinity"])(
  "rejects invalid or incomplete coordinates: %s", query => {
    const view = parseView(new URLSearchParams(query));
    expect(view.lat).toBeUndefined();
    expect(view.lng).toBeUndefined();
  },
);
it("restores valid coordinates and rejects zoom outside the supported range", () => {
  expect(parseView(new URLSearchParams("lat=40&lng=-75&zoom=99")))
    .toEqual({ lat: 40, lng: -75, zoom: undefined });
});

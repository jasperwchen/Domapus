import { describe, expect, it } from "vitest";
import { differenceNoise, yoyNoise } from "../change-noise";
import type { ZipData } from "@/components/dashboard/map/types";

const zip = (p: Partial<ZipData>) => p as ZipData;

describe("yoyNoise", () => {
  // rse 0.10 with an unchanged sales count: SE of the log change is 0.10 * sqrt(2) = 0.1414.
  const base = { median_sale_price: 500_000, msp_rse: 0.1, homes_sold_yoy: 0 };

  it("flags a sale-price change inside two standard errors and returns the band", () => {
    const band = yoyNoise(zip({ ...base, median_sale_price_yoy: 20 }), "median_sale_price");
    expect(band).toBeCloseTo(0.2828, 3);
  });

  it("passes a change outside two standard errors", () => {
    expect(yoyNoise(zip({ ...base, median_sale_price_yoy: 40 }), "median_sale_price")).toBeNull();
  });

  it("widens the band when the year-ago sample was smaller", () => {
    // Sales doubled, so last year rested on half the sales: SE = 0.10 * sqrt(3) = 0.1732.
    const z = zip({ ...base, homes_sold_yoy: 100, median_sale_price_yoy: 35 });
    expect(yoyNoise(z, "median_sale_price")).toBeCloseTo(0.3464, 3);
  });

  it("reads days-on-market change as a difference in days", () => {
    const z = { median_dom: 40, dom_rse: 0.2, homes_sold_yoy: 0 };
    // 30 -> 40 days is log 0.288, inside 2 * 0.2 * sqrt(2) = 0.566.
    expect(yoyNoise(zip({ ...z, median_dom_yoy: 10 }), "median_dom")).not.toBeNull();
    // 10 -> 40 days is log 1.386, outside.
    expect(yoyNoise(zip({ ...z, median_dom_yoy: 30 }), "median_dom")).toBeNull();
  });

  it("says nothing for metrics with no sampling model or missing inputs", () => {
    expect(yoyNoise(zip({ zhvi: 1, zhvi_yoy: 0.1, msp_rse: 0.5 }), "zhvi")).toBeNull();
    expect(yoyNoise(zip({ ...base, msp_rse: null, median_sale_price_yoy: 1 }), "median_sale_price")).toBeNull();
    expect(yoyNoise(zip({ median_dom: 5, dom_rse: 0.2, median_dom_yoy: 5 }), "median_dom")).toBeNull();
  });
});

describe("differenceNoise", () => {
  it("compares the gap with both ZIPs' errors combined", () => {
    const a = zip({ median_sale_price: 400_000, msp_rse: 0.1 });
    // 2 * sqrt(0.01 + 0.01) = 0.2828.
    expect(differenceNoise(a, zip({ median_sale_price: 480_000, msp_rse: 0.1 }), "median_sale_price")).toBeCloseTo(0.2828, 3);
    expect(differenceNoise(a, zip({ median_sale_price: 600_000, msp_rse: 0.1 }), "median_sale_price")).toBeNull();
  });
});

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Sparkline } from "../Sparkline";

vi.mock("@/lib/history", async original => ({
  ...await original<typeof import("@/lib/history")>(),
  loadHistory: vi.fn(async () => ({
    index: { periods: ["2026-06-30", "2026-07-31"], zhvi_months: [],
      horizons: [], scales: {}, q: {}, notes: {} },
    series: { msp: [100000, 120000], hs: [10, 11] },
  })),
}));

describe("history series selection", () => {
  it("shows available Redfin history when the default Zillow series is absent", async () => {
    render(<Sparkline zipCode="02134" />);
    const salePrice = await screen.findByRole("button", { name: "Sale price" });
    expect(salePrice).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Homes sold" }));
    expect(screen.getByRole("button", { name: "Homes sold" })).toHaveAttribute("aria-pressed", "true");
  });
});

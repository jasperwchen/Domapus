import { it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { EmbedCredit } from "../Embed";

it("names the data source in the embed credit", () => {
  render(
    <MemoryRouter initialEntries={["/?embed=1&metric=median_sale_price"]}>
      <EmbedCredit label="Median Sale Price" source="Redfin" bottom={false} />
    </MemoryRouter>,
  );
  const link = screen.getByRole("link", { name: /Open this map on Domapus/ });
  expect(link.textContent).toContain("Data: Redfin");
  expect(link.getAttribute("href")).toBe(`${import.meta.env.BASE_URL}?metric=median_sale_price`);
});

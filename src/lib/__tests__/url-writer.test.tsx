import { describe, it, expect, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useEffect } from "react";
import { useUrlState } from "@/hooks/useUrlState";
import { routerBasename } from "../router-basename";

// The URL the app writes into the address bar is the URL people copy and share. It used to be
// "/Domapus?zip=..." and GitHub Pages redirects that, once, on every shared link.
function Writer({ onReady }: { onReady: (write: ReturnType<typeof useUrlState>["setUrlState"]) => void }) {
  const { setUrlState } = useUrlState();
  useEffect(() => onReady(setUrlState), [onReady, setUrlState]);
  return null;
}

function mount(base: string, start: string) {
  window.history.replaceState(null, "", start);
  let write!: ReturnType<typeof useUrlState>["setUrlState"];
  render(
    <BrowserRouter basename={routerBasename(base)}>
      <Routes>
        <Route path="/" element={<Writer onReady={(w) => { write = w; }} />} />
      </Routes>
    </BrowserRouter>,
  );
  return (updates: Parameters<typeof write>[0]) => act(() => write(updates));
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("the URL the app writes", () => {
  it.each([
    ["production", "/Domapus/"],
    ["a PR preview", "/Domapus/pr-preview/pr-5/"],
    ["the dev server", "/"],
  ])("keeps the base path's trailing slash on %s", (_label, base) => {
    const write = mount(base, `${base}?metric=zhvi`);
    write({ zip: "80113" });
    expect(window.location.pathname).toBe(base);
    expect(new URLSearchParams(window.location.search).get("zip")).toBe("80113");
    expect(new URLSearchParams(window.location.search).get("metric")).toBe("zhvi");
  });

  it("keeps the slash when the last parameter is removed", () => {
    const write = mount("/Domapus/", "/Domapus/?zip=80113");
    write({ zip: undefined });
    expect(window.location.pathname + window.location.search).toBe("/Domapus/");
  });

  it("accepts a base without the slash, as an older Vite config would pass", () => {
    expect(routerBasename("/Domapus")).toBe("/Domapus/");
  });
});

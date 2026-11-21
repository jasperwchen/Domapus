import { describe, it, expect, vi, afterEach } from "vitest";
import { render, act, cleanup, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Link, useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { useUrlState } from "@/hooks/useUrlState";
import { MapPresence } from "../map-presence";

let mounts = 0;
vi.mock("@/pages/Index", () => ({
  default: function Index() {
    useEffect(() => { mounts++; }, []);
    return <Link to="/methodology/?zip=80113">Methodology</Link>;
  },
}));
vi.mock("@/pages/Methodology", () => ({
  default: () => <Link to="/?zip=80113">Map</Link>,
}));

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

type Hook = ReturnType<typeof useUrlState>;

/** The hook under the same presence rule App uses: visible only on "/". */
function mountHook(start: string) {
  const seen: { hook: Hook; search: string; nav: (to: string) => void }[] = [];
  function Probe() {
    const hook = useUrlState();
    const { search } = useLocation();
    const nav = useNavigate();
    seen.push({ hook, search, nav });
    return null;
  }
  function Presence() {
    const visible = useLocation().pathname === "/";
    return <MapPresence.Provider value={{ alive: true, visible }}><Probe /></MapPresence.Provider>;
  }
  render(<MemoryRouter initialEntries={[start]}><Presence /></MemoryRouter>);
  const last = () => seen[seen.length - 1];
  return { last, go: (to: string) => act(() => last().nav(to)) };
}

describe("the map kept behind another page", () => {
  it("does not treat coming back to the same address as a navigation", () => {
    const { last, go } = mountHook("/?zip=80113");
    const before = last().hook.navigation;
    go("/methodology/?zip=80113");
    go("/?zip=80113");
    expect(last().hook.navigation).toBe(before);
  });

  it("still applies a different address on the way back", () => {
    const { last, go } = mountHook("/?zip=80113");
    go("/methodology/?zip=80113");
    go("/?zip=10001");
    expect(last().hook.navigation.search).toBe("?zip=10001");
  });

  it("writes nothing while hidden", () => {
    const { last, go } = mountHook("/?zip=80113");
    go("/methodology/?zip=80113");
    act(() => last().hook.setUrlState({ zip: "10001" }));
    expect(last().search).toBe("?zip=80113");
  });
});

describe("App", () => {
  it("mounts the map once and hides it behind methodology", async () => {
    mounts = 0;
    window.history.replaceState(null, "", "/?zip=80113");
    const { default: App } = await import("@/App");
    render(<App />);
    fireEvent.click(await screen.findByText("Methodology"));
    await screen.findByText("Map");
    const wrapper = screen.getByText("Methodology", { selector: "a" }).closest("div[aria-hidden]") as HTMLElement;
    expect(wrapper.style.opacity).toBe("0");
    expect(wrapper.inert).toBe(true);
    fireEvent.click(screen.getByText("Map"));
    expect(screen.queryByText("Map")).toBeNull();
    expect(mounts).toBe(1);
  });
});

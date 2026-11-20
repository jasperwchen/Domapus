import { describe, it, expect, vi } from "vitest";
import { reloadOnStaleChunk } from "../stale-chunk";

function fakeWindow(storage: Storage | null = null) {
  const target = new EventTarget();
  const store = new Map<string, string>();
  const reload = vi.fn();
  const win = Object.assign(target, {
    sessionStorage: storage ?? {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
    location: { reload },
  }) as unknown as Window;
  reloadOnStaleChunk(win);
  const fail = () => {
    const e = new Event("vite:preloadError", { cancelable: true });
    win.dispatchEvent(e);
    return e.defaultPrevented;
  };
  return { reload, fail };
}

describe("reloadOnStaleChunk", () => {
  it("reloads once and swallows the error", () => {
    const { reload, fail } = fakeWindow();
    expect(fail()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("lets a second failure right after the reload reach the error boundary", () => {
    const { reload, fail } = fakeWindow();
    fail();
    expect(fail()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload when storage is blocked, since it could not stop a loop", () => {
    const blocked = { getItem: () => { throw new Error("blocked"); } } as unknown as Storage;
    const { reload, fail } = fakeWindow(blocked);
    expect(fail()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

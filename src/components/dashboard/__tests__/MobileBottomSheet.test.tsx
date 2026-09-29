import { act, fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileBottomSheet } from "../MobileBottomSheet";

describe("sheet drag velocity", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it.each([
    { movementMs: 500, pauseMs: 10, end: "pointerup", closes: false },
    { movementMs: 20, pauseMs: 150, end: "pointerup", closes: false },
    { movementMs: 20, pauseMs: 1, end: "pointercancel", closes: false },
    { movementMs: 20, pauseMs: 1, end: "pointerup", closes: true },
  ])("snaps using the recent gesture: %j", ({ movementMs, pauseMs, end, closes }) => {
    const onClose = vi.fn();
    render(<MobileBottomSheet isOpen onClose={onClose}>Details</MobileBottomSheet>);
    act(() => vi.advanceTimersByTime(50));
    const handle = screen.getByRole("dialog").querySelector(".touch-none")!;
    Object.assign(handle, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() });
    const pointer = (type: string, y: number) => fireEvent(handle,
      new MouseEvent(type, { bubbles: true, clientY: y, button: 0 }));
    pointer("pointerdown", 400);
    act(() => vi.advanceTimersByTime(movementMs));
    pointer("pointermove", 430);
    act(() => vi.advanceTimersByTime(pauseMs));
    pointer(end, 430);
    expect(onClose).toHaveBeenCalledTimes(closes ? 1 : 0);
    if (!closes) expect(screen.getByRole("button", { name: "Expand details" })).toBeVisible();
  });
});

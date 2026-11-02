import { act, fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileBottomSheet } from "../MobileBottomSheet";

describe("close animation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("keeps details nonmodal and closes with Escape without stealing focus from search", () => {
    const onClose = vi.fn();
    const { rerender } = render(<>
      <input aria-label="Search ZIP" />
      <MobileBottomSheet isOpen onClose={onClose}>Details</MobileBottomSheet>
    </>);
    act(() => vi.advanceTimersByTime(50));
    const sheet = screen.getByRole("dialog", { name: "ZIP details" });
    expect(sheet).not.toHaveAttribute("aria-modal", "true");
    expect(sheet).toHaveFocus();
    const search = screen.getByRole("textbox");
    search.focus();
    fireEvent.keyDown(search, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    rerender(<>
      <input aria-label="Search ZIP" />
      <MobileBottomSheet isOpen={false} onClose={onClose}>Details</MobileBottomSheet>
    </>);
    act(() => vi.advanceTimersByTime(300));
    expect(search).toHaveFocus();
  });

  it("returns focus to the opener when closing from the sheet", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const { unmount } = render(<MobileBottomSheet isOpen onClose={() => {}}>Details</MobileBottomSheet>);
    act(() => vi.advanceTimersByTime(50));
    expect(screen.getByRole("dialog")).toHaveFocus();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("returns focus to the opener after the normal close animation", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const { rerender } = render(<MobileBottomSheet isOpen onClose={() => {}}>Details</MobileBottomSheet>);
    act(() => vi.advanceTimersByTime(50));
    expect(screen.getByRole("dialog")).toHaveFocus();
    rerender(<MobileBottomSheet isOpen={false} onClose={() => {}}>Details</MobileBottomSheet>);
    act(() => vi.advanceTimersByTime(300));
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("calls onExited after the close animation, not when close starts", () => {
    const onClose = vi.fn();
    const onExited = vi.fn();
    const { rerender } = render(
      <MobileBottomSheet isOpen onClose={onClose} onExited={onExited}>
        <div>ZIP 30309 details</div>
      </MobileBottomSheet>,
    );
    act(() => vi.advanceTimersByTime(50));
    expect(screen.getByText("ZIP 30309 details")).toBeVisible();

    rerender(
      <MobileBottomSheet isOpen={false} onClose={onClose} onExited={onExited}>
        <div>ZIP 30309 details</div>
      </MobileBottomSheet>,
    );
    expect(onExited).not.toHaveBeenCalled();
    expect(screen.getByText("ZIP 30309 details")).toBeVisible();

    act(() => vi.advanceTimersByTime(300));
    expect(onExited).toHaveBeenCalledOnce();
    expect(screen.queryByText("ZIP 30309 details")).toBeNull();
  });
});

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

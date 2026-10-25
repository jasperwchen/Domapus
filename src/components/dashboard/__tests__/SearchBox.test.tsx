import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SearchBox } from "../SearchBox";

describe("SearchBox", () => {
  it("selects the existing ZIP on focus and on a click while already focused", () => {
    render(<SearchBox onSearch={vi.fn()} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "10001" } });
    fireEvent.focus(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 5]);
    input.setSelectionRange(2, 2);
    fireEvent.click(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 5]);
    fireEvent.change(input, { target: { value: "90210" } });
    expect(input.value).toBe("90210");
  });

  it("ignores empty input, keeps leading zeros, and repeats the same search", () => {
    const onSearch = vi.fn();
    render(<SearchBox onSearch={onSearch} />);
    const submit = screen.getByRole("button", { name: "Search" });
    fireEvent.click(submit);
    expect(onSearch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "501" } });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(onSearch.mock.calls).toEqual([["00501", 1], ["00501", 2]]);
  });
});

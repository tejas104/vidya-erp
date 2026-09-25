import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ScoreEntryCard, validateScore } from "./ScoreEntryCard";

const roster = [{ id: "s1", fullName: "Asha" }, { id: "s2", fullName: "Bina" }];
describe("Shared score entry", () => {
  it("matches the school score precision accepted by the server", () => {
    expect(validateScore("1.234", 20)).toContain("two decimal");
    expect(validateScore("1e1", 20)).toContain("two decimal");
    expect(validateScore("0", 20)).toBeNull();
    expect(validateScore("12.50", 20)).toBeNull();
  });
  it("never turns a blank row into a zero mark while saving another row", () => {
    const onSave = vi.fn();
    render(<ScoreEntryCard title="Marks" roster={roster} values={{ s1: " ", s2: "0" }} maxScore={20} onChange={vi.fn()} onSave={onSave} />);
    expect(screen.getByText("1/2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save marks" }));
    expect(onSave).toHaveBeenCalledWith([{ studentId: "s2", score: 0 }]);
  });

  it("keeps all-empty rosters from submitting", () => {
    render(<ScoreEntryCard title="Marks" roster={roster} values={{}} maxScore={20} onChange={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Save marks" })).toBeDisabled();
  });

  it("locks edits during save and associates out-of-range feedback with its field", () => {
    const { rerender } = render(<ScoreEntryCard title="Marks" roster={roster} values={{ s1: "21" }} maxScore={20} onChange={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByLabelText("score for Asha")).toHaveAccessibleDescription("0–20 only.");
    rerender(<ScoreEntryCard title="Marks" roster={roster} values={{ s1: "20" }} maxScore={20} onChange={vi.fn()} onSave={vi.fn()} saving />);
    expect(screen.getByLabelText("score for Asha")).toBeDisabled();
  });
});

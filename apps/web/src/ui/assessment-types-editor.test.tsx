import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AssessmentTypesEditor } from "./AssessmentTypesEditor";
import { api, type SchoolTermView } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, api: { ...actual.api, schoolAssessmentTypes: vi.fn(), schoolSetAssessmentTypes: vi.fn() } };
});
const term = { id: "t1", name: "Term 1", status: "open" } as SchoolTermView;
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.schoolAssessmentTypes).mockResolvedValue({ types: [{ id: "a1", termId: "t1", name: "Unit tests", weight: 40 }, { id: "a2", termId: "t1", name: "Exam", weight: 60 }] });
});

describe("Assessment weighting editor", () => {
  it("blocks an incomplete total and saves all types with stable identifiers", async () => {
    const onClose = vi.fn();
    vi.mocked(api.schoolSetAssessmentTypes).mockResolvedValue({ types: [] });
    render(<AssessmentTypesEditor term={term} admin onClose={onClose} />);
    fireEvent.change(await screen.findByLabelText("Type 1 weight (%)"), { target: { value: "30" } });
    expect(screen.getByRole("status")).toHaveTextContent("90% of 100%");
    expect(screen.getByRole("button", { name: "Save assessment types" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Type 2 weight (%)"), { target: { value: "70" } });
    fireEvent.click(screen.getByRole("button", { name: "Save assessment types" }));
    await waitFor(() => expect(api.schoolSetAssessmentTypes).toHaveBeenCalledWith("t1", [{ id: "a1", name: "Unit tests", weight: 30 }, { id: "a2", name: "Exam", weight: 70 }]));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("prevents duplicate names and preserves input when a save fails", async () => {
    vi.mocked(api.schoolSetAssessmentTypes).mockRejectedValue(new Error("offline"));
    render(<AssessmentTypesEditor term={term} admin onClose={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText("Type 2 name"), { target: { value: " unit TESTS " } });
    expect(screen.getByRole("button", { name: "Save assessment types" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Type 2 name"), { target: { value: "Final exam" } });
    fireEvent.click(screen.getByRole("button", { name: "Save assessment types" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save");
    expect(screen.getByLabelText("Type 2 name")).toHaveValue("Final exam");
  });

  it("makes a closed term read only even for administrators", async () => {
    render(<AssessmentTypesEditor term={{ ...term, status: "closed" }} admin onClose={vi.fn()} />);
    expect(await screen.findByLabelText("Type 1 name")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save assessment types" })).not.toBeInTheDocument();
  });
});

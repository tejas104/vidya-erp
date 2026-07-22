import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("./searchIndex", () => ({
  buildIndex: vi.fn(async () => [
    { kind: "page", label: "Reports", href: "/manage/reports" },
    { kind: "student", label: "Asha Rao", roll: "23CS001", sub: "s1", href: "/students/st1" },
  ]),
  filterIndex: (e: any[], q: string) => ({
    pages: e.filter((x) => x.kind === "page" && x.label.toLowerCase().includes(q.toLowerCase())),
    students: e.filter(
      (x) => x.kind === "student" && (x.label + x.roll).toLowerCase().includes(q.toLowerCase()),
    ),
  }),
  getCachedIndex: () => null,
}));

import { SearchPalette } from "./SearchPalette";

describe("SearchPalette", () => {
  it("filters and navigates on select", async () => {
    render(<SearchPalette open onClose={() => {}} roles={["admin"]} />);
    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "asha" } });
    await waitFor(() => screen.getByText("Asha Rao"));
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/students/st1");
  });

  it("shows an empty state for a non-matching query", async () => {
    render(<SearchPalette open onClose={() => {}} roles={["admin"]} />);
    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "zzz-no-match" } });
    await waitFor(() => screen.getByText(/no results/i));
  });

  it("routes a page result to its href on Enter", async () => {
    push.mockClear();
    render(<SearchPalette open onClose={() => {}} roles={["admin"]} />);
    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "report" } });
    await waitFor(() => screen.getByText("Reports"));
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/manage/reports");
  });
});

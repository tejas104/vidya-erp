import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import LeavePage from "../../app/(app)/manage/leave/page";
import { api } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      session: vi.fn(),
      lvsMine: vi.fn(async () => ({ requests: [] })),
      lvsPending: vi.fn(async () => ({ requests: [] })),
      lvsApply: vi.fn(),
      lvsDecide: vi.fn(async () => ({ ...pending, status: "approved" })),
    },
  };
});

const pending = {
  id: "lvr_1", collegeId: "col_1", departmentId: "dep_a", teacherId: "tch_9",
  teacherName: "Ravi Kumar", fromOn: "2026-08-01", toOn: "2026-08-02", kind: "casual",
  reason: "family trip", status: "pending", decisionNote: null, decidedAt: null,
} as const;

function mock<T extends keyof typeof api>(name: T) {
  return api[name] as unknown as ReturnType<typeof vi.fn>;
}

describe("LeavePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock("lvsMine").mockResolvedValue({ requests: [] });
    mock("lvsPending").mockResolvedValue({ requests: [] });
    mock("lvsDecide").mockResolvedValue({ ...pending, status: "approved" });
  });

  it("shows the approvals queue with a pending request for an approver", async () => {
    mock("session").mockResolvedValue({
      userId: "u1", displayName: "Dr Rao", roles: ["hod"],
      grants: [{ org: { collegeId: "col_1", departmentId: "dep_a" } }],
    });
    mock("lvsPending").mockResolvedValue({ requests: [pending] });
    render(<LeavePage />);
    await waitFor(() => expect(screen.getByText("Ravi Kumar")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument();
  });

  it("blocks reject until a note is typed", async () => {
    mock("session").mockResolvedValue({
      userId: "u1", displayName: "Dr Rao", roles: ["hod"],
      grants: [{ org: { collegeId: "col_1", departmentId: "dep_a" } }],
    });
    mock("lvsPending").mockResolvedValue({ requests: [pending] });
    render(<LeavePage />);
    await waitFor(() => expect(screen.getByText("Ravi Kumar")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    const confirm = await screen.findByRole("button", { name: /confirm reject/i });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/note/i), { target: { value: "too short notice" } });
    expect(confirm).toBeEnabled();
  });

  it("shows the apply button and a teacher's own requests with status badges", async () => {
    mock("session").mockResolvedValue({
      userId: "u2", displayName: "Teacher T", roles: ["teacher"], grants: [],
    });
    mock("lvsMine").mockResolvedValue({
      requests: [{ ...pending, id: "lvr_2", status: "approved" }],
    });
    render(<LeavePage />);
    await waitFor(() => expect(screen.getByText("approved")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /apply/i })).toBeInTheDocument();
    expect(screen.getByText(/approved/i)).toBeInTheDocument();
    // not an approver — no approvals queue
    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();
  });
});

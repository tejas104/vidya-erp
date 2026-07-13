import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import NoticesPage from "../../app/(app)/manage/notices/page";
import { Noticeboard } from "./Noticeboard";
import { api, type NoticeView } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      colleges: vi.fn(), collegeTree: vi.fn(),
      ntcList: vi.fn(), ntcCreate: vi.fn(), ntcDelete: vi.fn(), ntcVisible: vi.fn(),
    },
  };
});

const tree = {
  college: { id: "col_1", name: "Sunrise", code: "DEMO" },
  departments: [
    {
      id: "dep_1", collegeId: "col_1", name: "CS", code: "CSE",
      classes: [{ id: "cls_1", departmentId: "dep_1", name: "FY CS", code: "FYCS", sections: [{ id: "sec_1", classId: "cls_1", name: "A" }] }],
      subjects: [],
    },
  ],
};

function makeNotice(over: Partial<NoticeView>): NoticeView {
  return {
    id: "ntc_1", collegeId: "col_1", audience: "college", audienceLabel: "College-wide",
    title: "Sports day", body: "Ground closed after 2pm.", publishAt: "2026-07-10T00:00:00.000Z",
    expiresAt: null, createdBy: "u_adm", createdAt: "2026-07-10T00:00:00.000Z", ...over,
  };
}

function mock<T extends keyof typeof api>(name: T) {
  return api[name] as unknown as ReturnType<typeof vi.fn>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mock("colleges").mockResolvedValue({ colleges: [tree.college] });
  mock("collegeTree").mockResolvedValue(tree);
  mock("ntcList").mockResolvedValue({
    notices: [
      makeNotice({}),
      makeNotice({ id: "ntc_2", title: "Next year fees", publishAt: "2099-01-01T00:00:00.000Z" }),
      makeNotice({ id: "ntc_3", title: "Old circular", expiresAt: "2026-01-01T00:00:00.000Z" }),
    ],
  });
  mock("ntcCreate").mockResolvedValue(makeNotice({ id: "ntc_9", title: "Fresh", audienceLabel: "FY CS" }));
});

describe("/manage/notices", () => {
  it("derives scheduled/live/expired from the publish window", async () => {
    render(<NoticesPage />);
    expect(await screen.findByText("Sports day")).toBeInTheDocument();
    expect(screen.getByText("live")).toBeInTheDocument();
    expect(screen.getByText("scheduled")).toBeInTheDocument();
    expect(screen.getByText("expired")).toBeInTheDocument();
  });

  it("composes to a class audience", async () => {
    render(<NoticesPage />);
    fireEvent.click(await screen.findByRole("button", { name: /new notice/i }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Fresh" } });
    fireEvent.change(screen.getByLabelText("Body"), { target: { value: "Read this." } });
    fireEvent.change(screen.getByLabelText("Audience"), { target: { value: "class:cls_1" } });
    fireEvent.click(screen.getByRole("button", { name: /^publish$/i }));
    await waitFor(() =>
      expect(api.ntcCreate).toHaveBeenCalledWith({
        collegeId: "col_1", audience: "class:cls_1", title: "Fresh", body: "Read this.",
      }),
    );
    expect(await screen.findByText("Fresh")).toBeInTheDocument();
  });
});

describe("Noticeboard card", () => {
  it("renders visible notices with audience chips", async () => {
    mock("ntcVisible").mockResolvedValue({ notices: [makeNotice({})] });
    render(<Noticeboard />);
    expect(await screen.findByText("Sports day")).toBeInTheDocument();
    expect(screen.getByText("College-wide")).toBeInTheDocument();
  });
  it("renders nothing while the notices module doesn't answer", async () => {
    mock("ntcVisible").mockRejectedValue(new Error("not deployed"));
    const { container } = render(<Noticeboard />);
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });
});

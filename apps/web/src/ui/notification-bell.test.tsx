import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { NoticeView } from "./api";

const ntcVisible = vi.fn();
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, api: { ...actual.api, ntcVisible: () => ntcVisible() } };
});

import { NotificationBell } from "./NotificationBell";

function notice(id: string, title: string, publishAt: string): NoticeView {
  return {
    id, collegeId: "c1", audience: "college", audienceLabel: "College-wide",
    kind: "notice", eventDate: null, title, body: "", publishAt,
    expiresAt: null, createdBy: "u1", createdAt: publishAt,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  ntcVisible.mockResolvedValue({
    notices: [
      notice("n2", "Newer notice", "2026-07-16T00:00:00.000Z"),
      notice("n1", "Older notice", "2026-07-10T00:00:00.000Z"),
    ],
  });
});

describe("NotificationBell", () => {
  it("badges only notices newer than last-seen, and opening clears it", async () => {
    localStorage.setItem("vidya-notifs-seen", "2026-07-12T00:00:00.000Z");
    render(<NotificationBell />);

    // one unread (the July 16 notice; the July 10 one predates last-seen)
    expect(await screen.findByText("1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    expect(screen.getByText("Newer notice")).toBeInTheDocument();
    expect(screen.getByText("Older notice")).toBeInTheDocument();

    // opening marks all seen — badge clears
    await waitFor(() => expect(screen.queryByText("1")).not.toBeInTheDocument());
  });
});

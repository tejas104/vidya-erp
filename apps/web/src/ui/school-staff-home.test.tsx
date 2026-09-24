import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { SchoolStaffHome } from "./SchoolStaffHome";
import type { Dashboard, Session, TtToday } from "./api";

vi.mock("./Noticeboard", () => ({ Noticeboard: () => <div>Noticeboard</div> }));

const dashboard: Dashboard = {
  academicYear: "2026-27",
  names: { cls_1: "Standard 8" },
  tiles: [{ type: "class", classId: "cls_1", attendance: { state: "ok", value: { pct: 90, sessions: 10, distinctStudents: 5, monthly: [] } }, marks: { state: "no-data" }, atRisk: 1, strip: [{ sectionId: "sec_1", name: "A", days: [] }] }],
};
const today: TtToday = {
  dayOfWeek: 4,
  periods: [{ periodNo: 1, starts: "09:00", ends: "09:45" }],
  entries: [{ id: "tt_1", sectionId: "sec_1", subjectId: "sub_1", subjectName: "Mathematics", teacherId: "t_1", teacherName: "Ananya", room: "8A", dayOfWeek: 4, periodNo: 1, sectionName: "A", className: "Standard 8" }],
};
const session = (role: Session["roles"][number]): Session => ({ userId: "u_1", displayName: "Asha Rao", roles: [role], grants: [] });
const renderRole = (role: Session["roles"][number], leaveWaiting: number | null = null) => render(
  <SchoolStaffHome session={session(role)} dashboard={dashboard} atRisk={[{ studentId: "stu_1", name: "Riya Sen", attendancePct: 60, overallPct: null, subjectPcts: {}, reasons: ["low-attendance"] }]} riskStatus="ready" today={today} todayStatus="ready" leaveWaiting={leaveWaiting} />,
);

describe("school staff home", () => {
  it("sends the administrator to school operations", () => {
    renderRole("admin");
    expect(screen.getByRole("heading", { name: "Your school, in motion." })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Your workspaces" })).getByRole("link", { name: /Fee counter/ })).toHaveAttribute("href", "/manage/fees");
    expect(screen.queryByRole("link", { name: /Coursework/ })).not.toBeInTheDocument();
  });

  it("puts a principal's pending decisions first", () => {
    renderRole("principal", 2);
    expect(screen.getByRole("heading", { name: "2 leave requests to decide." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Review leave/ })).toHaveAttribute("href", "/manage/leave");
    expect(screen.queryByRole("link", { name: /Student records/ })).not.toBeInTheDocument();
  });

  it("puts the subject teacher's current period and teaching tools first", () => {
    renderRole("teacher");
    expect(within(screen.getByRole("region", { name: "Priority work" })).getByRole("link", { name: /Open attendance/ })).toHaveAttribute("href", "/manage/attendance?sectionId=sec_1&subjectId=sub_1&slot=p1");
    expect(within(screen.getByRole("region", { name: "Your workspaces" })).getByRole("link", { name: /Marks/ })).toHaveAttribute("href", "/manage/marks");
    expect(screen.getByRole("link", { name: /View.*Term marks/ })).toHaveAttribute("href", "/manage/marks");
    expect(screen.queryByRole("link", { name: /Report cards/ })).not.toBeInTheDocument();
  });

  it("gives the class teacher their own roster and whole-class attendance", () => {
    renderRole("class_teacher");
    expect(within(screen.getByRole("region", { name: "Priority work" })).getByRole("link", { name: /Open class attendance/ })).toHaveAttribute("href", "/manage/attendance?sectionId=sec_1");
    expect(within(screen.getByRole("region", { name: "Your workspaces" })).getByRole("link", { name: /Report cards/ })).toHaveAttribute("href", "/manage/report-cards");
    expect(screen.queryByRole("link", { name: /^Marks/ })).not.toBeInTheDocument();
  });

  it("does not turn a failed risk read into a zero", () => {
    render(<SchoolStaffHome session={session("principal")} dashboard={dashboard} atRisk={[]} riskStatus="partial" today={null} todayStatus="unavailable" leaveWaiting={null} />);
    expect(screen.getByText("This list could not be fully loaded. Open analytics to retry.")).toBeInTheDocument();
    expect(screen.queryByText("No pupils are flagged by the current analytics.")).not.toBeInTheDocument();
  });
});

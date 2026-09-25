import type { Principal, ScopeChecker } from "@vidya/platform";
import type { OrgRepo } from "../repo/org-repo";
import type { StaffAttendanceRepo } from "../repo/staff-attendance-repo";

export type StaffAttendanceSource = (
  principal: Principal, collegeId: string, attendedOn: string,
) => Promise<
  | { access: "ok"; schoolName: string; rows: {
      staffNo: string; fullName: string; teacherStatus: string;
      presence: "present" | "absent" | "late" | "leave" | null;
      note: string | null; updatedAt: string | null;
    }[] }
  | { access: "forbidden" | "not-found" }
>;

/** Reporting's read port. Check role and school scope before loading any rows. */
export function createStaffAttendanceSource(deps: {
  edition: "school" | "college";
  org: Pick<OrgRepo, "getCollege">;
  attendance: StaffAttendanceRepo;
  scopeChecker: ScopeChecker;
}): StaffAttendanceSource {
  return async (principal, collegeId, attendedOn) => {
    if (deps.edition !== "school") return { access: "not-found" };
    if (!principal.roles.includes("admin") && !principal.roles.includes("principal")) return { access: "forbidden" };
    const college = await deps.org.getCollege(collegeId);
    if (college === null) return { access: "not-found" };
    if (!deps.scopeChecker.check(principal, "read", {
      module: "people", resourceType: "teacher-attendance", org: { collegeId },
    }).granted) return { access: "forbidden" };
    const rows = await deps.attendance.forSchoolDate(collegeId, attendedOn);
    return { access: "ok", schoolName: college.name, rows: rows.map(({ teacher, attendance }) => ({
      staffNo: teacher.staffNo, fullName: teacher.fullName, teacherStatus: teacher.status,
      presence: attendance === null ? null : attendance.status as "present" | "absent" | "late" | "leave",
      note: attendance?.note ?? null,
      updatedAt: attendance?.updatedAt.toISOString() ?? null,
    })) };
  };
}

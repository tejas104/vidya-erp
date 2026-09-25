import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@vidya/platform";
import { newId } from "../ids";
import { pplTeacherAttendance, pplTeachers, type PplTeacherAttendanceRow } from "../db/schema";

export type StaffPresence = "present" | "absent" | "late" | "leave";
export type StaffPresenceEntry = { teacherId: string; status: StaffPresence; note?: string | null };

export class InvalidStaffAttendanceTarget extends Error {
  constructor() {
    super("one or more teachers are unavailable in this school");
  }
}

export interface StaffAttendanceRepo {
  forTeachers(teacherIds: readonly string[], attendedOn: string): Promise<PplTeacherAttendanceRow[]>;
  saveBatch(input: {
    collegeId: string;
    attendedOn: string;
    markedBy: string;
    entries: readonly StaffPresenceEntry[];
  }): Promise<{ rows: PplTeacherAttendanceRow[]; before: PplTeacherAttendanceRow[] }>;
}

export function createStaffAttendanceRepo(db: Db): StaffAttendanceRepo {
  return {
    async forTeachers(teacherIds, attendedOn) {
      if (teacherIds.length === 0) return [];
      return db.select().from(pplTeacherAttendance).where(and(
        inArray(pplTeacherAttendance.teacherId, [...teacherIds]),
        eq(pplTeacherAttendance.attendedOn, attendedOn),
      ));
    },
    async saveBatch({ collegeId, attendedOn, markedBy, entries }) {
      if (entries.length === 0) return { rows: [], before: [] };
      const teacherIds = [...new Set(entries.map((entry) => entry.teacherId))].sort();
      if (teacherIds.length !== entries.length) throw new InvalidStaffAttendanceTarget();
      return db.transaction(async (tx) => {
        // Lock the teachers in a stable order. A concurrent save for an
        // overlapping roster waits rather than silently racing validation.
        const teachers = await tx.select({ id: pplTeachers.id }).from(pplTeachers).where(and(
          eq(pplTeachers.collegeId, collegeId),
          eq(pplTeachers.status, "active"),
          inArray(pplTeachers.id, teacherIds),
        )).orderBy(asc(pplTeachers.id)).for("update");
        if (teachers.length !== teacherIds.length) throw new InvalidStaffAttendanceTarget();
        const before = await tx.select().from(pplTeacherAttendance).where(and(
          eq(pplTeacherAttendance.attendedOn, attendedOn),
          inArray(pplTeacherAttendance.teacherId, teacherIds),
        ));
        const rows: PplTeacherAttendanceRow[] = [];
        for (const entry of entries) {
          const note = entry.note?.trim() || null;
          const [row] = await tx.insert(pplTeacherAttendance).values({
            id: newId("sat"), collegeId, teacherId: entry.teacherId,
            attendedOn, status: entry.status, note, markedBy,
          }).onConflictDoUpdate({
            target: [pplTeacherAttendance.teacherId, pplTeacherAttendance.attendedOn],
            set: { status: entry.status, note, markedBy, updatedAt: new Date() },
          }).returning();
          rows.push(row!);
        }
        return { rows, before };
      });
    },
  };
}

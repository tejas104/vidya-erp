import type { PeopleDirectory } from "@vidya/module-people";
import type { TimetableRepo } from "./repo";
import type { TtbEntryRow } from "./db/schema";

export { SlotClashError, createTimetableRepo, type TimetableRepo, type NewEntry } from "./repo";

/** The row shape the view builders need (repo rows satisfy it). */
export type TtbEntryRowLike = Pick<
  TtbEntryRow,
  "id" | "sectionId" | "classId" | "subjectId" | "teacherId" | "room" | "dayOfWeek" | "periodNo"
>;

export interface TimetablePeriod {
  periodNo: number;
  starts: string;
  ends: string;
}
export interface TimetableEntryView {
  id: string;
  sectionId: string;
  subjectId: string;
  subjectName: string;
  teacherId: string;
  teacherName: string;
  room: string;
  dayOfWeek: number;
  periodNo: number;
}

/**
 * PUBLIC read model — what other modules (the student portal) may consume.
 * Names resolved through the people directory; no scope logic here (the
 * caller owns disclosure: portal = self-scope, handlers = ScopeChecker).
 */
export interface TimetableReadModel {
  periods(collegeId: string): Promise<TimetablePeriod[]>;
  sectionGrid(sectionId: string, academicYear: string): Promise<TimetableEntryView[]>;
  sectionDay(sectionId: string, academicYear: string, dayOfWeek: number): Promise<TimetableEntryView[]>;
  /** Lessons booked in a room on a weekday — the exams module's clash advisory. */
  roomDay(collegeId: string, room: string, academicYear: string, dayOfWeek: number): Promise<TimetableEntryView[]>;
}

export function createTimetableReadModel(
  repo: TimetableRepo,
  directory: PeopleDirectory,
): TimetableReadModel {
  async function enrich(rows: TtbEntryRowLike[]): Promise<TimetableEntryView[]> {
    const ids = new Set<string>();
    for (const row of rows) {
      ids.add(row.subjectId);
      ids.add(row.teacherId);
    }
    const names = await directory.namesFor([...ids]);
    return rows.map((row) => ({
      id: row.id,
      sectionId: row.sectionId,
      subjectId: row.subjectId,
      subjectName: names.get(row.subjectId) ?? row.subjectId,
      teacherId: row.teacherId,
      teacherName: names.get(row.teacherId) ?? row.teacherId,
      room: row.room,
      dayOfWeek: row.dayOfWeek,
      periodNo: row.periodNo,
    }));
  }

  return {
    async periods(collegeId) {
      const rows = await repo.periodsFor(collegeId);
      return rows.map((p) => ({ periodNo: p.periodNo, starts: p.starts, ends: p.ends }));
    },
    async sectionGrid(sectionId, academicYear) {
      return enrich(await repo.entriesForSection(sectionId, academicYear));
    },
    async sectionDay(sectionId, academicYear, dayOfWeek) {
      const rows = await repo.entriesForSection(sectionId, academicYear);
      return enrich(rows.filter((row) => row.dayOfWeek === dayOfWeek));
    },
    async roomDay(collegeId, room, academicYear, dayOfWeek) {
      return enrich(await repo.entriesForRoomDay(collegeId, room, academicYear, dayOfWeek));
    },
  };
}

import { sql } from "drizzle-orm";
import type { Db } from "@vidya/platform";

/** Public integrity read for a proposed pupil progression correction. */
export async function academicsHasPupilYearRecords(db: Db, studentId: string, year: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT (
      EXISTS (SELECT 1 FROM acd_attendance_entries e JOIN acd_attendance_sessions s ON s.id=e.session_id WHERE e.student_id=${studentId} AND s.academic_year=${year})
      OR EXISTS (SELECT 1 FROM acd_marks m JOIN acd_assessments a ON a.id=m.assessment_id WHERE m.student_id=${studentId} AND a.academic_year=${year})
    ) AS dependent`);
  return result.rows[0]?.dependent === true;
}

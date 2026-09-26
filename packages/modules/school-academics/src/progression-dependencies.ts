import { sql } from "drizzle-orm";
import type { Db } from "@vidya/platform";

export async function schoolAcademicsHasPupilYearRecords(db: Db, studentId: string, year: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (SELECT 1 FROM sca_marks m JOIN sca_assessments a ON a.id=m.assessment_id WHERE m.student_id=${studentId} AND a.academic_year=${year}) AS dependent`);
  return result.rows[0]?.dependent === true;
}

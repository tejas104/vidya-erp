import { sql } from "drizzle-orm";
import type { Db } from "@vidya/platform";

export async function courseworkHasPupilYearRecords(db: Db, studentId: string, year: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (SELECT 1 FROM cwk_submissions s JOIN cwk_assignments a ON a.id=s.assignment_id WHERE s.student_id=${studentId} AND a.academic_year=${year}) AS dependent`);
  return result.rows[0]?.dependent === true;
}

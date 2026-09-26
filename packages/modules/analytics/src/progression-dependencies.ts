import { sql } from "drizzle-orm";
import type { Db } from "@vidya/platform";

export async function analyticsHasPupilYearRecords(db: Db, studentId: string, year: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (SELECT 1 FROM anl_student_flags WHERE student_id=${studentId} AND academic_year=${year}) AS dependent`);
  return result.rows[0]?.dependent === true;
}

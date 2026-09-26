import { sql } from "drizzle-orm";
import type { Db } from "@vidya/platform";

export async function reportingHasPupilYearRecords(db: Db, studentId: string, year: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT (
      EXISTS (SELECT 1 FROM rpt_school_report_cards WHERE student_id=${studentId} AND academic_year=${year})
      OR EXISTS (SELECT 1 FROM rpt_reports WHERE params->>'studentId'=${studentId} AND academic_year=${year})
    ) AS dependent`);
  return result.rows[0]?.dependent === true;
}

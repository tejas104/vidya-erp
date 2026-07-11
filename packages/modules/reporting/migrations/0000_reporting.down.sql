-- Rollback of 0000_reporting. Drops report bookkeeping only; MinIO
-- artifacts (reports/*) are orphaned and should be swept by an object
-- lifecycle rule (docs/runbook.md).

DROP TABLE rpt_reports;

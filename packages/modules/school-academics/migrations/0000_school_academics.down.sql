-- Rollback of 0000_school_terms. Destroys every term row; the close/reopen
-- trail survives in the system module's append-only audit log.
DROP TABLE sch_terms;

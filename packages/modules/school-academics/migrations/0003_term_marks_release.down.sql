DROP TRIGGER sca_clear_marks_release_on_reopen ON sca_terms;
DROP FUNCTION sca_clear_marks_release_on_reopen();
ALTER TABLE sca_terms DROP CONSTRAINT sca_marks_release_closed_check;
ALTER TABLE sca_terms DROP COLUMN marks_released_at;

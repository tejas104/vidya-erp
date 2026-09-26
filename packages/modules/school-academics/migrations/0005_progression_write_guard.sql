CREATE FUNCTION sca_guard_progression_mark() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ppl_guard_progression_year(NEW.student_id,
    (SELECT academic_year FROM sca_assessments WHERE id = NEW.assessment_id));
  RETURN NEW;
END;
$$;
CREATE TRIGGER sca_mark_progression_guard BEFORE INSERT OR UPDATE OF assessment_id, student_id ON sca_marks
  FOR EACH ROW EXECUTE FUNCTION sca_guard_progression_mark();

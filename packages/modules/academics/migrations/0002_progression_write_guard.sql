CREATE FUNCTION acd_guard_progression_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ppl_guard_progression_year(NEW.student_id,
    (SELECT academic_year FROM acd_attendance_sessions WHERE id = NEW.session_id));
  RETURN NEW;
END;
$$;
CREATE TRIGGER acd_entry_progression_guard BEFORE INSERT OR UPDATE OF session_id, student_id ON acd_attendance_entries
  FOR EACH ROW EXECUTE FUNCTION acd_guard_progression_entry();

CREATE FUNCTION acd_guard_progression_mark() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ppl_guard_progression_year(NEW.student_id,
    (SELECT academic_year FROM acd_assessments WHERE id = NEW.assessment_id));
  RETURN NEW;
END;
$$;
CREATE TRIGGER acd_mark_progression_guard BEFORE INSERT OR UPDATE OF assessment_id, student_id ON acd_marks
  FOR EACH ROW EXECUTE FUNCTION acd_guard_progression_mark();

CREATE FUNCTION cwk_guard_progression_submission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ppl_guard_progression_year(NEW.student_id,
    (SELECT academic_year FROM cwk_assignments WHERE id = NEW.assignment_id));
  RETURN NEW;
END;
$$;
CREATE TRIGGER cwk_submission_progression_guard BEFORE INSERT OR UPDATE OF assignment_id, student_id ON cwk_submissions
  FOR EACH ROW EXECUTE FUNCTION cwk_guard_progression_submission();

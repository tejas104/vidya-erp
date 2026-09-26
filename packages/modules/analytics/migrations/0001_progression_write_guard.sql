CREATE FUNCTION anl_guard_progression_flag() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ppl_guard_progression_year(NEW.student_id, NEW.academic_year);
  RETURN NEW;
END;
$$;
CREATE TRIGGER anl_flag_progression_guard BEFORE INSERT OR UPDATE OF student_id, academic_year ON anl_student_flags
  FOR EACH ROW EXECUTE FUNCTION anl_guard_progression_flag();

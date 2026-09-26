-- Public database boundary for modules that write pupil/year records. A
-- correction and each dependent write take the same transaction lock. The
-- writer that commits first determines whether the correction may proceed.
CREATE FUNCTION ppl_lock_progression_year(p_student_id text, p_academic_year text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_student_id || '|' || p_academic_year, 64012026));
END;
$$;

CREATE FUNCTION ppl_guard_progression_year(p_student_id text, p_academic_year text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_student_id IS NULL OR p_academic_year IS NULL THEN RETURN; END IF;
  PERFORM ppl_lock_progression_year(p_student_id, p_academic_year);
  IF EXISTS (
    SELECT 1 FROM ppl_enrollments
    WHERE student_id = p_student_id AND academic_year = p_academic_year AND status = 'voided'
  ) AND NOT EXISTS (
    SELECT 1 FROM ppl_enrollments
    WHERE student_id = p_student_id AND academic_year = p_academic_year AND status <> 'voided'
  ) THEN
    RAISE EXCEPTION 'Cannot record data against a corrected next-year placement'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

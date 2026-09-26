CREATE FUNCTION rpt_guard_progression_report() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.params ? 'studentId' THEN
    PERFORM ppl_guard_progression_year(NEW.params->>'studentId', NEW.academic_year);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER rpt_report_progression_guard BEFORE INSERT OR UPDATE OF params, academic_year ON rpt_reports
  FOR EACH ROW EXECUTE FUNCTION rpt_guard_progression_report();

CREATE FUNCTION rpt_guard_progression_card() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ppl_guard_progression_year(NEW.student_id, NEW.academic_year);
  RETURN NEW;
END;
$$;
CREATE TRIGGER rpt_card_progression_guard BEFORE INSERT ON rpt_school_report_cards
  FOR EACH ROW EXECUTE FUNCTION rpt_guard_progression_card();

CREATE FUNCTION fee_guard_progression_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ppl_guard_progression_year(NEW.student_id, NEW.academic_year);
  RETURN NEW;
END;
$$;
CREATE TRIGGER fee_invoice_progression_guard BEFORE INSERT OR UPDATE OF student_id, academic_year ON fee_invoices
  FOR EACH ROW EXECUTE FUNCTION fee_guard_progression_invoice();

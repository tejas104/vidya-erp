ALTER TABLE sca_terms ADD COLUMN scale_id text, ADD COLUMN scale_name text, ADD COLUMN grade_bands jsonb;
ALTER TABLE sca_terms ADD CONSTRAINT sca_terms_scale_check CHECK (
  (scale_id IS NULL AND scale_name IS NULL AND grade_bands IS NULL) OR
  (scale_id IS NOT NULL AND scale_name IS NOT NULL AND grade_bands IS NOT NULL AND jsonb_typeof(grade_bands) = 'array')
);

CREATE TABLE sca_assessments (
  id text PRIMARY KEY,
  term_id text NOT NULL REFERENCES sca_terms(id) ON DELETE RESTRICT,
  type_id text NOT NULL REFERENCES sca_assessment_types(id) ON DELETE RESTRICT,
  college_id text NOT NULL, department_id text NOT NULL, class_id text NOT NULL, subject_id text NOT NULL,
  name text NOT NULL, academic_year text NOT NULL,
  max_score numeric(6,2) NOT NULL CHECK (max_score > 0 AND max_score <= 9999.99),
  held_on date NOT NULL, created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sca_assessments_name_idx ON sca_assessments(term_id, class_id, subject_id, name);
CREATE INDEX sca_assessments_class_year_idx ON sca_assessments(class_id, academic_year);
CREATE TABLE sca_marks (
  id text PRIMARY KEY,
  assessment_id text NOT NULL REFERENCES sca_assessments(id) ON DELETE RESTRICT,
  student_id text NOT NULL,
  score numeric(6,2) NOT NULL CHECK (score >= 0 AND score <= 9999.99),
  percentage numeric(5,2) NOT NULL CHECK (percentage BETWEEN 0 AND 100),
  grade text NOT NULL,
  points numeric(5,2) NOT NULL CHECK (points BETWEEN 0 AND 10),
  recorded_by text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sca_marks_assessment_student_idx ON sca_marks(assessment_id, student_id);
CREATE INDEX sca_marks_student_idx ON sca_marks(student_id);

-- The first assessment fixes the term's grade-band snapshot and weighting plan.
-- Reopening allows marks corrections, never retroactive changes to that basis.
CREATE FUNCTION sca_guard_used_types() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_term text;
BEGIN
  IF TG_OP = 'DELETE' THEN target_term := OLD.term_id; ELSE target_term := NEW.term_id; END IF;
  PERFORM 1 FROM sca_terms WHERE id = target_term FOR UPDATE;
  IF EXISTS (SELECT 1 FROM sca_assessments WHERE term_id = target_term) THEN
    RAISE EXCEPTION 'assessment configuration is already in use' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
CREATE TRIGGER sca_used_types_guard BEFORE INSERT OR UPDATE OR DELETE ON sca_assessment_types
FOR EACH ROW EXECUTE FUNCTION sca_guard_used_types();

CREATE FUNCTION sca_guard_assessment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE term sca_terms%ROWTYPE; type_term text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'school assessments are immutable' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO term FROM sca_terms WHERE id = NEW.term_id FOR UPDATE;
  SELECT term_id INTO type_term FROM sca_assessment_types WHERE id = NEW.type_id;
  IF term.status <> 'open' OR term.grade_bands IS NULL THEN
    RAISE EXCEPTION 'an open term with a grading basis is required' USING ERRCODE = '23514';
  END IF;
  IF type_term IS DISTINCT FROM NEW.term_id OR term.college_id <> NEW.college_id
     OR term.department_id <> NEW.department_id OR term.academic_year <> NEW.academic_year
     OR NEW.held_on < term.starts_on OR NEW.held_on > term.ends_on THEN
    RAISE EXCEPTION 'assessment does not belong to this term' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sca_assessment_guard BEFORE INSERT OR UPDATE OR DELETE ON sca_assessments
FOR EACH ROW EXECUTE FUNCTION sca_guard_assessment();

CREATE FUNCTION sca_guard_mark() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_assessment text; term_status text; maximum numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN target_assessment := OLD.assessment_id; ELSE target_assessment := NEW.assessment_id; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.assessment_id <> OLD.assessment_id OR NEW.student_id <> OLD.student_id) THEN
    RAISE EXCEPTION 'a mark cannot move between students or assessments' USING ERRCODE = '23514';
  END IF;
  SELECT t.status, a.max_score INTO term_status, maximum
    FROM sca_assessments a JOIN sca_terms t ON t.id = a.term_id WHERE a.id = target_assessment FOR UPDATE OF t;
  IF term_status = 'closed' THEN
    RAISE EXCEPTION 'reopen the term before changing marks' USING ERRCODE = '23514';
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.score > maximum THEN
    RAISE EXCEPTION 'score exceeds maximum' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
CREATE TRIGGER sca_mark_guard BEFORE INSERT OR UPDATE OR DELETE ON sca_marks
FOR EACH ROW EXECUTE FUNCTION sca_guard_mark();

CREATE FUNCTION sca_guard_grade_basis() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.grade_bands IS DISTINCT FROM OLD.grade_bands OR NEW.scale_id IS DISTINCT FROM OLD.scale_id OR NEW.scale_name IS DISTINCT FROM OLD.scale_name)
     AND EXISTS (SELECT 1 FROM sca_assessments WHERE term_id = OLD.id) THEN
    RAISE EXCEPTION 'the term grading basis is already in use' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sca_grade_basis_guard BEFORE UPDATE ON sca_terms
FOR EACH ROW EXECUTE FUNCTION sca_guard_grade_basis();

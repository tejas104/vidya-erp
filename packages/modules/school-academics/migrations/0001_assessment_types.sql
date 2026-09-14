-- School-only runtime feature; all editions retain the same migration journal.
-- A distribution is replaced atomically while holding the parent term row lock.
CREATE TABLE sca_assessment_types (
  id text PRIMARY KEY,
  term_id text NOT NULL REFERENCES sca_terms(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  weight integer NOT NULL CHECK (weight BETWEEN 1 AND 100)
);
-- Supports the per-term configuration read, replacement and future mark joins.
CREATE INDEX sca_assessment_types_term_idx ON sca_assessment_types(term_id);
CREATE UNIQUE INDEX sca_assessment_types_name_idx ON sca_assessment_types(term_id, lower(name));

-- Serialize all writers on the parent, including direct SQL, and preserve the
-- closed-term rule at the storage boundary. A type never moves between terms.
CREATE FUNCTION sca_guard_assessment_configuration() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_term text; term_status text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.term_id <> OLD.term_id THEN
    RAISE EXCEPTION 'assessment types cannot move between terms' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN target_term := OLD.term_id; ELSE target_term := NEW.term_id; END IF;
  SELECT status INTO term_status FROM sca_terms WHERE id = target_term FOR UPDATE;
  IF term_status = 'closed' THEN
    RAISE EXCEPTION 'reopen the term before changing assessment types' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
CREATE TRIGGER sca_assessment_configuration_guard
BEFORE INSERT OR UPDATE OR DELETE ON sca_assessment_types
FOR EACH ROW EXECUTE FUNCTION sca_guard_assessment_configuration();

-- Deferred validation allows an atomic replacement while preventing a partial
-- distribution from committing, including writes outside the application.
CREATE FUNCTION sca_check_assessment_weights() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_term text;
BEGIN
  IF TG_OP = 'DELETE' THEN target_term := OLD.term_id; ELSE target_term := NEW.term_id; END IF;
  IF EXISTS (SELECT 1 FROM sca_assessment_types WHERE term_id = target_term)
     AND (SELECT sum(weight) FROM sca_assessment_types WHERE term_id = target_term) <> 100 THEN
    RAISE EXCEPTION 'assessment weights must total 100%%' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER sca_assessment_weights_total
AFTER INSERT OR UPDATE OR DELETE ON sca_assessment_types
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sca_check_assessment_weights();

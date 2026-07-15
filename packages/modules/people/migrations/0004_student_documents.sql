-- Module: people — student documents (2.5). Photo / ID / marksheet / TC in
-- object storage; org denormalized for scope checks.

CREATE TABLE ppl_student_documents (
  id text PRIMARY KEY,
  student_id text NOT NULL,
  college_id text NOT NULL,
  department_id text NOT NULL,
  class_id text NOT NULL,
  section_id text NOT NULL,
  kind text NOT NULL
    CONSTRAINT ppl_docs_kind_check CHECK (kind IN ('photo', 'id_proof', 'marksheet', 'tc', 'other')),
  filename text NOT NULL,
  content_type text NOT NULL,
  size_bytes integer NOT NULL,
  object_key text NOT NULL,
  uploaded_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ppl_docs_student_idx ON ppl_student_documents (student_id);

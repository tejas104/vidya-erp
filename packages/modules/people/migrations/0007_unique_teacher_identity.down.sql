DROP INDEX ppl_teachers_identity_idx;
CREATE INDEX ppl_teachers_identity_idx ON ppl_teachers (identity_user_id);

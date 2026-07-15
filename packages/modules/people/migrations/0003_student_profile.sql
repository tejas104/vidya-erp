-- Module: people — student profile depth (2.5). Personal + guardian contact.
-- Nullable; existing rows keep NULL until filled.

ALTER TABLE ppl_students ADD COLUMN phone text;
ALTER TABLE ppl_students ADD COLUMN guardian_name text;
ALTER TABLE ppl_students ADD COLUMN guardian_phone text;
ALTER TABLE ppl_students ADD COLUMN dob date;

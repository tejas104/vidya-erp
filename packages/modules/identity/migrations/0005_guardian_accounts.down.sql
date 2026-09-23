-- Down: drops the kind; any guardian accounts become role-less staff
-- accounts, which hold no authority beyond their own session.
ALTER TABLE idn_users DROP COLUMN account_kind;

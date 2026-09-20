DROP INDEX fee_payments_idempotency_uq;
ALTER TABLE fee_payments DROP COLUMN idempotency_key;

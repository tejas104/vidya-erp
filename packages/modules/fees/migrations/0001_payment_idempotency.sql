-- A cashier can retry the same payment after a timeout without issuing a
-- second receipt. The column stays nullable for rows written before this
-- migration; the API requires a key for every new payment.
ALTER TABLE fee_payments ADD COLUMN idempotency_key text;

CREATE UNIQUE INDEX fee_payments_idempotency_uq
  ON fee_payments (college_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

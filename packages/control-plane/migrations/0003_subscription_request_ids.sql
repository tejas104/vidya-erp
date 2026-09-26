-- Existing events predate request keys. Backfill from their immutable event IDs
-- inside this migration transaction, then restore the append-only trigger.
ALTER TABLE cp_subscription_events ADD COLUMN request_id uuid;
DROP TRIGGER cp_subscription_events_immutable ON cp_subscription_events;
UPDATE cp_subscription_events SET request_id = id;
ALTER TABLE cp_subscription_events ALTER COLUMN request_id SET NOT NULL;
ALTER TABLE cp_subscription_events ADD CONSTRAINT cp_subscription_events_request_id_key UNIQUE (request_id);
CREATE TRIGGER cp_subscription_events_immutable BEFORE UPDATE OR DELETE ON cp_subscription_events
  FOR EACH ROW EXECUTE FUNCTION cp_reject_history_change();

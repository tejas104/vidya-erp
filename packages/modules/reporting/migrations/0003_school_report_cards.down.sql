-- Reverses 0003_school_report_cards.
--
-- The triggers must go before the table: dropping the table takes its triggers
-- with it, but the shared function is table-independent and is dropped
-- explicitly so the rollback leaves no orphan.
DROP TRIGGER IF EXISTS rpt_school_report_cards_no_delete ON rpt_school_report_cards;
DROP TRIGGER IF EXISTS rpt_school_report_cards_no_update ON rpt_school_report_cards;
DROP TABLE IF EXISTS rpt_school_report_cards;
DROP FUNCTION IF EXISTS rpt_school_report_cards_immutable();

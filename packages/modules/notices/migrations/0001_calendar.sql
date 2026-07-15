-- Module: notices — the noticeboard doubles as the academic calendar.
-- A notice with an event_date shows on the calendar; kind colours it
-- (notice / holiday / exam / event).

ALTER TABLE ntc_notices ADD COLUMN kind text NOT NULL DEFAULT 'notice';
ALTER TABLE ntc_notices ADD COLUMN event_date date;

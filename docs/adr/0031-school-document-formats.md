# ADR-0031: School document formats are controlled, versioned presentation

- **Status:** Accepted for local implementation
- **Date:** 2026-09-26
- **Scope:** School report cards, attendance review PDFs, and future certificates

## Context

The owner wants each school to supply a PDF or DOCX example and to edit its own
document format in Vidya. Report cards are permanent records, while attendance
exports are queued. Applying the latest layout at download time would silently
change an old report card. Executing an uploaded PDF or DOCX as a template would
also give untrusted document content control over generated pupil records.

## Decision

Administrators edit a small, validated presentation contract: school name,
accent colour, and footer. A PDF or DOCX sample may be uploaded to private
storage as a reference for mapping; Vidya never parses it for values or runs it
as a rendering program. Samples are bounded to 1 MB, checked for expected file
signatures, served only after a fresh administrator school-scope check, and
downloaded as attachments. A sample alone does not change a generated layout.

Each save appends a school and document-family version with an optimistic
version check and a database-level no-update/no-delete guard. The format save
and its audit event share one database transaction. Report-card issuance stores
the chosen style on its immutable snapshot. An attendance report stores it when
the request is queued, before the worker runs. Existing documents with no style
keep the original Vidya presentation. PDF renderers read only that frozen style
and the verified record snapshot; editable presentation fields cannot override
marks, attendance, identity, or provenance.

The certificate family can be configured now, but certificate issuance and its
PDF renderer are a separate N7 slice. Any later layout editor must remain a
bounded, typed format with allowed fields, preview, page-flow validation, and
the same freezing rule. Uploaded samples need human mapping to that editor;
pixel-identical automatic conversion is not claimed.

## Consequences

The first editor controls branding and footer, not arbitrary page geometry or
fonts. On a version conflict after an object upload, an unreferenced private
sample object may remain; it is inaccessible through Vidya and will need an
ownership-aware reconciliation job before a production pilot. The local demo
uses only fictional documents; a real-school sample requires a retention and
consent policy before upload.

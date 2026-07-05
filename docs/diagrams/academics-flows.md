# Academics flows

## Component view

```mermaid
flowchart LR
    subgraph pipeline["defineRoute pipeline"]
        H["academics handlers — EVERY decision → checkScope()"]
    end
    subgraph academics["@vidya/module-academics (acd_)"]
        REFS["resource-refs.ts (ONE page):\nattendanceRef → NO subjectId\nmarksRef → subjectId ALWAYS"]
        H --> REFS
        H --> ATT["AttendanceService"]
        H --> MRK["MarksService"]
        ATT & MRK --> REPO["Drizzle repos"]
        GAP["attendance-gap-scan (daily worker job)"] --> ATT
    end
    REFS -.->|ResourceRef| SC["ScopeChecker (HUMAN core, ADR-0010)"]
    ATT & MRK -->|"paths, rosters, positions"| DIR["PeopleDirectory (#3 public API)"]
    H -->|mark history| AUD["system.readAuditEventsForResource"]
    REPO --> PG[("Postgres acd_* — denormalized org paths")]
```

## Marksheet entry (bulk) with the grade-change trail

```mermaid
sequenceDiagram
    autonumber
    participant T as Subject teacher (session)
    participant P as Pipeline (teacher role gate)
    participant H as marks-enter handler
    participant SC as ScopeChecker (HUMAN)
    participant MS as MarksService
    participant DIR as PeopleDirectory (#3)
    participant DB as acd_marks
    participant AU as Audit (append-only)

    T->>P: PUT /assessments/{id}/marks {entries[]}
    P->>H: validated body
    H->>H: marksRef(assessment) — class path + subjectId FROM THE ROW
    H->>SC: check(principal, "update", marksRef)
    alt not this subject's teacher
        SC-->>H: denied → 403 (nothing read or written)
    else granted
        H->>MS: enterMarks(assessment, entries)
        MS->>MS: validate ALL: score ≤ maxScore, no duplicates
        MS->>DIR: studentPosition(each) — enrolled in THIS class?
        alt any invalid
            MS-->>H: InvalidEntriesError → 422 {per-entry reasons} (no writes)
        else
            MS->>DB: upsert in one tx → per-entry diffs {before, after}
            H->>AU: academics.marks-entered {actor, changes: diffs (≤100)}
            H-->>T: 200 {created, updated, unchanged}
        end
    end
    Note over AU: corrections (PATCH /marks/{id}) audit the same way;<br/>GET /marks/{id}/history reassembles the full trail
```

## Attendance session

```mermaid
sequenceDiagram
    autonumber
    participant CT as Class teacher (session)
    participant H as attendance-record handler
    participant SC as ScopeChecker (HUMAN)
    participant AS as AttendanceService
    participant DIR as PeopleDirectory (#3)

    CT->>H: POST /attendance/sessions {sectionId, date, entries[]}
    H->>DIR: sectionPath(sectionId) → full path (404 if unknown)
    H->>SC: check(principal, "create", attendanceRef(path)) — NO subjectId
    Note over SC: teacher role would be DENIED here (non-subject write);<br/>class_teacher of this class is GRANTED
    H->>AS: recordSession(...)
    AS->>DIR: sectionRoster — every entry must be on the LIVE roster
    AS->>AS: stamp org path onto the session; insert session+entries in one tx
    H-->>CT: 201 (audited with status counts)
```

## ER (acd_)

```mermaid
erDiagram
    ACD_ATTENDANCE_SESSIONS ||--o{ ACD_ATTENDANCE_ENTRIES : contains
    ACD_ASSESSMENTS ||--o{ ACD_MARKS : "RESTRICT delete"
    ACD_ATTENDANCE_SESSIONS {
        text section_id "opaque #3 ref"
        date held_on
        text slot "UNIQUE(section,date,slot)"
        text college_id "denormalized path"
        text department_id "denormalized path"
        text class_id "denormalized path"
    }
    ACD_ATTENDANCE_ENTRIES {
        text student_id "opaque #3 ref"
        text status "present|absent|late|excused"
    }
    ACD_ASSESSMENTS {
        text class_id "opaque #3 ref"
        text subject_id "THE subject bit (ADR-0017)"
        text kind "exam|quiz|assignment (enum)"
        numeric max_score
        text college_id "denormalized path"
        text department_id "denormalized path"
    }
    ACD_MARKS {
        text student_id "opaque #3 ref"
        numeric score "0 <= score; <= max in service"
        text recorded_by
        text updated_at "history lives in the audit log"
    }
```

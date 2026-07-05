# People-module flows

## Component view

```mermaid
flowchart LR
    subgraph pipeline["defineRoute pipeline"]
        H["people handlers — EVERY record decision → checkScope()"]
    end
    subgraph people["@vidya/module-people (ppl_)"]
        H --> ORG["OrgService (+ OrgDirectory impl)"]
        H --> PEO["PeopleService (students/teachers/enrollment)"]
        H --> ASG["AssignmentsService — the ADR-0015 seam"]
        H --> IMP["ImportService"]
        ORG & PEO & ASG --> REPO["Drizzle repos"]
        IMP --> S3[("MinIO/S3 — CSV objects")]
        IMP --> REPO
    end
    subgraph identity["@vidya/module-identity"]
        SC["ScopeChecker (HUMAN core)"]
        DG["derivedGrants API"]
        GV["grants-verify (backfill)"]
    end
    H -.-> SC
    ASG -->|"upsert / removeBySourceRef / list"| DG
    GV -->|"OrgDirectory (platform interface, late-bound)"| ORG
    REPO --> PG[("Postgres ppl_*")]
    DG --> IDPG[("identity grants table")]
    subgraph worker["apps/worker"]
        IJOB["bulk-import job"]
        RJOB["grant-reconcile job (hourly)"]
    end
    IJOB --> IMP
    RJOB --> ASG
```

## Assignment → derived grant → live authority

```mermaid
sequenceDiagram
    autonumber
    participant A as Admin (session)
    participant P as Pipeline (admin role + scope check @ class path)
    participant AS as AssignmentsService (people)
    participant DG as identity.derivedGrants
    participant SM as SessionManager (HUMAN)
    participant AU as Audit

    A->>P: POST /teachers/{id}/assignments {class, subject, kind}
    P->>AS: create(...)
    AS->>AS: write ppl_teacher_assignments row
    AS->>DG: upsert({userId, role, class-level org, subject, sourceRef})
    alt identity call fails
        AS->>AS: DELETE the row (compensation)
        AS-->>P: error → request fails (no silent drift)
    else
        DG->>DG: ensure role membership; write grant (source=derived, verified=true)
        DG->>SM: invalidateAllForUser(teacher)
        DG->>AU: identity.grant-derived {sourceRef}
        P->>AU: people.assignment-created
        P-->>A: 201
    end
    Note over SM: the teacher's NEXT login carries the new grant —<br/>no session ever holds stale authority (#2 invariant)
```

## Bulk import

```mermaid
sequenceDiagram
    autonumber
    participant A as Admin
    participant W as Web (import-create: admin role + scope, audit)
    participant S3 as MinIO
    participant Q as BullMQ (people queue)
    participant J as Worker (bulk-import job)
    participant DB as Postgres

    A->>W: POST /imports {kind, collegeId, csv, dryRun}
    W->>S3: put imports/<uuid>.csv
    W->>DB: ppl_imports row (pending)
    W->>Q: enqueue {importId}
    W-->>A: 202 {importId}
    J->>S3: get CSV
    J->>J: parse (csv-parse) → zod per row → in-file dups →<br/>batched DB dups → section lookup from ONE tree read
    alt dryRun
        J->>DB: finish(completed, counts, row errors) — no writes
    else apply
        J->>DB: per-row insert student (+ enrollment), errors collected
        J->>DB: finish(completed, counts, first 500 row errors)
    end
    J->>DB: audit people.import-completed {actor = requester, counts}
    A->>W: GET /imports/{importId} → status, counts, per-row errors
```

## ER (ppl_)

```mermaid
erDiagram
    PPL_COLLEGES ||--o{ PPL_DEPARTMENTS : contains
    PPL_DEPARTMENTS ||--o{ PPL_CLASSES : contains
    PPL_DEPARTMENTS ||--o{ PPL_SUBJECTS : offers
    PPL_CLASSES ||--o{ PPL_SECTIONS : contains
    PPL_COLLEGES ||--o{ PPL_STUDENTS : admits
    PPL_COLLEGES ||--o{ PPL_TEACHERS : employs
    PPL_STUDENTS ||--o{ PPL_ENROLLMENTS : "one live per year"
    PPL_SECTIONS ||--o{ PPL_ENROLLMENTS : receives
    PPL_TEACHERS ||--o{ PPL_TEACHER_ASSIGNMENTS : holds
    PPL_CLASSES ||--o{ PPL_TEACHER_ASSIGNMENTS : staffed_by
    PPL_SUBJECTS o|--o{ PPL_TEACHER_ASSIGNMENTS : "subject_teacher only"
    PPL_COLLEGES ||--o{ PPL_IMPORTS : tracks
    PPL_TEACHERS {
        text identity_user_id "opaque link to identity, NO FK"
    }
    PPL_TEACHER_ASSIGNMENTS {
        text kind "subject_teacher | class_teacher (CHECK)"
        text academic_year
    }
```

All deletes up the tree are RESTRICT; enrollment cascades from student.
Derived grants live in the identity module keyed by
`source_ref = people:assignment:<id>` (ADR-0015).

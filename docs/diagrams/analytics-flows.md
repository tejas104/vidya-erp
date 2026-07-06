# Analytics flows

## Component view

```mermaid
flowchart LR
    subgraph ui["apps/web — The Register (client, pure API consumer)"]
        LOGIN["/login"]
        DASH["/dashboard (permission mirror)"]
        STU["/students/[id]"]
    end
    subgraph pipeline["defineRoute pipeline"]
        H["analytics handlers"]
    end
    subgraph analytics["@vidya/module-analytics (anl_)"]
        AS["aggregation-scope.ts (ONE page):\nconstituent-closure + cohort floor"]
        H --> AS
        H --> QS["QueryService (serve — scope-enforced)"]
        RB["RollupBuilder (nightly, BLIND compute)"]
        QS --> REPO["Drizzle rollup repo (anl_*)"]
        RB --> REPO
    end
    AS -.->|ResourceRef per constituent| SC["ScopeChecker (HUMAN core)"]
    RB -->|"paged records + positions"| RM["AcademicsReadModel (#4 public)"]
    QS -->|"live per-record filter"| RM
    QS -->|"names, positions, sections"| DIR["PeopleDirectory (#3 public)"]
    LOGIN & DASH & STU -->|"same-origin fetch + cookie"| pipeline
    REPO --> PG[("Postgres anl_* rollups + flags")]
    subgraph worker["apps/worker"]
        JOB["rollup-rebuild (nightly + on-demand)"]
    end
    JOB --> RB
```

## Nightly rebuild (blind compute) → scope-enforced serve

```mermaid
sequenceDiagram
    autonumber
    participant W as Worker (nightly)
    participant RB as RollupBuilder (system actor)
    participant RM as AcademicsReadModel (#4)
    participant PG as anl_* tables
    participant C as Caller (teacher)
    participant H as analytics handler
    participant AS as aggregation-scope
    participant SC as ScopeChecker (HUMAN)

    Note over W,PG: COMPUTE is blind — everything is aggregated
    W->>RB: build(year)
    RB->>RM: attendancePage / marksPage (keyset, 5k)
    RM-->>RB: records WITH org positions
    RB->>PG: replaceYear(rollups + at-risk flags), audited
    Note over C,SC: SERVE is scope-enforced — storage ≠ disclosure
    C->>H: GET /analytics/rollups/class/{id}
    H->>PG: read the node's rollup rows
    H->>AS: closure check per constituent (subject-by-subject for cross-subject)
    AS->>SC: check(read, attendance/marks ref at the node)
    alt closure holds AND cohort ≥ K
        H-->>C: the value
    else denied / small cohort
        H-->>C: designed withheld state (never a raw number)
    end
```

## The cross-subject wall (why "class overall" is denied to a subject teacher)

```mermaid
flowchart TB
    Q["math teacher requests<br/>class OVERALL average"]
    Q --> CH{"closure over<br/>every constituent subject?"}
    CH -->|"math ✓"| M["can read math"]
    CH -->|"physics ✗"| P["cannot read physics"]
    P --> D["DENIED — deniedSubjectId=physics"]
    D --> WHY["overall = f(math, physics);<br/>teacher knows math →<br/>serving overall leaks physics<br/>by differencing"]
    M -.-> D
```

## ER (anl_) — precomputed rollups the module owns

```mermaid
erDiagram
    ANL_ATTENDANCE_ROLLUPS {
        text scope_level "section|class|department|college"
        text node_id "the summarized unit"
        text academic_year
        text period "YTD | YYYY-MM"
        int present
        int distinct_students "cohort gate input"
    }
    ANL_MARKS_ROLLUPS {
        text node_id
        text subject_id "NULL = cross-subject"
        jsonb subjects "constituents for closure check"
        numeric avg_pct
        int distinct_students
    }
    ANL_STUDENT_FLAGS {
        text student_id
        text section_id "position at compute time"
        numeric attendance_pct
        numeric overall_pct
        jsonb subject_pcts "field-gated at serve time"
        jsonb reasons "low-attendance | low-marks"
    }
```

No FK to `acd_*` or `ppl_*` — these are owned, derived rows keyed by opaque
cross-module ids; a full rebuild regenerates them from #4's read model.

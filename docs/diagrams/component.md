# Component diagram

```mermaid
flowchart TB
    subgraph clients["Clients / Probes"]
        LB["Load balancer / K8s probes / Prometheus"]
    end

    subgraph web["apps/web (Next.js, N replicas)"]
        RW["Rewrites: /health /ready /metrics → /api/v1/system/*"]
        RF["Thin route files (app/api/v1/…)"]
        WC["Composition root (src/composition.ts)"]
        PIPE["defineRoute pipeline\nrequest-id → authn → authz → zod → handler → audit → metrics/log"]
        RW --> RF --> WC --> PIPE
    end

    subgraph worker["apps/worker (Node, M replicas)"]
        WM["Composition root (src/main.ts)"]
        BW["BullMQ Worker per module queue\n(zod-validated payloads)"]
        OBS["Observability listener :9464\n/health /ready /metrics"]
        WM --> BW
        WM --> OBS
    end

    subgraph platform["packages/platform (imports NO module)"]
        CFG["zod config"]
        LOG["pino logger"]
        MET["prom-client metrics"]
        DBC["pg pool + drizzle"]
        MIG["migration runner (ADR-0008)"]
        RED["ioredis"]
        QUE["BullMQ factories"]
        S3["S3/MinIO client"]
        AUTHI["Authenticator + AccessPolicy interfaces\n(DenyAll implementations in #1)"]
        AUDI["AuditLogger interface"]
        LIF["Lifecycle (drain + LIFO close hooks)"]
    end

    subgraph modsys["packages/modules/system (public API = index.ts only)"]
        DEF["ModuleDefinition\nroutes · jobs · tablePrefix sys_ · migrations/"]
        SVC["SystemService: audit seam + read-back"]
        HB["audit-heartbeat processor"]
    end

    subgraph state["Declared persistent state (Constitution rule 10)"]
        PG[("PostgreSQL\nsys_audit_log (append-only)\nplatform_migrations")]
        RS[("Redis\nBullMQ queues · sessions (#2)")]
        MO[("MinIO / S3")]
    end

    LB --> RW
    PIPE -- "route handlers via public API" --> modsys
    BW -- "job processors via public API" --> modsys
    WC & WM -- build infra --> platform
    SVC --> DBC --> PG
    MIG --> PG
    QUE --> RS
    RED --> RS
    S3 --> MO
```

**Legend of the enforcement seams:** route files may import only the
composition root; composition roots are the only importers of modules;
platform imports no module; module internals (incl. `sys_*` schema) are
unreachable from outside — by lint (ADR-0006) and by package `exports`.

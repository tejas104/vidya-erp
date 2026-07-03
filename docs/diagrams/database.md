# Database diagram & table-ownership convention

```mermaid
erDiagram
    PLATFORM_MIGRATIONS {
        bigint id PK "identity"
        text module "owning module of the migration"
        text name "e.g. 0000_audit_log (unique with module)"
        timestamptz applied_at
    }
    SYS_AUDIT_LOG {
        bigint id PK "identity"
        timestamptz occurred_at
        text module "acting module"
        text action "dotted verb, e.g. system.heartbeat"
        text actor_type "user | service | system (CHECK)"
        text actor_id "nullable"
        text resource_type
        text resource_id "nullable"
        text request_id "correlation, nullable"
        jsonb details
    }
```

No FK between them — they belong to different owners and audit rows must
outlive anything they reference.

## Ownership convention (Constitution rule 2)

| Prefix | Owner | Notes |
|---|---|---|
| `sys_` | `@vidya/module-system` | `sys_audit_log` is append-only: BEFORE UPDATE/DELETE row triggers and a BEFORE TRUNCATE statement trigger raise exceptions in the database itself. |
| `platform_` | platform migration runner only | Single table `platform_migrations` (journal), exempted by ADR-0008. Modules may never reference it (CI-checked). |
| *(future)* e.g. `idn_`, `att_` | one module each | Declared as `tablePrefix` in the ModuleDefinition; `scripts/check-table-ownership.ts` fails CI on any DDL/`pgTable()` outside the owner's prefix or any cross-prefix mention. |

Cross-module data access happens through the owning module's service API,
never through SQL — schema objects are module-internal and unimportable.

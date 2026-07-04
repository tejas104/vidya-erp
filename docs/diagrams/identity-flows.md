# Identity flows

## Component view

```mermaid
flowchart LR
    subgraph pipeline["defineRoute pipeline (platform)"]
        OG["origin guard"] --> AUTHN["SessionAuthenticator"] --> AUTHZ["RoleRequirementPolicy"] --> VAL["zod params/query/body"] --> H["identity handlers"]
    end
    subgraph identity["@vidya/module-identity"]
        H --> SVC["UsersService / AuthService (Fable)"]
        SVC --> CORE
        H --> SC
        subgraph CORE["src/core — HUMAN-OWNED"]
            PH["PasswordHasher (argon2)"]
            SM["SessionManager (signed tokens)"]
            SC["ScopeChecker (ADR-0010 matrix)"]
        end
        SVC --> REPO["Drizzle repos (idn_*)"]
        SVC --> THR["FailureThrottle"]
    end
    AUTHN --> SM
    REPO --> PG[("Postgres idn_users · idn_user_roles · idn_scope_grants · idn_reset_tokens")]
    SM --> RS[("Redis sessions")]
    THR --> RS
    SVC -- "audit seam" --> SYS[("sys_audit_log (system module)")]
```

## Login sequence

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant P as Pipeline (public route, throttled)
    participant A as AuthService (Fable)
    participant T as FailureThrottle (Redis)
    participant R as UsersRepo (idn_users)
    participant PH as PasswordHasher (HUMAN)
    participant SM as SessionManager (HUMAN)
    participant AU as Audit (sys_audit_log)

    C->>P: POST /api/v1/identity/auth/login {username, password}
    P->>A: login(username, password, ip)
    A->>T: isLocked(user|ip)?
    alt locked
        A-->>P: locked → 429 + Retry-After
    else
        A->>R: findByUsername
        alt unknown user
            A->>PH: verify(dummyHash, password)  — timing equalization
        else known
            A->>PH: verify(storedHash, password)
        end
        alt credential bad / disabled
            A->>T: recordFailure → maybe locked
            A->>AU: identity.login-failed {username, ip, reason}
            A-->>P: 401 (uniform)
        else must_reset
            A->>AU: identity.login-blocked-reset-required
            A-->>P: 403 reset required
        else ok
            A->>T: clear(user|ip)
            A->>R: roles + grants
            A->>SM: issue(snapshot: userId, roles, grants)
            SM-->>A: signed token + sessionId
            A-->>P: success
            P->>AU: identity.login (actor = the user, resource = sessionId)
            P-->>C: 200 + Set-Cookie vidya_session (HttpOnly, Strict, Secure)
        end
    end
```

## Authenticated request with a record-level decision

```mermaid
sequenceDiagram
    autonumber
    participant C as Client (cookie)
    participant P as Pipeline
    participant SM as SessionManager (HUMAN)
    participant H as Handler
    participant SC as ScopeChecker (HUMAN)

    C->>P: GET /api/v1/identity/users/{userId}
    P->>SM: resolve(cookie token)
    SM-->>P: session snapshot → Principal{roles, grants}
    P->>P: RoleRequirementPolicy (route-level)
    P->>H: handler(ctx)
    H->>SC: check(principal, "read", {module, resourceType, org, ownerUserId})
    alt granted (self-access or admin-in-college)
        H-->>P: 200 user view
    else denied
        H-->>P: 403 (reason logged, not leaked)
    end
```

## Database additions (idn_)

```mermaid
erDiagram
    IDN_USERS ||--o{ IDN_USER_ROLES : "has roles"
    IDN_USER_ROLES ||--o{ IDN_SCOPE_GRANTS : "authorizes (composite FK, cascade)"
    IDN_USERS ||--o{ IDN_RESET_TOKENS : "may have"
    IDN_USERS {
        text id PK
        text username "unique lower()"
        text password_hash "argon2 (HUMAN core)"
        text status "active|disabled|must_reset"
        text college_id "opaque, #3 contract"
    }
    IDN_SCOPE_GRANTS {
        text id PK
        text user_id
        text role "shape CHECKed per ADR-0010"
        text college_id
        text department_id "nullable"
        text class_id "nullable"
        text section_id "nullable"
        text subject_id "teacher only"
        boolean verified "false until OrgDirectory (#3)"
    }
    IDN_RESET_TOKENS {
        text id PK
        text token_hash "sha256, never plaintext"
        timestamptz expires_at
        timestamptz used_at "single-use"
    }
```

Sessions are not a table — they live in Redis (SessionManager).

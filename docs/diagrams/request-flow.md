# Request-through-middleware sequence

A state-changing request under the full pipeline (authenticated case shows
the #2 wiring; in #1 the DenyAll authenticator short-circuits at step 3
with 401).

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant N as Next.js (rewrite + route file)
    participant P as defineRoute pipeline (platform)
    participant A as Authenticator (DenyAll → #2 sessions)
    participant Z as AccessPolicy (DenyAll → #2 role/scope check)
    participant H as Module handler (public API)
    participant AU as AuditLogger → sys_audit_log
    participant M as Metrics/Log

    C->>N: POST /api/v1/…  (x-request-id?)
    N->>P: bound handler(request)
    P->>P: resolve/mint request id (charset-safe)
    P->>A: authenticate(headers, method, path, requestId)
    alt unauthenticated (all of Vidya #1)
        A-->>P: denied + challenge
        P-->>C: 401 problem+json, WWW-Authenticate, x-request-id
    else authenticated (#2)
        A-->>P: Principal(roles, scopes, sessionId)
        P->>Z: authorize(principal, route requirement)
        alt denied
            Z-->>P: reason
            P-->>C: 403 problem+json
        else granted
            P->>P: zod-validate query + body (400 on failure)
            P->>H: handler(ctx: requestId, logger, principal, validated input)
            H-->>P: RouteResult (status, body, audit fields)
            P->>AU: record(action, actor, resource, requestId)
            Note over P,AU: audit failure ⇒ request fails (500) — fail-closed
            P-->>C: response + x-request-id
        end
    end
    P->>M: histogram/counter (module, route, method, status) + access log
```

GET routes skip the audit step; public routes (`system.health/ready/metrics`
only) skip steps 4–7 by explicit, justified declaration in their RouteSpec.

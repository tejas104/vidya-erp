# ADR-0030: Hosted control plane and first tenant boundary

- **Status:** ACCEPTED as the initial SaaS architecture; implementation pending
- **Date:** 2026-09-24
- **Related:** ADR-0001, ADR-0016, ADR-0025, ADR-0027, [school-first handoff](../strategy/ASTRA-HANDOFF.md)

## Context

Vidya currently has a single-institution application and worker, an on-premise deployment overlay, and an offline signed licence verifier. It has no hosted vendor control plane. School and guardian authorization uses the existing institution tree; a future SaaS tenant is a separate security boundary and must not be inferred from `collegeId` or the requested hostname. The owner requires hosted delivery, school data isolation, distinct vendor administration, subscription management separate from pupil fees, and preservation of the signed on-premise licence path.

## Decision

1. **Start with isolated school deployments and one release artifact.** Each tenant receives a separately configured web and worker runtime, PostgreSQL database and restricted role, object-storage authorization boundary, Redis/session/queue boundary, secrets, and allowlisted domain. `collegeId` remains an institution scope inside that tenant. There is no per-request database switching or shared pupil database in the first release. An immutable image digest is promoted through staging and then to each tenant; tenant-specific code forks are prohibited.
2. **Build one separate vendor control plane.** It owns only tenant registry, deployment references, edition and plan, subscription and invoice/payment metadata, operational signals, and operator audit. It holds no pupil, guardian, assessment, document, or school-fee records. Vendor principals use a separate identity realm with strong authentication; a school admin credential is never a vendor credential. The control plane does not share the school's identity tables or session secret.
3. **Licensing for hosted tenants is a control-plane capability, not a required third physical server.** The control plane records subscription and entitlement decisions and signs or otherwise delivers a bounded tenant entitlement to the tenant runtime. A tenant uses a last-known valid entitlement during a control-plane outage, with an explicit bounded cache and audited stale state. Revocation, expiry, and outage behavior require a product policy before the enforcement implementation. They may restrict paid features only under that approved policy; they never delete school data or prevent authorized export. Existing on-premise Ed25519 licence verification and its non-blocking expiry decision remain a separate supported path. The production signing key is never placed in the repository, CI, image, or tenant environment. Do not reuse that key for SaaS entitlements without a reviewed rotation and recovery design.
4. **Provisioning is a resumable, idempotent operation.** A control-plane operation ID identifies each request and step: reserve tenant ID/domain; create isolated resources and secrets; deploy the pinned image; migrate; create a controlled school-admin bootstrap invitation; verify TLS, health, tenant isolation, backup, and restore eligibility; then activate routing. Failure leaves a visible recoverable state and no publicly reachable half-configured tenant. Retry with the same operation ID does not create a second tenant.
5. **Subscription and deployment states are separate.** Deployment progresses through `requested -> provisioning -> ready_for_onboarding -> active`, with explicit `failed` and `offboarding` paths. Subscription tracks `trial`, `active`, `past_due`, `grace`, `restricted`, `suspended`, and `cancelled`. Payment confirmation and exceptions are audited. A subscription state cannot itself erase data or alter the school's student-fee ledger. Offboarding has an authorized export, retrieval window, retention schedule, and backup-expiry procedure.
6. **No implicit operator access to school records.** Fleet health uses minimal aggregates and deployment metadata. Support access to a tenant requires a reason, explicit bounded grant, expiry, and an audit trail in both planes. A control-plane compromise alone must not expose a tenant database or object store. Any break-glass route is designed and reviewed separately before implementation.

## Trust and failure boundaries

```text
Vendor operator -> control-plane identity -> registry / subscription / provisioner
                                              | approved operation and digest
                                              v
School browser -> tenant allowlisted HTTPS -> tenant web + worker
                                           -> tenant PostgreSQL / Redis / objects
```

- A forged `Host`, tenant header, cookie, job payload, or object key cannot select another tenant's resource. Tenant selection is an allowlisted deployment mapping; runtime credentials have access to one tenant's resources only.
- A session issued for tenant A fails on tenant B. Cookies use the tenant's host scope. Redis database numbers alone are not an isolation boundary; use separate instances or verified ACL and namespace isolation compatible with BullMQ.
- Backups and restore credentials are tenant-bound. A restore of A cannot overwrite B. Database **and** object retrieval are exercised in a staging drill. Release rollback is rehearsed with migration compatibility; application rollback is not presumed to reverse a schema change.
- If the control plane is down, an already active tenant continues its school operations under the documented last-known entitlement policy. Provisioning and renewal confirmation queue or pause visibly and resume idempotently. If a tenant is down, the control plane reports its state without silently routing users to another tenant.

## First implementation slices and proof

1. Define the owner-approved subscription state transitions, grace/restriction/export policy, entitlement envelope, cache duration, signing-key custody, and operator authentication standard. This resolves policy questions before enforcement code.
2. Build the tenant registry and audited operator identity. Only a deployment reference and commercial metadata are stored. Test school admin exclusion and operator scope.
3. Build one staging tenant provisioner with operation IDs and explicit step records. Prove same-ID retry, partial failure recovery, domain allowlist, independent credentials, and cross-tenant denial using two synthetic tenants.
4. Add subscription and entitlement publication with signed/versioned payloads, rotation overlap, bounded stale behavior, and tenant-side checks on web and worker. Test control-plane outage, revocation, clock skew, and non-destructive expiry. Keep offline licence conformance green.
5. Add immutable release promotion, tenant backups, restore drill, delivered alerts, support access, and offboarding export. Record exact image digests, recovery times, and operator audit before a paid pilot or repeatable sale.

## Alternatives considered

- **Shared database and runtime now:** cheaper per tenant, but requires new tenant context across all queries, sessions, jobs, files, caches, and restores before the existing product has a live school pilot. Defer until measured cost and isolation evidence justify it.
- **Independent licensing server:** adds another network boundary and outage mode without a present requirement. Keep licensing and entitlements inside the vendor control plane unless load, regulation, or key custody later requires a separate service.
- **Use the on-premise licence file as the SaaS subscription record:** conflates the owner's non-blocking, offline customer promise with hosted commercial state and lacks an online renewal/audit workflow. Preserve it for on-premise installs.

## Consequences

The initial per-school cost is higher and provisioning needs automation, but the current modular monolith can remain largely unchanged while tenant isolation is demonstrable. This ADR establishes boundaries, not a claim that a control plane, hosted licence service, two-tenant isolation test, or production deployment exists. The [hosting readiness register](../strategy/HOSTING-READINESS-2026-09-24.md) tracks those gates.

## 2026-09-26 owner policy and first implementation checkpoint

The owner chose named Vidya operators with MFA for the vendor console. Hosted
subscriptions retain full school access for **30 calendar days** after the
paid-through date, then become read-only. Existing report, receipt and
certificate downloads and a full school-data export remain available. No
student record is deleted. The commercial price/plan model is intentionally
undecided; no price or payment-provider behavior may be inferred from the
registry. The identity provider for operator MFA is still to be selected.

`packages/control-plane` now defines this date-boundary calculation and a
separate vendor-database migration for operator identity references, tenant
registry, append-only subscription events and operator audit. Its repository
serializes same-operation registration retries, checks active operator rows,
and writes subscription events and audit in one transaction. A disposable
integration test migrates an independent database and proves idempotency,
conflict, rollback and migration reversal. These are foundations, not a live
operator identity realm or an entitlement decision delivered to a tenant.

`apps/operator` currently contains a **development-only, fictional UX
preview**. The production route returns 404. It has no login, live tenant
connection, payment action or provisioning control. Do not deploy it or treat
its rows as customer data. First wire a reviewed OIDC/MFA identity provider,
then server-authorized reads and mutations against the vendor database;
publish signed, bounded entitlements only after outage, revocation, key
rotation and school-data export behavior have been exercised with two isolated
synthetic tenants.

## Operator identity boundary after the registry checkpoint

A second vendor migration now adds an OIDC issuer to the named operator
record. Previously recorded subject-only rows retain a null issuer, so they
cannot resolve to a live operator until deliberately rebound. Lookup uses the
exact verified issuer and stable subject, never email. A pure assurance gate
requires a provider-configured MFA `acr` and a fresh `auth_time` (no older than
12 hours). This is defense in depth after an OIDC adapter has validated token
signature, audience, issuer, nonce, expiry and the login transaction. The
adapter, provider selection, session, and production route are still absent;
this gate is **not** an authentication implementation or a live console.

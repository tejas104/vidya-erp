# Vidya hosting readiness and remaining work

**Baseline:** 2026-09-24, `codex/claude-school-product` at `45c00a6ab86c6f5541bfd1415917341840b96b87`. This is a repository assessment, not a production sign-off or a claim that a cloud environment was tested. The existing `docker-compose.prod.yml` overlay validates with `docker compose config --quiet` on Docker 29.7.2. The previous N3.1 local gates passed 1,207 unit, 318 UI, 151 disposable-database integration, and seven isolated browser tests. Those tests establish the named school flows, not a hosted service.

## What “host both” means

The ERP can run as a hosted tenant web/worker deployment. Today's licence feature is **offline signed licence verification and an issuer CLI** for single-institution/on-premise installs; it is not a hosted licence server. The owner requirements allow hosted licensing and entitlements to live inside a separate **vendor control plane**, so a third independently deployed licence server is unnecessary at this stage. ADR-0030 records that boundary. The control plane itself has not been built.

| Target | Current position | Remaining gate |
| --- | --- | --- |
| Public synthetic ERP demo | Production Docker overlay, TLS proxy, edition gate and real browser harness exist locally. | Choose domain/host, provision staging secrets and synthetic data, verify HTTPS/login and no public backing ports. No pupil data. |
| One school's hosted ERP pilot | School academics, fees, guardian and report-card core exist, but the pilot workflow and hosted operations are unproven. | Agree school scope and source data; finish critical daily workflows; test import reconciliation, backup plus objects restore, alerts, upgrade/rollback, role and family journeys, and school acceptance. |
| Hosted ERP plus vendor licensing/control plane | Tenant registry, subscription state, provisioner, online entitlements, separate operator auth and fleet operations are absent. | Implement ADR-0030 slices; prove two synthetic tenants cannot cross data, sessions, jobs, files, backups or support access; complete non-destructive expiry and outage policy. |
| Repeatable paid multi-school service | No end-to-end hosted tenant or control-plane proof. | Onboard a second school from the same immutable release, with repeatable provisioning, measured recovery/support, billing and contract processes, and reviewed release gates. |

## Readiness gates (PASS means evidence observed in this checkout)

| Area | State | Evidence and next owner/action |
| --- | --- | --- |
| School functionality | **WARNING** | N0–N3.1 and the shared table foundation are complete locally. N4–N9 and the Phase 2 paid-pilot workflows remain; product lead must rank them against an actual school's term and fee examples. |
| Authorization and tenant isolation | **FAIL for SaaS** | School/guardian scope has real API/browser coverage, but there is no two-tenant deployment, tenant-bound credential proof, or separate vendor identity. Engineering must build and adversarially test ADR-0030. |
| Data and migrations | **WARNING** | Migration up/down/reapply and integration gates passed locally through N3.1. No hosted migration, real import reconciliation, or tenant upgrade/rollback rehearsal exists. Engineering and school data owner must sign those off. |
| Deployment and TLS | **WARNING** | The on-premise production Compose overlay parses and includes a TLS proxy with private backing ports. No chosen cloud host/domain, deployed image digest, live TLS, clean cloud install, or public exposure scan has been verified. Operations must demonstrate all of them in staging. |
| Backups and recovery | **FAIL for hosting** | Backup/restore scripts and a local runbook exist. No tenant-scoped cloud backup schedule, object restore, off-site copy or measured hosted restore drill has been observed. Operations must run and record the drill. |
| Observability and operations | **WARNING** | Health, readiness and metrics routes exist. Delivered alerts, incident owner, per-tenant queue/disk/backup monitoring, support access expiry, and an operating rota are unproven. Operations must exercise one alert and one incident drill. |
| CI and release evidence | **WARNING** | CI workflow now declares both college and isolated school browser gates; the latest local school branch has not been pushed or run in remote CI. Release owner must pin a reviewed SHA and immutable image digest, observe the school gate on that SHA, and record rollback criteria. |
| Performance and accessibility | **WARNING** | School browser journeys include mobile checks and keyboard table scrolling. No hosted load envelope, broad role-by-role redesign review, or complete accessibility audit exists. Engineering and QA must run against pilot-sized synthetic data. |
| Licensing and commercial state | **FAIL for hosted service** | Signed offline licences and the admin status banner exist. Vendor registry, operator login, subscription ledger, online entitlement protocol, renewal proof and outage policy do not. Product owner and engineering must approve the policy and implement it separately from pupil fees. |
| Customer and legal acceptance | **FAIL for paid pilot** | No real school user validation or signed pilot scope is recorded in this checkout. Product/operations need policy samples, migration consent, processing/retention terms, support scope and named school academic/finance approvers. |

**Recommendation:** local/synthetic demonstration can proceed after a staging host and security checks; live school data and paid multi-school sales remain **NO-GO** until their respective gates above have evidence. Existing test totals do not waive a restore, isolation or school acceptance gate.

## Planning ranges, not dates or percent-complete claims

Assume two engineers at about 70% planned feature capacity, one QA/operations contributor, prompt owner policy choices, and a school available to review examples. This uses the capacity model in the owner's school-first plan, updated for the completed N0–N3.1 slices. External hosting procurement, provider onboarding, school data cleanup, and waiting for school approval can extend elapsed time.

| Outcome | Remaining engineering effort | Indicative elapsed time under those assumptions |
| --- | --- | --- |
| Synthetic HTTPS ERP staging demo | ~1–3 engineer-weeks | ~1–3 weeks once domain/host is ready |
| First bounded hosted school pilot | ~14–22 engineer-weeks, including product gaps and recovery proof | ~10–16 weeks, then **4–6 weeks of live pilot observation** before claiming it works for a term |
| Both ERP and an initial vendor control plane online in staging | ~10–16 engineer-weeks for control plane, isolation and provisioning, which can overlap pilot work only with separate ownership | ~8–12 weeks if parallelized; a staged demo is not a paid multi-school release |
| Repeatable paid school SaaS with vendor licensing/subscriptions | ~30–45 engineer-weeks across remaining school depth, design rollout, onboarding and Phase 3 operations | ~22–34 weeks before general sale, including pilot feedback and release gates |

With one engineer, elapsed engineering time is materially longer. A native parent app, payment gateway, statutory payroll, full accounting, college expansion, transport/library and unbounded feature parity are **outside** these ranges. The total remaining school-first SaaS work is substantial; a precise percentage would hide differences between code, operational proof and customer acceptance.

## Critical path from this checkpoint

1. Confirm a bounded pilot school scope and collect redacted report, attendance, fee and roster examples. In parallel, secure domain/host and a safe synthetic staging environment.
2. Deliver N4 marks import, N5 attendance shortfall, N6 promotion/transfer and pilot-critical fee/onboarding flows; continue the full UI redesign by role. Each needs authorization, data, browser and help gates.
3. Implement ADR-0030 registry, operator identity and resumable two-tenant provisioning, then subscription/entitlement policy and delivery. The existing offline licence verifier stays supported.
4. Prove cloud backups and object restore, monitoring, upgrade/rollback, performance, security and school acceptance. Start one bounded pilot, then repeat onboarding for a second school from the same image before general sale.

Re-estimate after the first synthetic staging tenant and a school's signed pilot scope. Those two facts will narrow both engineering and elapsed-time uncertainty more than another feature count.

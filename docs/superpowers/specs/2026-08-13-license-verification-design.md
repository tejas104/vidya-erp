# License verification — design spec

**Status:** DRAFT — three policy decisions are the owner's and are marked **OWNER DECISION**. Nothing is implemented.
**Blocks:** #12 step 4.

## What this is, and what it honestly is not

An offline, signed license file that the app verifies at boot. It exists so a college install can state who it is licensed to, until when, and at what scale — and so an expired or tampered license is *visible and auditable* rather than silent.

**It is not copy protection, and the spec should not pretend otherwise.** This ships on-prem: the customer controls the machine, the clock, the database and the binary. Anyone willing to edit `verifyLicense()` and rebuild can remove it in minutes. Ed25519 signing raises the bar from "edit a JSON file" to "patch and rebuild the application" — that is the entire security claim, and it is a meaningful one for the honest-customer and casual-tamper cases that actually occur in this market. It is worthless against a determined adversary, and a spec that implies otherwise would set you up to over-trust it.

Design consequence: **optimise for clear, auditable, non-destructive behaviour, not for unbreakability.** Every hour spent hardening against a motivated attacker here is an hour not spent on the product.

## The mechanism

`node:crypto` has native Ed25519 in Node 22 (verified on this machine, `node v22.23.2`). **No new dependency** — ADR-0009 holds.

- Vendor holds an Ed25519 **private key**. It never enters this repo, never enters a container image, never enters CI.
- The app embeds the corresponding **public key** as a build-time constant.
- A license is `base64url(payload).base64url(signature)` — one line, pasteable, diffable, no ambiguity about canonical JSON because the signature covers the exact payload bytes that were encoded.

Verification is: decode → verify signature over the raw payload bytes → parse JSON → validate claims. **Signature first, parse second.** Never parse untrusted JSON and then check whether it was signed.

### Payload claims

```jsonc
{
  "v": 1,                          // payload schema version
  "id": "lic_2026_northgate_001",  // unique; the handle for support and revocation lists
  "customer": "Northgate Junior College",
  "edition": "college",            // matches VIDYA_EDITION
  "issuedAt": "2026-08-13",
  "expiresAt": "2027-08-13",
  "seats": 500,                    // max active students; see OWNER DECISION 3
  "notBefore": "2026-08-13"        // optional, guards pre-dated issue
}
```

Unknown fields must be **ignored, not rejected** — that is what lets you add a claim later without invalidating every license already in the field.

### Where it lives

- `packages/platform/src/license/verify.ts` — pure: `verifyLicense(token: string, publicKey: KeyObject, now: Date): LicenseStatus`. No I/O, no clock of its own, no logging. `now` is injected so tests are deterministic and the boot path controls the clock source.
- `packages/modules/system/` — owns the *state*: reads `VIDYA_LICENSE` (or a file path), calls the verifier at composition time, exposes it. The system module already owns health/ready/metrics and now preferences, so operational posture is its natural home.
- The public key: a constant in the platform package. Not env-configurable — an env-supplied public key means anyone can self-sign, which defeats the point.

`LicenseStatus` is a discriminated union, never a boolean:
```ts
type LicenseStatus =
  | { kind: "valid";    claims: LicenseClaims; daysRemaining: number }
  | { kind: "grace";    claims: LicenseClaims; daysOverdue: number }
  | { kind: "expired";  claims: LicenseClaims; daysOverdue: number }
  | { kind: "invalid";  reason: "malformed" | "bad-signature" | "unsupported-version" | "not-yet-valid" }
  | { kind: "absent" };
```
A boolean would force every call site to re-derive *why*, and the why is the whole product surface.

---

## OWNER DECISION 1 — what expiry actually does

This is the decision that matters most, and it is a business call, not a technical one.

This system runs attendance, exams and fee collection for a college. **Hard-locking an expired install mid-term would lock a college out of its own attendance records during a working day.** That is a support incident, a reputational event, and plausibly a contractual problem — caused by your own enforcement, not by any failure of theirs.

**My recommendation — graduated, never destructive:**

| State | Behaviour |
|---|---|
| >30 days remaining | Nothing visible |
| ≤30 days | Banner for admin roles only |
| ≤7 days | Banner for all staff roles |
| Expired, within 30-day grace | Prominent persistent banner; **everything keeps working** |
| Past grace | **Writes blocked, reads and exports always allowed.** Attendance/marks/fees entry refuses with a clear licensing message; viewing and exporting existing data never stops |

"Reads and exports always allowed" is the line I would not cross. A customer in a payment dispute must always be able to get their own data out. Holding a college's attendance history hostage is the kind of thing that ends up in a procurement blacklist.

**Alternatives if you disagree:** banner-only forever (weakest lever, zero risk), or hard block at expiry (strongest lever, real risk of harming a paying customer mid-renewal).

## OWNER DECISION 2 — the clock

On-prem means the customer owns the clock. Setting it back defeats expiry, and no signature scheme fixes that.

**Recommendation: accept it, and make regression detectable rather than impossible.** Persist a monotonic high-water mark — the latest date the system has ever observed — in `sys_user_preferences`-style storage or its own tiny table. If the wall clock is ever earlier than that mark by more than a day, record an audit event and treat the license as being at the high-water date, not the wall clock. That turns silent clock-rollback into something visible in the audit log without ever locking anyone out over a legitimate NTP correction or timezone change.

Do **not** phone home to a time server. This product's selling point is that it runs air-gapped.

## OWNER DECISION 3 — seats

Does `seats` enforce, or record?

**Recommendation: record and surface, do not enforce.** Show actual-vs-licensed on the admin system page and audit when it is exceeded. Blocking student creation at seat N+1 during an admissions rush is exactly the wrong moment to be right, and the commercial conversation lands better with evidence than with a locked screen. Enforcement can come later if the data shows it is needed; unwinding a bad block is much harder.

---

## Test cases

The verifier is pure, so these are fast unit tests with a generated throwaway key pair — no fixtures on disk, no golden files to rot.

1. **Valid license verifies** — round-trip a signed token, assert `kind: "valid"` and every claim survives exactly.
2. **Tampered payload fails** — flip one byte of the payload, assert `bad-signature`. Assert specifically that the *claims are not returned* — a verifier that reports failure but still hands back attacker-controlled claims is the classic mistake.
3. **Wrong key fails** — sign with a second key pair, assert `bad-signature`.
4. **Expired license detected** — `expiresAt` in the past relative to injected `now`; assert `expired`/`grace` boundaries at exactly the cutoff, not just "some time later". Off-by-one on a date boundary is the most likely real bug here.
5. **Garbage input never throws** — empty string, non-base64, valid base64 of non-JSON, JSON that is not an object, missing signature segment, absurdly long input. Every case returns `invalid`; none throws. **A verifier that throws on malformed input turns a bad license file into a boot crash.**
6. **Absent license** — no env var, empty string; returns `absent`, distinct from `invalid`, because a fresh install and a tampered install deserve different messages.

Two more I would add beyond your six:

7. **Unknown claims are ignored** — a payload with a future field still verifies. This is what makes the format forward-compatible.
8. **`v` mismatch is rejected cleanly** — `v: 2` against a v1 verifier returns `unsupported-version`, not a crash and not silent acceptance.

## Issuing CLI

`scripts/license-issue.ts`, run with `npx tsx`, matching the existing scripts' style:

```
npx tsx scripts/license-issue.ts \
  --customer "Northgate Junior College" \
  --edition college \
  --expires 2027-08-13 \
  --seats 500 \
  --id lic_2026_northgate_001 \
  --key /secure/path/vidya-license-ed25519.pem
```

Prints the token to stdout, nothing else, so it pipes cleanly.

Non-negotiables for the issuer:
- **The private key is a path argument, never a repo file, never an env default.** If someone can run the issuer from a clean checkout without supplying a key, the key is somewhere it should not be.
- Refuse to issue with `--expires` in the past — the most likely operator slip.
- Print the decoded claims to **stderr** for eyeball confirmation before the operator sends it to a customer.
- A `--verify <token>` mode using only the public key, so support can diagnose a customer's license without touching the private key.

Also worth having: `scripts/license-keygen.ts` that emits a key pair and prints the public key in the exact literal form to paste into the platform constant, so key rotation is not an archaeology exercise.

## Explicitly out of scope

- **Revocation.** Air-gapped means no CRL and no phone-home. The lever is short expiry and reissue. Say so in the contract rather than pretending otherwise.
- **Per-feature licensing.** One edition claim, no feature flags. Add only if a customer actually asks and pays differently.
- **Hardware binding.** Machine fingerprints break on VM migration, disk replacement and DR restore — all things a college will legitimately do, usually at the worst moment.

## Boot integration

Verify once in the composition root, store the resulting `LicenseStatus`, never re-verify per request. Expose it on the existing admin system page beside the version and git SHA, and audit **one** event at boot recording status and license id. Never log the token itself.

If status is `invalid` or `absent`, **the app must still start.** A license problem is not a reason to refuse to boot a college's information system; it is a reason to say so loudly on every admin screen.

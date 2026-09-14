# #12 Part 5 — BLOCKED: owner-issued clean-install licence unavailable here

**Status:** OPEN on this verification workstation.
**Owner action required.** The production public key is now shipped, while its
private signing key is correctly held outside this repository and machine.

## 1. The blocker

Commit `0e80d7c` replaced the placeholder with the owner's production public
key. The earlier claim that no private half existed is obsolete. This machine
does not hold the corresponding private key or an owner-issued test licence,
so the clean-install and wrong-edition CLI paths still cannot be exercised here.

## 2. Historical evidence

Generated a throwaway Ed25519 pair with the repo's own tool, issued a
well-formed licence with it, and verified that licence against the **shipped**
public key:

```
$ npx tsx scripts/license-keygen.ts --out <scratch>/test-ed25519.pem
$ npx tsx scripts/license-issue.ts --customer "Part5 Test College" \
    --edition college --expires 2027-12-31 --seats 500 \
    --id lic_part5_test --key <scratch>/test-ed25519.pem
  → 277-character token
$ npx tsx scripts/license-issue.ts --verify <token> --edition college
  as edition="college":
  { "kind": "invalid", "reason": "bad-signature" }
```

This result describes the retired placeholder key and must not be used to infer
the current production key's status. The current blocker is the absence of an
owner-issued token on this workstation.

## 3. What unblocks verification

The design spec assigns this to the owner and says why
(`docs/superpowers/specs/2026-08-13-license-verification-design.md:135-142`):
the private key is the most valuable file the company owns, both failure modes
are terminal and unrecoverable by engineering — lose it and no licence can ever
be issued or renewed for any customer again; leak it and anyone can mint
licences, with no revocation path (revocation is explicitly out of scope
because the product is air-gapped).

The owner should issue two short-lived non-production licences using the secured
signing system: one for `college` and one for `school`. They can then be used to
exercise install success and wrong-edition refusal through the CLI boundary.
The private key must remain outside the repository and this workstation.

## 4. What stays UNVERIFIED until then

The whole of Part 5 past step 4: HTTPS via Caddy, first login, demo CSV import,
marking attendance, fee-receipt PDF, the version-bump `update.sh` run, the
deliberate health-check break and rollback. None of it has been executed on a
clean host. Everything said about the bundle so far describes its *shape*, not
an install anyone has watched succeed.

The wrong-edition result is covered by verifier unit tests, but the complete CLI
boundary still needs the owner-issued pair described above.

Note this blocker is why Part 5 had not already caught the licence-wiring bug
fixed in 11b11bd (the token never reached the containers). An install nobody
can run is an install whose bugs nobody finds.

## 5. Related, separate: the other two owner rulings — now closed

Ruled on 2026-08-13. DECISION 1 (banner only, no enforcement) shipped at the
time; by design it required no code, which is why nobody noticed the other two
had not been written. Both landed in 8132da2:

- **DECISION 2, high-water clock mark** — `sys_clock_watermark` plus
  `packages/modules/system/src/service/clock-watermark.ts`. A wall clock more
  than a day behind the highest date ever observed audits
  `system.clock-rollback` and the licence is evaluated at the mark. Never
  blocks; one-day tolerance so an NTP correction is not an incident.
- **DECISION 3, seat-overage audit** — `system.seat-overage`, once per boot,
  when the active-student count exceeds `claims.seats`. Admissions are never
  blocked.

Neither was ever a blocker for Part 5. They are recorded here because this
document is where the claim that they were missing was first written down.

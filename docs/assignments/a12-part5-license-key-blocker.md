# #12 Part 5 — BLOCKED: no licence can verify against the shipped build

**Status:** OPEN. Blocks every clean-environment install, including the vendor's own.
**Owner action required.** This is not an engineering task — see §3.

## 1. The blocker

`packages/platform/src/license/public-key.ts:12-19` says it plainly:

> PLACEHOLDER: this is a freshly generated throwaway key. No license has ever
> been issued against it, and its private half was never written to disk.

Because the private half does not exist, **no licence token can ever verify
against the current build.** And `install.sh` step 4/8 makes a valid licence
mandatory: it aborts on `invalid` (`install.sh:288-300`).

So the release bundle as it stands **cannot be installed by anyone**. Not a
customer, not the vendor. Part 5's chain stops at step 4 of 8.

## 2. Evidence (reproduced 2026-09-11, not inferred)

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

The token is cryptographically sound. It fails because the verifier holds a
key nobody has the private half of. That is the whole finding.

## 3. What unblocks it — the key ceremony (owner's, explicitly)

The design spec assigns this to the owner and says why
(`docs/superpowers/specs/2026-08-13-license-verification-design.md:135-142`):
the private key is the most valuable file the company owns, both failure modes
are terminal and unrecoverable by engineering — lose it and no licence can ever
be issued or renewed for any customer again; leak it and anyone can mint
licences, with no revocation path (revocation is explicitly out of scope
because the product is air-gapped).

Nobody should generate this key as a side effect of a test run, which is why
this document stops here instead of doing it.

1. `npx tsx scripts/license-keygen.ts --out <secure path>` — on the machine
   that will hold the key, not a scratch directory.
2. Paste the printed constant into `packages/platform/src/license/public-key.ts`
   and delete the PLACEHOLDER warning. The tool prints it in exactly the form
   the file expects; this is the entire rotation procedure.
3. Give the private key its permanent home: encrypted, passphrase-protected,
   **plus a second offline copy on encrypted storage that is not the
   development laptop** (the spec's wording).
4. Rebuild and re-publish the images — the public key is compiled in.

## 4. What stays UNVERIFIED until then

The whole of Part 5 past step 4: HTTPS via Caddy, first login, demo CSV import,
marking attendance, fee-receipt PDF, the version-bump `update.sh` run, the
deliberate health-check break and rollback. None of it has been executed on a
clean host. Everything said about the bundle so far describes its *shape*, not
an install anyone has watched succeed.

The one Part 5 item that IS proven is the wrong-edition refusal path — but only
negatively: every licence currently refuses, for a different reason
(`bad-signature`, not `edition-mismatch`), so the distinction the design spec
cares about has not been exercised end to end through the CLI boundary.

Note this blocker is why Part 5 had not already caught the licence-wiring bug
fixed in 11b11bd (the token never reached the containers). An install nobody
can run is an install whose bugs nobody finds.

## 5. Related, separate: two owner rulings were never implemented

Ruled on 2026-08-13, built: **DECISION 1** only — banner-only, no enforcement,
which by design required no code. The other two are absent from the codebase:

- **DECISION 2, high-water clock mark.** `apps/web/src/composition.ts:142`
  passes a raw `new Date()`. No persisted high-water date, no audit event on
  clock rollback. Grep for any high-water concept returns nothing. A customer
  setting the clock back is currently undetectable — the exact thing the ruling
  asked to make visible.
- **DECISION 3, seat-overage audit.** The count is *surfaced* on the admin
  System page (the "N of M licensed students" wording), but nothing compares it
  to `claims.seats`, so the once-per-boot audit event when the count crosses
  the licensed figure does not exist. Half the ruling shipped.

Neither is a blocker for Part 5. Both were previously reported as delivered,
which was wrong.

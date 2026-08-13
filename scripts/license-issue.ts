import { readFileSync } from "node:fs";
import { createPrivateKey, sign as cryptoSign } from "node:crypto";
import { LICENSE_PUBLIC_KEY, verifyLicense, type LicenseEdition } from "@vidya/platform";

/**
 * Issues (or diagnoses) signed license tokens (see
 * docs/superpowers/specs/2026-08-13-license-verification-design.md).
 *
 *   npx tsx scripts/license-issue.ts \
 *     --customer "Northgate Junior College" \
 *     --edition college \
 *     --expires 2027-08-13 \
 *     --seats 500 \
 *     --id lic_2026_northgate_001 \
 *     --key /secure/path/vidya-license-ed25519.pem
 *
 *   npx tsx scripts/license-issue.ts --verify <token> [--edition college|school]
 *
 * --key is a path argument, always — never a repo file, an env default, or
 * a fallback location. If this could issue from a clean checkout without
 * being handed a key, the key would be somewhere it should not be.
 *
 * The token goes to stdout ONLY, so it pipes cleanly. Everything else
 * (decoded claims, diagnostics) goes to stderr. The private key and any
 * passphrase are never printed, logged, or echoed anywhere.
 */

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  const value = index === -1 ? undefined : process.argv[index + 1];
  return value === undefined || value.startsWith("--") ? undefined : value;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));
}

function verifyMode(token: string): void {
  // Diagnostic path: uses only the embedded public key, exactly so support
  // can check a customer's license without ever touching the private key.
  const editionArg = argValue("--edition");
  const editions: readonly LicenseEdition[] =
    editionArg === "college" || editionArg === "school" ? [editionArg] : ["college", "school"];
  for (const edition of editions) {
    const status = verifyLicense(token, LICENSE_PUBLIC_KEY, new Date(), edition);
    console.error(`as edition="${edition}":`);
    console.error(JSON.stringify(status, null, 2));
  }
}

function issueMode(): void {
  const customer = argValue("--customer");
  const edition = argValue("--edition");
  const expires = argValue("--expires");
  const seatsRaw = argValue("--seats");
  const id = argValue("--id");
  const keyPath = argValue("--key");
  const issuedAt = argValue("--issued") ?? todayUtc();
  const notBefore = argValue("--not-before");
  const seats = seatsRaw === undefined ? Number.NaN : Number(seatsRaw);

  const problems: string[] = [];
  if (customer === undefined || customer.length === 0) problems.push("--customer is required");
  if (edition !== "college" && edition !== "school")
    problems.push('--edition is required and must be "college" or "school"');
  if (expires === undefined || !isDateOnly(expires)) problems.push("--expires is required, format YYYY-MM-DD");
  if (id === undefined || id.length === 0) problems.push("--id is required");
  if (keyPath === undefined)
    problems.push("--key <path> is required — the private key is never read from a default location");
  if (!Number.isInteger(seats) || seats < 0) problems.push("--seats is required, a non-negative integer");
  if (notBefore !== undefined && !isDateOnly(notBefore)) problems.push("--not-before must be YYYY-MM-DD");
  if (issuedAt !== undefined && !isDateOnly(issuedAt)) problems.push("--issued must be YYYY-MM-DD");
  if (
    expires !== undefined &&
    isDateOnly(expires) &&
    Date.parse(`${expires}T00:00:00.000Z`) < Date.parse(`${todayUtc()}T00:00:00.000Z`)
  ) {
    // The likeliest operator slip (spec, "the private key" section) — refuse outright.
    problems.push(`--expires ${expires} is in the past — refusing to issue an already-expired license`);
  }
  if (problems.length > 0) {
    for (const problem of problems) console.error(`error: ${problem}`);
    process.exitCode = 2;
    return;
  }

  let token: string;
  const claims = {
    v: 1 as const,
    id: id as string,
    customer: customer as string,
    edition: edition as LicenseEdition,
    issuedAt,
    expiresAt: expires as string,
    seats,
    ...(notBefore !== undefined ? { notBefore } : {}),
  };
  try {
    const privateKeyPem = readFileSync(keyPath as string, "utf8");
    const passphrase = process.env.VIDYA_LICENSE_KEY_PASSPHRASE;
    const privateKey = createPrivateKey(
      passphrase !== undefined && passphrase !== ""
        ? { key: privateKeyPem, format: "pem", passphrase }
        : { key: privateKeyPem, format: "pem" },
    );
    const payloadBytes = Buffer.from(JSON.stringify(claims), "utf8");
    const signatureBytes = cryptoSign(null, payloadBytes, privateKey);
    token = `${payloadBytes.toString("base64url")}.${signatureBytes.toString("base64url")}`;
  } catch (error) {
    // Never let a key-loading failure leak the key material or passphrase —
    // only the error's own message (from node:crypto/fs, about the file/key
    // shape) reaches stderr.
    console.error(`error: failed to sign with ${keyPath}:`, error instanceof Error ? error.message : error);
    process.exitCode = 1;
    return;
  }

  console.error("issuing license with claims:");
  console.error(JSON.stringify(claims, null, 2));
  console.log(token); // stdout: the token, and only the token
}

function main(): void {
  const verifyToken = argValue("--verify");
  if (verifyToken !== undefined) {
    verifyMode(verifyToken);
    return;
  }
  issueMode();
}

main();

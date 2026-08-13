import { existsSync, writeFileSync, chmodSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";

/**
 * Generates an Ed25519 key pair for signing license files (see
 * docs/superpowers/specs/2026-08-13-license-verification-design.md).
 *
 *   npx tsx scripts/license-keygen.ts --out /secure/path/vidya-license-ed25519.pem
 *
 * Writes the PRIVATE key (PKCS8 PEM) to --out and nothing else touches it —
 * it is never printed. The PUBLIC key is printed to stdout in the exact
 * literal form to paste into packages/platform/src/license/public-key.ts,
 * so key rotation is a paste, not an archaeology exercise.
 *
 * --out is required, with no default and no fallback location, on purpose:
 * this is "the most valuable file the company owns" (spec). Losing it means
 * no license can ever be issued again; leaking it means anyone can mint
 * licenses indefinitely. Store the printed reminder's advice: an encrypted
 * file behind a passphrase, plus a second offline copy that is not this
 * machine.
 */

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  const value = index === -1 ? undefined : process.argv[index + 1];
  return value === undefined || value.startsWith("--") ? undefined : value;
}

function main(): void {
  const outPath = argValue("--out");
  const force = process.argv.includes("--force");

  if (outPath === undefined) {
    console.error("usage: license-keygen.ts --out <path-for-private-key.pem> [--force]");
    console.error("--out is required: this key must never land in a default or repo location.");
    process.exitCode = 2;
    return;
  }
  if (!force && existsSync(outPath)) {
    console.error(`refusing to overwrite existing file: ${outPath} (pass --force to replace it)`);
    console.error("if this is a real, in-use signing key, replacing it invalidates no existing");
    console.error("licenses (they remain verifiable against their original public key) but you");
    console.error("will not be able to issue NEW ones with the old private key afterwards.");
    process.exitCode = 2;
    return;
  }

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicKeyDerBase64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");

  writeFileSync(outPath, privateKeyPem, { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(outPath, 0o600); // best-effort on platforms where the writeFileSync mode is ignored (e.g. Windows)
  } catch {
    // no-op — ACLs differ per platform; the operator is told to secure it regardless
  }

  console.error(`private key written to ${outPath} — move it to its permanent secure home now.`);
  console.error("it was NOT printed to this terminal and is not in shell history.");
  console.error("");
  console.error("paste this into packages/platform/src/license/public-key.ts:");
  console.error(`export const LICENSE_PUBLIC_KEY_DER_BASE64 = "${publicKeyDerBase64}";`);
  console.error("");
  console.error("(also printed to stdout alone, so it can be piped/captured)");
  console.log(publicKeyDerBase64);
}

main();

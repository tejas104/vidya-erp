/** Session-cookie plumbing (Fable-owned; the token inside is human-owned). */

export interface CookiePolicy {
  readonly name: string;
  readonly secure: boolean;
}

export function parseCookies(header: string | null): Record<string, string> {
  const jar: Record<string, string> = {};
  if (header === null) {
    return jar;
  }
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name !== "") {
      jar[name] = value;
    }
  }
  return jar;
}

/**
 * ADR-0011: HttpOnly (no script access), SameSite=Strict (CSRF layer 1),
 * Path=/, Secure in anything but plain-http local dev.
 */
export function buildSessionCookie(
  policy: CookiePolicy,
  token: string,
  maxAgeSeconds: number,
): string {
  const attributes = [
    `${policy.name}=${token}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ];
  if (policy.secure) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

export function clearSessionCookie(policy: CookiePolicy): string {
  return buildSessionCookie(policy, "", 0);
}

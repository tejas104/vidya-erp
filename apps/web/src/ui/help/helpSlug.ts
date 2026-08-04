/**
 * Route -> help-doc slug. Dynamic segments are dropped rather than
 * substituted: help is written per SCREEN, and /students/<any id> is one
 * screen. "manage" is a routing prefix, not part of the screen's identity.
 */
export function helpSlugFor(pathname: string): string {
  const parts = pathname
    .split("/")
    .filter((part) => part !== "" && part !== "manage")
    // A segment that is not a stable word is an id (uuid, number, slug-with-digits).
    .filter((part) => /^[a-z][a-z-]*$/.test(part));
  return parts.length === 0 ? "home" : parts.join("-");
}

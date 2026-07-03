import { randomUUID } from "node:crypto";

export const REQUEST_ID_HEADER = "x-request-id";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Propagates a caller-supplied correlation id when it is well-formed,
 * otherwise mints a fresh UUID. The constrained charset prevents log
 * injection via the header.
 */
export function resolveRequestId(headers: Headers): string {
  const supplied = headers.get(REQUEST_ID_HEADER);
  if (supplied !== null && REQUEST_ID_PATTERN.test(supplied)) {
    return supplied;
  }
  return randomUUID();
}

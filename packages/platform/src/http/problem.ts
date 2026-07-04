import { REQUEST_ID_HEADER } from "./request-id";

/**
 * RFC 9457 (problem+json) error envelope. Deliberately terse: no stack
 * traces, no internal identifiers, no dependency version strings.
 */
export interface Problem {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail?: string;
  readonly requestId: string;
  /** Zod issue list on validation failures (paths + messages only). */
  readonly issues?: readonly { path: string; message: string }[];
}

export interface ProblemOptions {
  readonly status: number;
  readonly title: string;
  readonly detail?: string;
  readonly requestId: string;
  readonly issues?: readonly { path: string; message: string }[];
  readonly headers?: Readonly<Record<string, string>>;
}

const PROBLEM_TYPES: Readonly<Record<number, string>> = {
  400: "https://vidya.invalid/problems/validation-failed",
  401: "https://vidya.invalid/problems/unauthenticated",
  403: "https://vidya.invalid/problems/forbidden",
  404: "https://vidya.invalid/problems/not-found",
  409: "https://vidya.invalid/problems/conflict",
  413: "https://vidya.invalid/problems/body-too-large",
  429: "https://vidya.invalid/problems/too-many-requests",
  500: "https://vidya.invalid/problems/internal",
  503: "https://vidya.invalid/problems/not-ready",
};

export function problemResponse(options: ProblemOptions): Response {
  const problem: Problem = {
    type: PROBLEM_TYPES[options.status] ?? "about:blank",
    title: options.title,
    status: options.status,
    ...(options.detail !== undefined ? { detail: options.detail } : {}),
    requestId: options.requestId,
    ...(options.issues !== undefined ? { issues: options.issues } : {}),
  };
  return new Response(JSON.stringify(problem), {
    status: options.status,
    headers: {
      "content-type": "application/problem+json",
      [REQUEST_ID_HEADER]: options.requestId,
      ...options.headers,
    },
  });
}

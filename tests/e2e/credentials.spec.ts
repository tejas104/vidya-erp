import { randomUUID } from "node:crypto";
import { inflateSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import { YEAR, apiSession, browserLogin, discover } from "./support/fixtures";

/**
 * ASSIGNMENT #11 TASK B4 — the per-class credential-sheet journey, end to end.
 *
 * Guard (a): generating the sheet returns a real PDF, synchronously — no
 * reportId, no poll, `application/pdf` bytes straight back in the response
 * (the #11 B3->B4 ruling: a temporary password is never persisted, so the
 * queued request/poll/download flow structurally cannot regenerate this
 * later — it is generated in the handler and streamed, full stop).
 *
 * Guard (b) is the assertion that matters: the credential the sheet just
 * printed actually logs in and lands on the student portal. The account
 * ships ACTIVE with no force-change (#11 D2) — if that ruling were wrong,
 * this is the one place it would show up as a real login failure, not a
 * mocked one.
 *
 * The PDF is never persisted anywhere, so this response body is the ONLY
 * place the plaintext temporary password ever appears — it has to be
 * parsed straight out of the PDF bytes. Done with node:zlib alone (ADR-0009:
 * no new PDF-parsing dependency), the same technique
 * packages/modules/reporting/src/render/credential-sheet.test.ts already
 * uses to prove page-per-class layout; duplicated here rather than imported
 * because an e2e spec talks to the app over HTTP, never into a module's
 * internals.
 */

const runId = randomUUID().slice(0, 8);

function pdfText(buf: Buffer): string {
  const raw = buf.toString("latin1");
  const streamsByObjNum = new Map<number, string>();
  const pageContentRefs: number[] = [];
  const objectRe = /(\d+) 0 obj\r?\n((?:(?!endobj)[\s\S])*?)endobj/g;
  for (const m of raw.matchAll(objectRe)) {
    const objNum = Number(m[1]);
    const body = m[2]!;
    const streamMatch = body.match(/stream\r?\n([\s\S]*?)\r?\nendstream/);
    if (streamMatch !== null) {
      try {
        streamsByObjNum.set(objNum, inflateSync(Buffer.from(streamMatch[1]!, "latin1")).toString("latin1"));
      } catch {
        // Non-Flate stream (e.g. an embedded font) — irrelevant to page text.
      }
    }
    if (/\/Type \/Page\b/.test(body) && !/\/Type \/Pages\b/.test(body)) {
      const contentsMatch = body.match(/\/Contents (\d+) 0 R/);
      if (contentsMatch !== null) pageContentRefs.push(Number(contentsMatch[1]));
    }
  }
  const decodeHexShowOps = (streamText: string): string => {
    const hexTokens = streamText.match(/<([0-9A-Fa-f]+)>/g) ?? [];
    let out = "";
    for (const token of hexTokens) {
      const hex = token.slice(1, -1);
      for (let i = 0; i + 1 < hex.length; i += 2) {
        out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
      }
    }
    return out;
  };
  return pageContentRefs.map((ref) => decodeHexShowOps(streamsByObjNum.get(ref) ?? "")).join("\n");
}

test.describe("per-class credential sheet journey (assignment #11 task B4)", () => {
  test("generate a class's credential sheet (real PDF), then log in as the newly issued student", async ({
    page,
    baseURL,
  }) => {
    const admin = await apiSession(baseURL!, "admin");
    const ids = await discover(admin);

    // A student with no login yet, created directly (not through
    // import-confirm, which auto-issues on creation — see import-service.ts)
    // so the class-credentials endpoint below has a real row to issue.
    // Lowercase-alnum admission number so usernameFromCode's cleanup
    // (lowercase + strip to [a-z0-9._@-]) is a no-op: the derived username
    // IS the admission number, which is what makes this student's row
    // unambiguous to find in the rendered PDF below.
    const admissionNo = `e2ecred${runId}`;
    const fullName = `E2E Credential Student ${runId}`;
    const createRes = await admin.post("/api/v1/people/students", {
      data: { collegeId: ids.collegeId, admissionNo, fullName, sectionId: ids.sectionId, academicYear: YEAR },
    });
    expect(createRes.status(), "create student").toBe(201);

    // --- guard (a): a real, synchronously-generated PDF, not a stub ---
    const sheetRes = await admin.post(`/api/v1/reports/class-credentials/${encodeURIComponent(ids.classId)}`);
    expect(sheetRes.status(), "class-credentials").toBe(200);
    expect(sheetRes.headers()["content-type"] ?? "", "pdf content-type").toContain("application/pdf");
    const bytes = await sheetRes.body();
    expect(bytes.subarray(0, 5).toString("latin1"), "%PDF- magic bytes").toBe("%PDF-");
    expect(bytes.length, "non-trivial PDF").toBeGreaterThan(500);

    // --- pull this student's plaintext credential straight off the sheet:
    // it was never written anywhere else, so this is the only copy. ---
    const text = pdfText(bytes);
    const occurrences = [...text.matchAll(new RegExp(admissionNo, "g"))];
    expect(occurrences.length, "roll-no cell AND username cell both carry this admission number").toBeGreaterThanOrEqual(2);
    const usernameCellEnd = occurrences[occurrences.length - 1]!.index! + admissionNo.length;
    const temporaryPassword = text.slice(usernameCellEnd, usernameCellEnd + 10);
    expect(temporaryPassword, "10-char temporary password (platform's TEMP_PASSWORD_ALPHABET)").toMatch(
      /^[A-Za-z0-9]{10}$/,
    );

    // --- guard (b), the assertion that matters: the credential logs in and
    // lands on the portal — proving "active, no force-change" actually works,
    // not merely that a well-formed password appeared on a PDF. ---
    await browserLogin(page, { username: admissionNo, password: temporaryPassword });
    await expect(page).toHaveURL(/\/portal/);

    await admin.dispose();
  });
});

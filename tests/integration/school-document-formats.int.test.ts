import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildStack, type Stack } from "./support/harness";

let stack: Stack;
let admin: string;
let collegeId: string;
const family = "report_card";
const params = () => ({ collegeId, family });
const style = { schoolName: "Greenfield School", accentColor: "#176A57", footerText: "School office · original copy" };

beforeAll(async () => {
  stack = buildStack("school");
  const boot = await stack.bootstrap();
  admin = boot.adminCookie;
  collegeId = boot.collegeId;
});
afterAll(async () => { await stack?.close(); });

describe("school document formats over real storage and audit", () => {
  it("saves a scoped version and private sample, rejects stale and malformed writes, and keeps history immutable", async () => {
    const read = () => stack.call("reporting.school-document-format-get", { cookie: admin, params: params() });
    const before = (await (await read()).json()) as { version: number };
    const username = `format-principal-${randomUUID().slice(0, 8)}`;
    const created = await stack.call("identity.user-create", { cookie: admin, body: {
      username, displayName: username, collegeId, temporaryPassword: "temporary-pass-123", roles: ["principal"],
    } });
    expect(created.status).toBe(201);
    const { id: userId } = (await created.json()) as { id: string };
    const reset = await stack.call("identity.password-reset-init", { cookie: admin, params: { userId } });
    const { token } = (await reset.json()) as { token: string };
    expect((await stack.call("identity.password-reset-confirm", { body: { token, newPassword: "format-principal-pass-123" } })).status).toBe(200);
    const principal = await stack.login(username, "format-principal-pass-123");
    expect((await stack.call("reporting.school-document-format-get", { cookie: principal, params: params() })).status).toBe(403);
    expect((await stack.call("reporting.school-document-format-save", { cookie: principal, params: params(), body: { expectedVersion: before.version, style } })).status).toBe(403);
    expect((await stack.call("reporting.school-document-format-get", { cookie: admin,
      params: { collegeId: "col_outside_scope", family } })).status).toBe(403);
    const bad = await stack.call("reporting.school-document-format-save", { cookie: admin, params: params(), body: {
      expectedVersion: before.version, style, sample: { filename: "bad.pdf", contentType: "application/pdf", dataBase64: Buffer.from("not a pdf").toString("base64") },
    } });
    expect(bad.status).toBe(422);
    expect(((await (await read()).json()) as { version: number }).version).toBe(before.version);

    const sample = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
    const badFilename = await stack.call("reporting.school-document-format-save", { cookie: admin, params: params(), body: {
      expectedVersion: before.version, style,
      sample: { filename: "danger.exe", contentType: "application/pdf", dataBase64: sample.toString("base64") },
    } });
    expect(badFilename.status).toBe(400);
    expect(((await (await read()).json()) as { version: number }).version).toBe(before.version);
    const saved = await stack.call("reporting.school-document-format-save", { cookie: admin, params: params(), body: {
      expectedVersion: before.version, style, sample: { filename: "example.pdf", contentType: "application/pdf", dataBase64: sample.toString("base64") },
    } });
    expect(saved.status, await saved.clone().text()).toBe(200);
    const current = (await saved.json()) as { version: number; style: typeof style; sample: { filename: string } };
    expect(current.version).toBe(before.version + 1);
    expect(current.style).toEqual(style);
    expect(current.sample.filename).toBe("example.pdf");

    const download = await stack.call("reporting.school-document-format-sample", { cookie: admin, params: params() });
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toContain("attachment");
    expect(Buffer.from(await download.arrayBuffer()).equals(sample)).toBe(true);
    expect((await stack.call("reporting.school-document-format-sample", { params: params() })).status).toBe(401);
    expect((await stack.call("reporting.school-document-format-sample", { cookie: principal, params: params() })).status).toBe(403);

    const stale = await stack.call("reporting.school-document-format-save", { cookie: admin, params: params(), body: { expectedVersion: before.version, style } });
    expect(stale.status).toBe(409);
    expect(((await (await read()).json()) as { version: number }).version).toBe(current.version);
    stack.reportingAuditFault.failAction = "reporting.school-document-format-saved";
    try {
      const failed = await stack.call("reporting.school-document-format-save", { cookie: admin, params: params(),
        body: { expectedVersion: current.version, style: { ...style, schoolName: "Should roll back" } } });
      expect(failed.status).toBe(500);
    } finally { stack.reportingAuditFault.failAction = null; }
    expect(((await (await read()).json()) as { version: number }).version).toBe(current.version);
    await expect(stack.pool.query("DELETE FROM rpt_school_document_formats WHERE college_id = $1 AND family = $2 AND version = $3", [collegeId, family, current.version])).rejects.toThrow(/append-only/);
    const audit = await stack.pool.query("SELECT action FROM sys_audit_log WHERE action = 'reporting.school-document-format-saved' AND resource_id = $1", [collegeId]);
    expect(audit.rows.length).toBeGreaterThan(0);
  });
});

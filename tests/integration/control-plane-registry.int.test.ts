import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLogger, migrateDown, migrateUp } from "@vidya/platform";
import { createRegistryRepo, RegistryConflict } from "../../packages/control-plane/src";
import { integrationDatabaseUrl } from "./support/db-url";

const databaseName = `vidya_cp_int_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const source = [{ module: "control-plane", dir: fileURLToPath(new URL("../../packages/control-plane/migrations/", import.meta.url)) }];
const logger = createLogger({ level: "warn", serviceName: "vidya-control-plane-test" });
let maintenance: pg.Pool;
let pool: pg.Pool;

beforeAll(async () => {
  const url = new URL(integrationDatabaseUrl());
  url.pathname = "/postgres";
  maintenance = new pg.Pool({ connectionString: url.toString(), max: 1 });
  await maintenance.query(`CREATE DATABASE "${databaseName}"`);
  url.pathname = `/${databaseName}`;
  pool = new pg.Pool({ connectionString: url.toString(), max: 3 });
  await migrateUp(pool, source, logger);
});

afterAll(async () => {
  await pool?.end();
  if (maintenance) {
    await maintenance.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await maintenance.end();
  }
});

describe("separate vendor registry database", () => {
  it("migrates separately, serializes retries, audits changes and rolls back failed audit writes", async () => {
    expect((await pool.query("SELECT to_regclass('ppl_students') AS pupil_table")).rows[0]?.pupil_table).toBeNull();
    const operatorId = randomUUID();
    await pool.query(`INSERT INTO cp_operators (id, identity_subject, email, display_name)
      VALUES ($1, 'test-oidc-subject', 'operator@vidya.test', 'Test Operator')`, [operatorId]);
    const repo = createRegistryRepo(pool);
    const requestId = randomUUID();
    const input = { code: "greenfield-school", schoolName: "Greenfield School", edition: "school", plannedSeats: 500 };
    const [first, retry] = await Promise.all([
      repo.registerTenant(input, requestId, operatorId),
      repo.registerTenant(input, requestId, operatorId),
    ]);
    expect(first.id).toBe(retry.id);
    expect([first.created, retry.created].sort()).toEqual([false, true]);
    await expect(repo.registerTenant({ ...input, plannedSeats: 600 }, requestId, operatorId)).rejects.toBeInstanceOf(RegistryConflict);
    expect((await pool.query("SELECT count(*)::int AS n FROM cp_tenants")).rows[0]?.n).toBe(1);
    expect((await pool.query("SELECT count(*)::int AS n FROM cp_operator_audit WHERE action = 'tenant.registered'")).rows[0]?.n).toBe(1);

    const saved = await repo.recordSubscription({ tenantId: first.id, expectedRevision: 0, state: "trial",
      paidThrough: "2026-10-31", reason: "Synthetic trial approved" }, operatorId);
    expect(saved.revision).toBe(1);
    await expect(repo.recordSubscription({ tenantId: first.id, expectedRevision: 0, state: "active",
      paidThrough: "2027-10-31", reason: "stale renewal" }, operatorId)).rejects.toBeInstanceOf(RegistryConflict);
    expect((await repo.listTenants(operatorId))[0]).toMatchObject({ id: first.id, subscription_state: "trial", subscription_revision: 1 });

    await pool.query(`CREATE FUNCTION cp_test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action = 'subscription.recorded' THEN RAISE EXCEPTION 'audit fault'; END IF; RETURN NEW; END $$`);
    await pool.query("CREATE TRIGGER cp_test_audit_fault BEFORE INSERT ON cp_operator_audit FOR EACH ROW EXECUTE FUNCTION cp_test_fail_audit()");
    await expect(repo.recordSubscription({ tenantId: first.id, expectedRevision: 1, state: "active",
      paidThrough: "2027-10-31", reason: "should roll back" }, operatorId)).rejects.toThrow(/audit fault/);
    expect((await repo.listTenants(operatorId))[0]?.subscription_revision).toBe(1);
    await expect(pool.query("DELETE FROM cp_subscription_events WHERE tenant_id = $1", [first.id])).rejects.toThrow(/append-only/);

    await pool.query("UPDATE cp_operators SET disabled_at = now() WHERE id = $1", [operatorId]);
    await expect(repo.listTenants(operatorId)).rejects.toThrow(/active operator required/);
    await expect(repo.registerTenant({ ...input, code: "another-school" }, randomUUID(), operatorId)).rejects.toThrow(/active operator required/);

    await migrateDown(pool, source, 1, logger);
    expect((await pool.query("SELECT to_regclass('cp_tenants') AS tenant_table")).rows[0]?.tenant_table).toBeNull();
    await migrateUp(pool, source, logger);
    expect((await pool.query("SELECT to_regclass('cp_tenants') AS tenant_table")).rows[0]?.tenant_table).toBe("cp_tenants");
  });
});

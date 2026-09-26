import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { tenantInputSchema } from "./tenant-contract";

export class RegistryConflict extends Error {
  constructor(message: string) { super(message); this.name = "RegistryConflict"; }
}

const subscriptionChangeSchema = z.object({
  tenantId: z.string().uuid(),
  expectedRevision: z.number().int().min(0),
  state: z.enum(["trial", "active", "past_due", "grace", "restricted", "suspended", "cancelled"]),
  paidThrough: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const time = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
  }),
  reason: z.string().trim().min(3).max(500),
}).strict();

export type TenantRow = {
  id: string; code: string; school_name: string; edition: "school";
  planned_seats: number; deployment_state: string; created_at: Date;
  subscription_state: string | null; paid_through: string | null; subscription_revision: number | null;
};

async function transaction<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await action(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function requireActiveOperator(client: PoolClient, operatorId: string): Promise<void> {
  const active = await client.query(
    "SELECT id FROM cp_operators WHERE id = $1 AND disabled_at IS NULL FOR SHARE", [operatorId],
  );
  if (active.rowCount !== 1) throw new Error("active operator required");
}

/** The caller must supply an authenticated, active control-plane operator ID. */
export function createRegistryRepo(pool: Pool) {
  return {
    async registerTenant(raw: unknown, requestId: string, operatorId: string): Promise<{ id: string; created: boolean }> {
      const input = tenantInputSchema.parse(raw);
      if (!z.string().uuid().safeParse(requestId).success || !z.string().uuid().safeParse(operatorId).success) {
        throw new Error("valid request and operator IDs required");
      }
      return transaction(pool, async (client) => {
        await requireActiveOperator(client, operatorId);
        // Serialize same-operation retries before the idempotency lookup.
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [requestId]);
        const existing = await client.query<Pick<TenantRow, "id" | "code" | "school_name" | "edition" | "planned_seats">>(
          "SELECT id, code, school_name, edition, planned_seats FROM cp_tenants WHERE request_id = $1 FOR UPDATE", [requestId],
        );
        if (existing.rows[0]) {
          const row = existing.rows[0];
          if (row.code !== input.code || row.school_name !== input.schoolName || row.edition !== input.edition || row.planned_seats !== input.plannedSeats) {
            throw new RegistryConflict("request ID was already used for different tenant details");
          }
          return { id: row.id, created: false };
        }
        const id = randomUUID();
        try {
          await client.query(
            "INSERT INTO cp_tenants (id, request_id, code, school_name, edition, planned_seats) VALUES ($1,$2,$3,$4,$5,$6)",
            [id, requestId, input.code, input.schoolName, input.edition, input.plannedSeats],
          );
        } catch (error) {
          if ((error as { code?: string }).code === "23505") throw new RegistryConflict("tenant code or request ID already exists");
          throw error;
        }
        await client.query(
          "INSERT INTO cp_operator_audit (id, operator_id, action, tenant_id, detail) VALUES ($1,$2,$3,$4,$5)",
          [randomUUID(), operatorId, "tenant.registered", id, JSON.stringify({ code: input.code, edition: input.edition })],
        );
        return { id, created: true };
      });
    },

    async listTenants(operatorId: string, limit = 50, offset = 0): Promise<TenantRow[]> {
      if (!z.string().uuid().safeParse(operatorId).success) throw new Error("valid operator ID required");
      if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
        throw new Error("invalid pagination");
      }
      return transaction(pool, async (client) => {
        await requireActiveOperator(client, operatorId);
        const result = await client.query<TenantRow>(`SELECT t.id, t.code, t.school_name, t.edition, t.planned_seats,
        t.deployment_state, t.created_at, s.state AS subscription_state,
        s.paid_through::text AS paid_through, s.revision AS subscription_revision
        FROM cp_tenants t LEFT JOIN LATERAL (
          SELECT state, paid_through, revision FROM cp_subscription_events
          WHERE tenant_id = t.id ORDER BY revision DESC LIMIT 1
        ) s ON true ORDER BY t.created_at DESC, t.id DESC LIMIT $1 OFFSET $2`, [limit, offset]);
        return result.rows;
      });
    },

    async recordSubscription(raw: unknown, operatorId: string): Promise<{ revision: number }> {
      const input = subscriptionChangeSchema.parse(raw);
      if (!z.string().uuid().safeParse(operatorId).success) throw new Error("valid operator ID required");
      return transaction(pool, async (client) => {
        await requireActiveOperator(client, operatorId);
        const tenant = await client.query("SELECT id FROM cp_tenants WHERE id = $1 FOR UPDATE", [input.tenantId]);
        if (tenant.rowCount !== 1) throw new RegistryConflict("no such tenant");
        const current = await client.query<{ revision: number }>(
          "SELECT revision FROM cp_subscription_events WHERE tenant_id = $1 ORDER BY revision DESC LIMIT 1", [input.tenantId],
        );
        const revision = current.rows[0]?.revision ?? 0;
        if (revision !== input.expectedRevision) throw new RegistryConflict("subscription changed since it was read");
        await client.query(`INSERT INTO cp_subscription_events
          (id, tenant_id, revision, state, paid_through, grace_days, operator_id, reason)
          VALUES ($1,$2,$3,$4,$5,30,$6,$7)`,
        [randomUUID(), input.tenantId, revision + 1, input.state, input.paidThrough, operatorId, input.reason]);
        await client.query(
          "INSERT INTO cp_operator_audit (id, operator_id, action, tenant_id, detail) VALUES ($1,$2,$3,$4,$5)",
          [randomUUID(), operatorId, "subscription.recorded", input.tenantId,
            JSON.stringify({ revision: revision + 1, state: input.state, paidThrough: input.paidThrough })],
        );
        return { revision: revision + 1 };
      });
    },
  };
}

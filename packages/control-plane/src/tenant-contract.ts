import { z } from "zod";

/** Commercial and deployment metadata only. Never place school records here. */
export const tenantInputSchema = z.object({
  code: z.string().regex(/^[a-z][a-z0-9-]{2,62}$/),
  schoolName: z.string().trim().min(2).max(160),
  edition: z.literal("school"),
  plannedSeats: z.number().int().min(1).max(100_000),
}).strict();

export type TenantInput = z.infer<typeof tenantInputSchema>;

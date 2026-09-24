import type { RouteSpec } from "@vidya/platform";
import { passwordSchema, usernameSchema } from "@vidya/module-identity";
import { z } from "zod";

/**
 * Guardian routes (ADR-0027). Three audiences, each explicit:
 *  - staff routes carry role lists and a per-student ScopeChecker decision;
 *  - activation is public (the caller has no account yet) and rate-limited,
 *    because possession of the code is the credential;
 *  - guardian routes declare `audience: "guardian"`, which the route gate
 *    checks before anything else — no staff principal can call them.
 */

const MODULE_NAME = "people";
const idSchema = z.string().min(1).max(64);
const problemSchema = z.object({ message: z.string() }).passthrough();

export const relationshipTypeSchema = z.enum(["parent", "legal-guardian", "other-authorized-contact"]);

const relationshipViewSchema = z.object({
  id: z.string(),
  guardianName: z.string(),
  relationshipType: relationshipTypeSchema,
  isPrimaryContact: z.boolean(),
  verificationState: z.enum(["unverified", "self-attested", "staff-verified"]),
  status: z.enum(["pending", "active", "restricted", "revoked", "expired"]),
  categories: z.array(z.string()),
  statusReason: z.string().nullable(),
  since: z.string(),
});

const invitationViewSchema = z.object({
  id: z.string(),
  guardianName: z.string(),
  relationshipType: relationshipTypeSchema,
  contactMethod: z.enum(["sms", "email"]),
  contactValue: z.string(),
  staffVerified: z.boolean(),
  expiresAt: z.string(),
});

const childViewSchema = z.object({
  studentId: z.string(),
  fullName: z.string(),
  admissionNo: z.string(),
  relationshipType: relationshipTypeSchema,
  status: z.enum(["pending", "active", "restricted", "revoked", "expired"]),
  categories: z.array(z.string()),
});

const codeSchema = z.string().trim().min(20).max(40);

const STAFF_READ = { public: false as const, requirement: { rolesAnyOf: ["admin" as const, "principal" as const, "class_teacher" as const] } };
// ADR-0027 Decision 8: a class teacher may invite for their own class.
const STAFF_INVITE = { public: false as const, requirement: { rolesAnyOf: ["admin" as const, "class_teacher" as const] } };
// ADR-0027 Decision 8: revocation is admin-only; so is verification, which
// is the other direction in which a relationship's authority changes.
const ADMIN_ONLY = { public: false as const, requirement: { rolesAnyOf: ["admin" as const] } };
const GUARDIAN = { public: false as const, requirement: { audience: "guardian" as const } };

export const guardianRoutes: RouteSpec[] = [
  {
    id: "people.student-guardians",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/people/students/{studentId}/guardians",
    summary: "A pupil's guardians and pending invitations (staff)",
    tags: ["people-guardians"],
    auth: STAFF_READ,
    request: { params: z.object({ studentId: idSchema }) },
    responses: {
      200: {
        description: "Relationships (every status) and unexpired pending invitations",
        schema: z.object({ relationships: z.array(relationshipViewSchema), invitations: z.array(invitationViewSchema) }),
      },
      403: { description: "Scope check denied", schema: problemSchema },
      404: { description: "No such student", schema: problemSchema },
    },
  },
  {
    id: "people.guardian-invitation-issue",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/people/students/{studentId}/guardian-invitations",
    summary: "Invite a guardian for a pupil (admin, or the class teacher)",
    description:
      "Returns a single-use code valid for 72 hours, exactly once: only its hash is stored, and it is never audited or logged. Staff hand it to the adult over the recorded contact channel. Re-issuing to the same contact invalidates the earlier code. `staffVerified` records that the member of staff has checked the adult's identity in person; without it, a third adult for one pupil, and any other-authorized-contact, waits for an administrator to verify them.",
    tags: ["people-guardians"],
    auth: STAFF_INVITE,
    request: {
      params: z.object({ studentId: idSchema }),
      body: z.object({
        guardianName: z.string().trim().min(1).max(128),
        relationshipType: relationshipTypeSchema,
        contactMethod: z.enum(["sms", "email"]),
        contactValue: z.string().trim().min(3).max(254),
        staffVerified: z.boolean().default(false),
      }),
    },
    audit: { action: "people.guardian-invited", resourceType: "student" },
    responses: {
      201: { description: "Invitation issued; `code` is shown once", schema: z.object({ invitation: invitationViewSchema, code: z.string() }) },
      403: { description: "Scope check denied", schema: problemSchema },
      404: { description: "No such student", schema: problemSchema },
    },
  },
  {
    id: "people.guardian-relationship-verify",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/people/guardian-relationships/{relationshipId}/verify",
    summary: "Record staff verification of a guardian (admin)",
    tags: ["people-guardians"],
    auth: ADMIN_ONLY,
    request: { params: z.object({ relationshipId: idSchema }) },
    audit: { action: "people.guardian-verified", resourceType: "guardian-relationship" },
    responses: {
      200: { description: "Verified; a pending relationship becomes active", schema: z.object({ relationship: relationshipViewSchema }) },
      403: { description: "Scope check denied", schema: problemSchema },
      404: { description: "No such relationship", schema: problemSchema },
      409: { description: "The relationship is revoked or changed during the request", schema: problemSchema },
    },
  },
  {
    id: "people.guardian-relationship-revoke",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/people/guardian-relationships/{relationshipId}/revoke",
    summary: "Revoke a guardian's access to one pupil (admin)",
    description: "Takes effect on the guardian's next request; their access to any other child is unaffected.",
    tags: ["people-guardians"],
    auth: ADMIN_ONLY,
    request: {
      params: z.object({ relationshipId: idSchema }),
      body: z.object({ reason: z.string().trim().min(3).max(500) }),
    },
    audit: { action: "people.guardian-revoked", resourceType: "guardian-relationship" },
    responses: {
      200: { description: "Revoked", schema: z.object({ relationship: relationshipViewSchema }) },
      403: { description: "Scope check denied", schema: problemSchema },
      404: { description: "No such relationship", schema: problemSchema },
      409: { description: "Relationship changed during the request", schema: problemSchema },
    },
  },
  {
    id: "people.guardian-activate",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/people/guardian-invitations/activate",
    summary: "Redeem an invitation and create a guardian sign-in",
    description:
      "For an adult with no sign-in yet. Refusals are uniform (400) whatever the reason, so the endpoint cannot be used to learn whether a code exists, was used, or expired. Rate-limited per address.",
    tags: ["people-guardians"],
    auth: { public: true, reason: "the caller has no account yet — possession of the single-use invitation code is the credential" },
    rateLimit: { scope: "password" },
    request: {
      body: z.object({
        code: codeSchema,
        fullName: z.string().trim().min(1).max(128),
        username: usernameSchema,
        password: passwordSchema,
      }),
    },
    audit: { action: "people.guardian-activated", resourceType: "guardian-relationship" },
    responses: {
      201: {
        description: "Sign-in created and linked; sign in to continue",
        schema: z.object({ username: z.string(), child: z.object({ fullName: z.string() }), status: z.enum(["active", "pending"]) }),
      },
      400: { description: "The code cannot be used", schema: problemSchema },
      409: { description: "Username already taken", schema: problemSchema },
      429: { description: "Too many attempts from this address", schema: problemSchema },
    },
  },
  {
    id: "people.guardian-redeem",
    module: MODULE_NAME,
    method: "POST",
    path: "/api/v1/people/guardian-invitations/redeem",
    summary: "Link another child to the signed-in guardian",
    tags: ["people-guardians"],
    auth: GUARDIAN,
    rateLimit: { scope: "password", identifier: { source: "principal" } },
    request: { body: z.object({ code: codeSchema }) },
    audit: { action: "people.guardian-activated", resourceType: "guardian-relationship" },
    responses: {
      201: { description: "Linked", schema: z.object({ child: z.object({ fullName: z.string() }), status: z.enum(["active", "pending"]) }) },
      400: { description: "The code cannot be used", schema: problemSchema },
    },
  },
  {
    id: "people.guardian-children",
    module: MODULE_NAME,
    method: "GET",
    path: "/api/v1/people/guardian/children",
    summary: "The children the signed-in guardian is linked to",
    description: "The guardian's read-only view of their own relationships: status and the record categories each one covers. Revoked links are omitted.",
    tags: ["people-guardians"],
    auth: GUARDIAN,
    responses: { 200: { description: "Linked children", schema: z.object({ children: z.array(childViewSchema) }) } },
  },
];

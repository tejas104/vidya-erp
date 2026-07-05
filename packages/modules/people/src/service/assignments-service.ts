import type { AuditLogger, OrgPath } from "@vidya/platform";
import type { DerivedGrantInput, DerivedGrantsApi } from "@vidya/module-identity";
import type { OrgRepo } from "../repo/org-repo";
import type { AssignmentKind, PeopleRepo } from "../repo/people-repo";
import type { PplAssignmentRow, PplTeacherRow } from "../db/schema";
import { UnknownReferenceError } from "./people-service";

export const ASSIGNMENT_SOURCE_PREFIX = "people:assignment:";

export const sourceRefFor = (assignmentId: string): string =>
  `${ASSIGNMENT_SOURCE_PREFIX}${assignmentId}`;

export interface AssignmentsServiceDeps {
  readonly repo: PeopleRepo;
  readonly orgRepo: OrgRepo;
  /** Identity's derived-grant surface — the ONLY path grants are touched through. */
  readonly identityGrants: DerivedGrantsApi;
  readonly audit: AuditLogger;
}

/**
 * THE GRANT-DERIVATION SEAM (ADR-0015). Teacher assignments are the source
 * of truth; each row materializes as exactly one derived identity grant:
 *
 *   subject_teacher(class C, subject S) → teacher-role grant {class C, S}
 *   class_teacher(class C)              → class_teacher-role grant {class C}
 *
 * Grants are class-level (no sectionId) per the approved policy. Ordering:
 * on create, the row is written first and the grant call is compensated
 * (row deleted) on failure; on delete, the grant is removed first. A
 * periodic reconcile repairs any residual drift and audits repairs.
 * Session invalidation lives inside the identity surface (#2 invariant).
 */
export class AssignmentsService {
  constructor(private readonly deps: AssignmentsServiceDeps) {}

  private async desiredGrantFor(
    assignment: PplAssignmentRow,
    teacher: PplTeacherRow,
  ): Promise<DerivedGrantInput | null> {
    if (teacher.identityUserId === null || teacher.status !== "active") {
      return null;
    }
    const org = await this.deps.orgRepo.pathForClass(assignment.classId);
    if (org === null) {
      return null;
    }
    // Class-level authority: the section dimension is never narrowed here.
    const classOrg: OrgPath = {
      collegeId: org.collegeId,
      departmentId: org.departmentId,
      classId: org.classId,
    };
    if (assignment.kind === "subject_teacher") {
      return {
        userId: teacher.identityUserId,
        role: "teacher",
        org: classOrg,
        subjectId: assignment.subjectId ?? undefined,
        sourceRef: sourceRefFor(assignment.id),
      };
    }
    return {
      userId: teacher.identityUserId,
      role: "class_teacher",
      org: classOrg,
      sourceRef: sourceRefFor(assignment.id),
    };
  }

  /**
   * Creates the assignment and derives its grant. Compensates (deletes the
   * row) when the grant call fails, so authority and source of truth never
   * drift silently in either direction.
   */
  async create(input: {
    teacherId: string;
    classId: string;
    subjectId?: string;
    kind: AssignmentKind;
    academicYear: string;
  }): Promise<PplAssignmentRow | null> {
    const teacher = await this.deps.repo.getTeacher(input.teacherId);
    if (teacher === null) {
      return null;
    }
    if ((await this.deps.orgRepo.getClass(input.classId)) === null) {
      throw new UnknownReferenceError(`classId "${input.classId}"`);
    }
    if (input.subjectId !== undefined && (await this.deps.orgRepo.getSubject(input.subjectId)) === null) {
      throw new UnknownReferenceError(`subjectId "${input.subjectId}"`);
    }
    const assignment = await this.deps.repo.createAssignment(input);
    try {
      const desired = await this.desiredGrantFor(assignment, teacher);
      if (desired !== null) {
        await this.deps.identityGrants.upsert(desired);
      }
    } catch (error) {
      await this.deps.repo.deleteAssignment(assignment.id);
      throw error;
    }
    return assignment;
  }

  /** Removes the derived grant FIRST, then the row (fail-closed ordering). */
  async remove(assignmentId: string): Promise<boolean> {
    const assignment = await this.deps.repo.getAssignment(assignmentId);
    if (assignment === null) {
      return false;
    }
    await this.deps.identityGrants.removeBySourceRef(sourceRefFor(assignmentId));
    return this.deps.repo.deleteAssignment(assignmentId);
  }

  getAssignment(id: string): Promise<PplAssignmentRow | null> {
    return this.deps.repo.getAssignment(id);
  }

  assignmentsByClass(classId: string): Promise<PplAssignmentRow[]> {
    return this.deps.repo.assignmentsByClass(classId);
  }

  /**
   * Re-syncs one teacher's derived grants against their assignments —
   * called after identity linking/unlinking and status changes. Handles
   * both directions (linked+active ⇒ grants exist; otherwise ⇒ removed).
   */
  async syncTeacher(teacherId: string): Promise<{ upserted: number; removed: number }> {
    const teacher = await this.deps.repo.getTeacher(teacherId);
    if (teacher === null) {
      return { upserted: 0, removed: 0 };
    }
    const assignments = await this.deps.repo.assignmentsByTeacher(teacherId);
    let upserted = 0;
    let removed = 0;
    for (const assignment of assignments) {
      const desired = await this.desiredGrantFor(assignment, teacher);
      if (desired !== null) {
        const result = await this.deps.identityGrants.upsert(desired);
        if (result.changed) {
          upserted += 1;
        }
      } else if (await this.deps.identityGrants.removeBySourceRef(sourceRefFor(assignment.id))) {
        removed += 1;
      }
    }
    return { upserted, removed };
  }

  /**
   * Full reconciliation (hourly worker job + on-demand): assignments are
   * the source of truth; derived grants converge to them. Repairs are
   * audited; a clean pass is silent.
   */
  async reconcile(): Promise<{ upserted: number; removed: number }> {
    const assignments = await this.deps.repo.listAllAssignments();
    const desired = new Map<string, DerivedGrantInput>();
    for (const assignment of assignments) {
      const teacher = await this.deps.repo.getTeacher(assignment.teacherId);
      if (teacher === null) {
        continue;
      }
      const input = await this.desiredGrantFor(assignment, teacher);
      if (input !== null) {
        desired.set(input.sourceRef, input);
      }
    }

    let upserted = 0;
    for (const input of desired.values()) {
      const result = await this.deps.identityGrants.upsert(input);
      if (result.changed) {
        upserted += 1;
      }
    }

    let removed = 0;
    const actual = await this.deps.identityGrants.listBySourcePrefix(ASSIGNMENT_SOURCE_PREFIX);
    for (const grant of actual) {
      if (!desired.has(grant.sourceRef)) {
        if (await this.deps.identityGrants.removeBySourceRef(grant.sourceRef)) {
          removed += 1;
        }
      }
    }

    if (upserted > 0 || removed > 0) {
      await this.deps.audit.record({
        module: "people",
        action: "people.grant-reconcile-repaired",
        actorType: "system",
        actorId: null,
        resourceType: "scope-grant",
        resourceId: null,
        requestId: null,
        details: { upserted, removed },
      });
    }
    return { upserted, removed };
  }
}

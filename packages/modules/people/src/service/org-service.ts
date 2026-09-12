import type { AuditLogger, OrgDirectory, OrgPath } from "@vidya/platform";
import type { OrgRepo, OrgTree, OrgUnitType } from "../repo/org-repo";
import type {
  PplClassRow,
  PplCollegeRow,
  PplDepartmentRow,
  PplSectionRow,
  PplSubjectRow,
} from "../db/schema";

/**
 * A school has no departments, but `ppl_classes.department_id` and
 * `ppl_subjects.department_id` are NOT NULL (schema.ts:41, :58) and
 * OrgDirectory.verifyOrgPath refuses a classId without a departmentId
 * (below). So a school install gets exactly ONE department that its UI and
 * API never render or accept: the school's standards hang off it, and the
 * org path a school resource carries is a full four-level path whose
 * department level is this row.
 *
 * Why not nullable FKs: that would mean a migration on both tables plus
 * every join, grant-derivation path and containment check handling the
 * hole — for a level the school product does not have. Why not a separate
 * school org tree: it would duplicate enrollment, teacher assignment and
 * grant derivation forever. This is the owner's 2026-09-12 ruling.
 *
 * ponytail: sentinel code rather than an `is_implicit` column — no
 * migration. Add the column if a school ever needs a second department.
 */
export const IMPLICIT_DEPARTMENT_CODE = "__SCHOOL__";
export const IMPLICIT_DEPARTMENT_NAME = "School";

export interface OrgServiceDeps {
  readonly repo: OrgRepo;
  readonly audit: AuditLogger;
}

/**
 * Org-tree management + the OrgDirectory implementation (#2's contract).
 * Handlers add the scope-check; this service owns persistence choreography
 * and path resolution.
 */
export class OrgService {
  constructor(private readonly deps: OrgServiceDeps) {}

  /** #2's OrgDirectory contract: existence AND nesting of every level. */
  readonly orgDirectory: OrgDirectory = {
    verifyOrgPath: async (path: OrgPath) => {
      const college = await this.deps.repo.getCollege(path.collegeId);
      if (college === null) {
        return { valid: false, reason: `unknown collegeId "${path.collegeId}"` };
      }
      let department = null;
      if (path.departmentId !== undefined) {
        department = await this.deps.repo.getDepartment(path.departmentId);
        if (department === null || department.collegeId !== path.collegeId) {
          return { valid: false, reason: `departmentId "${path.departmentId}" is not in this college` };
        }
      }
      let classRow = null;
      if (path.classId !== undefined) {
        if (department === null) {
          return { valid: false, reason: "classId requires departmentId" };
        }
        classRow = await this.deps.repo.getClass(path.classId);
        if (classRow === null || classRow.departmentId !== department.id) {
          return { valid: false, reason: `classId "${path.classId}" is not in this department` };
        }
      }
      if (path.sectionId !== undefined) {
        if (classRow === null) {
          return { valid: false, reason: "sectionId requires classId" };
        }
        const section = await this.deps.repo.getSection(path.sectionId);
        if (section === null || section.classId !== classRow.id) {
          return { valid: false, reason: `sectionId "${path.sectionId}" is not in this class` };
        }
      }
      return { valid: true };
    },
    verifySubjectId: async (subjectId: string) =>
      (await this.deps.repo.getSubject(subjectId)) !== null,
  };

  /**
   * The school edition's single implicit department, created on first use
   * and audited as system activity. Idempotent: resolves by the reserved
   * code, so a re-run (or an install that already has one) returns it.
   */
  async ensureImplicitDepartment(collegeId: string): Promise<{ departmentId: string; created: boolean }> {
    const existing = (await this.deps.repo.listDepartmentsOfCollege(collegeId)).find(
      (department) => department.code === IMPLICIT_DEPARTMENT_CODE,
    );
    if (existing !== undefined) {
      return { departmentId: existing.id, created: false };
    }
    const created = await this.deps.repo.createDepartment({
      collegeId,
      name: IMPLICIT_DEPARTMENT_NAME,
      code: IMPLICIT_DEPARTMENT_CODE,
    });
    await this.deps.audit.record({
      module: "people",
      action: "people.implicit-department-created",
      actorType: "system",
      actorId: null,
      resourceType: "department",
      resourceId: created.id,
      requestId: null,
      details: { collegeId, code: IMPLICIT_DEPARTMENT_CODE, reason: "school edition has no department level" },
    });
    return { departmentId: created.id, created: true };
  }

  createDepartment(input: { collegeId: string; name: string; code: string }): Promise<PplDepartmentRow> {
    return this.deps.repo.createDepartment(input);
  }
  createClass(input: { departmentId: string; name: string; code: string }): Promise<PplClassRow> {
    return this.deps.repo.createClass(input);
  }
  createSection(input: { classId: string; name: string }): Promise<PplSectionRow> {
    return this.deps.repo.createSection(input);
  }
  createSubject(input: { departmentId: string; name: string; code: string }): Promise<PplSubjectRow> {
    return this.deps.repo.createSubject(input);
  }

  getCollege(id: string): Promise<PplCollegeRow | null> {
    return this.deps.repo.getCollege(id);
  }
  getDepartment(id: string): Promise<PplDepartmentRow | null> {
    return this.deps.repo.getDepartment(id);
  }
  getClass(id: string): Promise<PplClassRow | null> {
    return this.deps.repo.getClass(id);
  }
  getSection(id: string): Promise<PplSectionRow | null> {
    return this.deps.repo.getSection(id);
  }
  getSubject(id: string): Promise<PplSubjectRow | null> {
    return this.deps.repo.getSubject(id);
  }
  listColleges(): Promise<PplCollegeRow[]> {
    return this.deps.repo.listColleges();
  }
  getTree(collegeId: string): Promise<OrgTree | null> {
    return this.deps.repo.getTree(collegeId);
  }
  renameUnit(unitType: OrgUnitType, id: string, name: string): Promise<boolean> {
    return this.deps.repo.renameUnit(unitType, id, name);
  }
  deleteUnit(unitType: OrgUnitType, id: string): Promise<boolean> {
    return this.deps.repo.deleteUnit(unitType, id);
  }

  /** OrgPath for a unit (its own position; the unit's id included). */
  async pathForUnit(unitType: OrgUnitType, id: string): Promise<OrgPath | null> {
    switch (unitType) {
      case "college": {
        const college = await this.deps.repo.getCollege(id);
        return college === null ? null : { collegeId: college.id };
      }
      case "department":
        return this.deps.repo.pathForDepartment(id);
      case "class":
        return this.deps.repo.pathForClass(id);
      case "section":
        return this.deps.repo.pathForSection(id);
      case "subject": {
        const subject = await this.deps.repo.getSubject(id);
        return subject === null ? null : this.deps.repo.pathForDepartment(subject.departmentId);
      }
    }
  }

  pathForClass(classId: string): Promise<OrgPath | null> {
    return this.deps.repo.pathForClass(classId);
  }
  pathForSection(sectionId: string): Promise<OrgPath | null> {
    return this.deps.repo.pathForSection(sectionId);
  }

  /**
   * Platform bootstrap (operator CLI): creates the college if its code is
   * new, returns the existing one otherwise (idempotent), audited as
   * system activity either way it creates.
   */
  async bootstrapCollege(input: { name: string; code: string }): Promise<{ collegeId: string; created: boolean }> {
    const existing = await this.deps.repo.findCollegeByCode(input.code);
    if (existing !== null) {
      return { collegeId: existing.id, created: false };
    }
    const created = await this.deps.repo.createCollege(input);
    await this.deps.audit.record({
      module: "people",
      action: "people.college-bootstrapped",
      actorType: "system",
      actorId: null,
      resourceType: "college",
      resourceId: created.id,
      requestId: null,
      details: { name: input.name, code: input.code },
    });
    return { collegeId: created.id, created: true };
  }
}

import type { AuditLogger, OrgDirectory, OrgPath } from "@vidya/platform";
import type { OrgRepo, OrgTree, OrgUnitType } from "../repo/org-repo";
import type {
  PplClassRow,
  PplCollegeRow,
  PplDepartmentRow,
  PplSectionRow,
  PplSubjectRow,
} from "../db/schema";

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

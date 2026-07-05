import { asc, eq } from "drizzle-orm";
import type { Db, OrgPath } from "@vidya/platform";
import { newId } from "../ids";
import {
  pplClasses,
  pplColleges,
  pplDepartments,
  pplSections,
  pplSubjects,
  type PplClassRow,
  type PplCollegeRow,
  type PplDepartmentRow,
  type PplSectionRow,
  type PplSubjectRow,
} from "../db/schema";

export type OrgUnitType = "college" | "department" | "class" | "section" | "subject";

export class DuplicateCodeError extends Error {
  constructor(unitType: OrgUnitType, code: string) {
    super(`${unitType} code "${code}" already exists under this parent`);
    this.name = "DuplicateCodeError";
  }
}

export class UnitInUseError extends Error {
  constructor(unitType: OrgUnitType) {
    super(`${unitType} still has children or references and cannot be deleted`);
    this.name = "UnitInUseError";
  }
}

function pgErrorCode(error: unknown): string | undefined {
  return (error as { code?: string }).code;
}

export interface OrgTree {
  readonly college: PplCollegeRow;
  readonly departments: readonly (PplDepartmentRow & {
    readonly classes: readonly (PplClassRow & { readonly sections: readonly PplSectionRow[] })[];
    readonly subjects: readonly PplSubjectRow[];
  })[];
}

export interface OrgRepo {
  createCollege(input: { name: string; code: string }): Promise<PplCollegeRow>;
  createDepartment(input: { collegeId: string; name: string; code: string }): Promise<PplDepartmentRow>;
  createClass(input: { departmentId: string; name: string; code: string }): Promise<PplClassRow>;
  createSection(input: { classId: string; name: string }): Promise<PplSectionRow>;
  createSubject(input: { departmentId: string; name: string; code: string }): Promise<PplSubjectRow>;

  getCollege(id: string): Promise<PplCollegeRow | null>;
  getDepartment(id: string): Promise<PplDepartmentRow | null>;
  getClass(id: string): Promise<PplClassRow | null>;
  getSection(id: string): Promise<PplSectionRow | null>;
  getSubject(id: string): Promise<PplSubjectRow | null>;
  findCollegeByCode(code: string): Promise<PplCollegeRow | null>;

  listColleges(): Promise<PplCollegeRow[]>;
  getTree(collegeId: string): Promise<OrgTree | null>;

  renameUnit(unitType: OrgUnitType, id: string, name: string): Promise<boolean>;
  /** Throws UnitInUseError when children/references block deletion (RESTRICT). */
  deleteUnit(unitType: OrgUnitType, id: string): Promise<boolean>;

  /** Full OrgPath (up to the college) for a unit — used to build ResourceRefs. */
  pathForDepartment(id: string): Promise<OrgPath | null>;
  pathForClass(id: string): Promise<OrgPath | null>;
  pathForSection(id: string): Promise<OrgPath | null>;
}

export function createOrgRepo(db: Db): OrgRepo {
  async function insertGuarded<T>(
    unitType: OrgUnitType,
    code: string,
    run: () => Promise<T[]>,
  ): Promise<T> {
    try {
      const rows = await run();
      const row = rows[0];
      if (row === undefined) {
        throw new Error(`${unitType} insert returned no row`);
      }
      return row;
    } catch (error) {
      if (pgErrorCode(error) === "23505") {
        throw new DuplicateCodeError(unitType, code);
      }
      throw error;
    }
  }

  const repo: OrgRepo = {
    createCollege: ({ name, code }) =>
      insertGuarded("college", code, () =>
        db.insert(pplColleges).values({ id: newId("col"), name, code }).returning(),
      ),

    createDepartment: ({ collegeId, name, code }) =>
      insertGuarded("department", code, () =>
        db.insert(pplDepartments).values({ id: newId("dep"), collegeId, name, code }).returning(),
      ),

    createClass: ({ departmentId, name, code }) =>
      insertGuarded("class", code, () =>
        db.insert(pplClasses).values({ id: newId("cls"), departmentId, name, code }).returning(),
      ),

    createSection: ({ classId, name }) =>
      insertGuarded("section", name, () =>
        db.insert(pplSections).values({ id: newId("sec"), classId, name }).returning(),
      ),

    createSubject: ({ departmentId, name, code }) =>
      insertGuarded("subject", code, () =>
        db.insert(pplSubjects).values({ id: newId("sub"), departmentId, name, code }).returning(),
      ),

    async getCollege(id) {
      const rows = await db.select().from(pplColleges).where(eq(pplColleges.id, id)).limit(1);
      return rows[0] ?? null;
    },
    async getDepartment(id) {
      const rows = await db.select().from(pplDepartments).where(eq(pplDepartments.id, id)).limit(1);
      return rows[0] ?? null;
    },
    async getClass(id) {
      const rows = await db.select().from(pplClasses).where(eq(pplClasses.id, id)).limit(1);
      return rows[0] ?? null;
    },
    async getSection(id) {
      const rows = await db.select().from(pplSections).where(eq(pplSections.id, id)).limit(1);
      return rows[0] ?? null;
    },
    async getSubject(id) {
      const rows = await db.select().from(pplSubjects).where(eq(pplSubjects.id, id)).limit(1);
      return rows[0] ?? null;
    },
    async findCollegeByCode(code) {
      const rows = await db.select().from(pplColleges).where(eq(pplColleges.code, code)).limit(1);
      return rows[0] ?? null;
    },

    async listColleges() {
      return db.select().from(pplColleges).orderBy(asc(pplColleges.name));
    },

    async getTree(collegeId) {
      const college = await repo.getCollege(collegeId);
      if (college === null) {
        return null;
      }
      const departments = await db
        .select()
        .from(pplDepartments)
        .where(eq(pplDepartments.collegeId, collegeId))
        .orderBy(asc(pplDepartments.code));
      const result = [];
      for (const department of departments) {
        const classes = await db
          .select()
          .from(pplClasses)
          .where(eq(pplClasses.departmentId, department.id))
          .orderBy(asc(pplClasses.code));
        const classesWithSections = [];
        for (const classRow of classes) {
          const sections = await db
            .select()
            .from(pplSections)
            .where(eq(pplSections.classId, classRow.id))
            .orderBy(asc(pplSections.name));
          classesWithSections.push({ ...classRow, sections });
        }
        const subjects = await db
          .select()
          .from(pplSubjects)
          .where(eq(pplSubjects.departmentId, department.id))
          .orderBy(asc(pplSubjects.code));
        result.push({ ...department, classes: classesWithSections, subjects });
      }
      return { college, departments: result };
    },

    async renameUnit(unitType, id, name) {
      const now = new Date();
      const run = async (): Promise<number> => {
        switch (unitType) {
          case "college":
            return (await db.update(pplColleges).set({ name, updatedAt: now }).where(eq(pplColleges.id, id)).returning()).length;
          case "department":
            return (await db.update(pplDepartments).set({ name, updatedAt: now }).where(eq(pplDepartments.id, id)).returning()).length;
          case "class":
            return (await db.update(pplClasses).set({ name, updatedAt: now }).where(eq(pplClasses.id, id)).returning()).length;
          case "section":
            return (await db.update(pplSections).set({ name, updatedAt: now }).where(eq(pplSections.id, id)).returning()).length;
          case "subject":
            return (await db.update(pplSubjects).set({ name, updatedAt: now }).where(eq(pplSubjects.id, id)).returning()).length;
        }
      };
      return (await run()) > 0;
    },

    async deleteUnit(unitType, id) {
      try {
        const run = async (): Promise<number> => {
          switch (unitType) {
            case "college":
              return (await db.delete(pplColleges).where(eq(pplColleges.id, id)).returning()).length;
            case "department":
              return (await db.delete(pplDepartments).where(eq(pplDepartments.id, id)).returning()).length;
            case "class":
              return (await db.delete(pplClasses).where(eq(pplClasses.id, id)).returning()).length;
            case "section":
              return (await db.delete(pplSections).where(eq(pplSections.id, id)).returning()).length;
            case "subject":
              return (await db.delete(pplSubjects).where(eq(pplSubjects.id, id)).returning()).length;
          }
        };
        return (await run()) > 0;
      } catch (error) {
        if (pgErrorCode(error) === "23503") {
          throw new UnitInUseError(unitType);
        }
        throw error;
      }
    },

    async pathForDepartment(id) {
      const department = await repo.getDepartment(id);
      if (department === null) {
        return null;
      }
      return { collegeId: department.collegeId, departmentId: department.id };
    },

    async pathForClass(id) {
      const classRow = await repo.getClass(id);
      if (classRow === null) {
        return null;
      }
      const parent = await repo.pathForDepartment(classRow.departmentId);
      return parent === null ? null : { ...parent, classId: classRow.id };
    },

    async pathForSection(id) {
      const section = await repo.getSection(id);
      if (section === null) {
        return null;
      }
      const parent = await repo.pathForClass(section.classId);
      return parent === null ? null : { ...parent, sectionId: section.id };
    },
  };
  return repo;
}

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MigrationError,
  discoverMigrations,
  planUp,
  type MigrationPair,
} from "./migrator";

async function tempMigrationsDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "vidya-migrations-"));
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(path.join(dir, name), contents, "utf8");
  }
  return dir;
}

describe("discoverMigrations", () => {
  it("returns ordered up/down pairs", async () => {
    const dir = await tempMigrationsDir({
      "0001_second.sql": "select 2;",
      "0001_second.down.sql": "select -2;",
      "0000_first.sql": "select 1;",
      "0000_first.down.sql": "select -1;",
    });
    const pairs = await discoverMigrations({ module: "demo", dir });
    expect(pairs.map((pair) => pair.name)).toEqual(["0000_first", "0001_second"]);
    expect(pairs[0]?.upPath.endsWith("0000_first.sql")).toBe(true);
    expect(pairs[0]?.downPath.endsWith("0000_first.down.sql")).toBe(true);
  });

  it("rejects an up migration without a paired rollback file", async () => {
    const dir = await tempMigrationsDir({ "0000_first.sql": "select 1;" });
    await expect(discoverMigrations({ module: "demo", dir })).rejects.toThrow(
      /no paired rollback file/,
    );
  });

  it("rejects an orphan rollback file", async () => {
    const dir = await tempMigrationsDir({ "0000_first.down.sql": "select -1;" });
    await expect(discoverMigrations({ module: "demo", dir })).rejects.toThrow(/orphan rollback/);
  });

  it("rejects names outside the NNNN_snake_case convention", async () => {
    const dir = await tempMigrationsDir({
      "1_bad.sql": "select 1;",
      "1_bad.down.sql": "select -1;",
    });
    await expect(discoverMigrations({ module: "demo", dir })).rejects.toThrow(
      /does not match/,
    );
  });
});

function pair(module: string, name: string): MigrationPair {
  return { module, name, upPath: `/${module}/${name}.sql`, downPath: `/${module}/${name}.down.sql` };
}

describe("planUp", () => {
  it("returns only unapplied migrations, in order", () => {
    const discovered = [pair("system", "0000_a"), pair("system", "0001_b"), pair("other", "0000_x")];
    const pending = planUp(discovered, [{ module: "system", name: "0000_a" }]);
    expect(pending.map((entry) => `${entry.module}/${entry.name}`)).toEqual([
      "system/0001_b",
      "other/0000_x",
    ]);
  });

  it("returns an empty plan when everything is applied", () => {
    const discovered = [pair("system", "0000_a")];
    expect(planUp(discovered, [{ module: "system", name: "0000_a" }])).toEqual([]);
  });

  it("fails on journal drift (applied migration missing from disk)", () => {
    expect(() => planUp([], [{ module: "system", name: "0000_gone" }])).toThrow(MigrationError);
  });

  it("fails on ordering drift (gap before an applied migration)", () => {
    const discovered = [pair("system", "0000_a"), pair("system", "0001_b")];
    expect(() => planUp(discovered, [{ module: "system", name: "0001_b" }])).toThrow(
      /ordering drift/,
    );
  });
});

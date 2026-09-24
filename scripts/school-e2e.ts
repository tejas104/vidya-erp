import { execFile, spawn } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const project = "vidya-school-e2e";
const databaseName = "vidya_school_e2e";
const webPort = 3115;
const envFile = resolve(root, "scripts/school-e2e.env");
const overrideFile = resolve(root, "docker-compose.school-e2e.yml");
const composeBase = ["compose", "-p", project, "-f", "docker-compose.yml", "-f", overrideFile, "--env-file", envFile];
const volumes = [`${project}_school-e2e-pg-data`, `${project}_school-e2e-minio-data`];

const testEnv: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: "production",
  LOG_LEVEL: "warn",
  DATABASE_URL: `postgres://vidya:school-e2e-pg-only@127.0.0.1:55435/${databaseName}`,
  REDIS_URL: "redis://:school-e2e-redis-only@127.0.0.1:6385",
  S3_ENDPOINT: "http://127.0.0.1:9010",
  S3_REGION: "us-east-1",
  S3_ACCESS_KEY_ID: "school-e2e-minio",
  S3_SECRET_ACCESS_KEY: "school-e2e-minio-secret",
  S3_BUCKET: "vidya-school-e2e",
  S3_FORCE_PATH_STYLE: "true",
  SESSION_COOKIE_SECURE: "false",
  VIDYA_EDITION: "school",
  INTEGRATION_DB_NAME: databaseName,
  SCHOOL_E2E_TEST_RUN: "true",
  E2E_COMPOSE_PROJECT: project,
  E2E_COMPOSE_OVERRIDE_FILE: overrideFile,
  E2E_COMPOSE_ENV_FILE: envFile,
  PLAYWRIGHT_PORT: String(webPort),
  PLAYWRIGHT_WEB_COMMAND: `pnpm --filter @vidya/web exec next start -p ${webPort}`,
};

function executable(name: string): string {
  return name;
}

function commandInvocation(commandName: string, args: string[]): { file: string; args: string[] } {
  if (process.platform === "win32" && commandName === "pnpm") {
    return {
      file: process.execPath,
      args: [resolve(dirname(process.execPath), "node_modules/corepack/dist/pnpm.js"), ...args],
    };
  }
  return { file: executable(commandName), args };
}

async function command(commandName: string, args: string[], env = process.env): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const invocation = commandInvocation(commandName, args);
    const child = spawn(invocation.file, invocation.args, {
      cwd: root,
      env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${commandName} ${args.join(" ")} failed (${signal ?? code ?? "unknown"})`));
    });
  });
}

async function output(commandName: string, args: string[]): Promise<string> {
  const result = await execFileAsync(executable(commandName), args, { cwd: root, windowsHide: true });
  return result.stdout.trim();
}

async function compose(args: string[], env = process.env): Promise<void> {
  await command("docker", [...composeBase, ...args], env);
}

async function composeOutput(args: string[]): Promise<string> {
  return output("docker", [...composeBase, ...args]);
}

async function waitForHealth(service: string): Promise<void> {
  const containerId = await composeOutput(["ps", "-q", service]);
  if (containerId === "") throw new Error(`${service} did not create a container in ${project}`);
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const health = await output("docker", ["inspect", "--format", "{{.State.Health.Status}}", containerId]);
    if (health === "healthy") return;
    if (health === "unhealthy") throw new Error(`${service} became unhealthy in ${project}`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
  }
  throw new Error(`${service} did not become healthy within 90 seconds`);
}

async function assertOwnedResources(): Promise<void> {
  const ids = (await output("docker", ["ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`]))
    .split(/\r?\n/)
    .filter(Boolean);
  for (const id of ids) {
    const label = await output("docker", ["inspect", "--format", "{{ index .Config.Labels \"com.vidya.school-e2e\" }}", id]);
    if (label !== "true") throw new Error(`refusing cleanup: container ${id} is not labelled as a school E2E resource`);
  }
  for (const volume of volumes) {
    const exists = await output("docker", ["volume", "ls", "-q", "--filter", `name=^${volume}$`]);
    if (exists === "") continue;
    const label = await output("docker", ["volume", "inspect", "--format", "{{ index .Labels \"com.vidya.school-e2e\" }}", volume]);
    if (label !== "true") throw new Error(`refusing cleanup: volume ${volume} is not labelled as a school E2E resource`);
  }
  if (ids.length > 0) {
    const activeDatabase = await composeOutput(["exec", "-T", "postgres", "psql", "-U", "vidya", "-d", databaseName, "-tAc", "SELECT current_database()"]);
    if (activeDatabase !== databaseName) throw new Error("refusing cleanup: Postgres did not select the school E2E database");
  }
}

async function cleanup(): Promise<void> {
  await assertOwnedResources();
  await compose(["down", "--volumes", "--remove-orphans"]);
  const remaining = (await output("docker", ["ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`])).trim();
  if (remaining !== "") throw new Error(`cleanup left school E2E containers: ${remaining}`);
  for (const volume of volumes) {
    const exists = await output("docker", ["volume", "ls", "-q", "--filter", `name=^${volume}$`]);
    if (exists !== "") throw new Error(`cleanup left school E2E volume: ${volume}`);
  }
  console.log("school E2E cleanup complete (only labelled test resources were removed)");
}

async function run(): Promise<void> {
  await access(envFile);
  await stat(overrideFile);
  try {
    await compose(["up", "-d", "postgres", "redis", "minio"]);
    await Promise.all([waitForHealth("postgres"), waitForHealth("redis"), waitForHealth("minio")]);
    await command("pnpm", ["db:migrate"], testEnv);
    await command("pnpm", ["exec", "tsx", "scripts/seed-school-e2e.ts"], testEnv);
    await command("pnpm", ["compile:help"], testEnv);
    await command("pnpm", ["--filter", "@vidya/web", "build"], testEnv);
    await command("pnpm", ["exec", "playwright", "test", "tests/e2e/school/terms.spec.ts", "tests/e2e/school/marks.spec.ts", "tests/e2e/school/report-cards.spec.ts", "tests/e2e/school/guardian.spec.ts", "tests/e2e/school/student-360.spec.ts", "tests/e2e/school/workbench-table.spec.ts", "--workers=1"], testEnv);
  } finally {
    await cleanup();
  }
}

const action = process.argv[2] ?? "run";
if (action === "run") {
  run().catch((error: unknown) => {
    console.error("school E2E run failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
} else if (action === "cleanup") {
  cleanup().catch((error: unknown) => {
    console.error("school E2E cleanup failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
} else {
  console.error("usage: tsx scripts/school-e2e.ts <run|cleanup>");
  process.exit(2);
}

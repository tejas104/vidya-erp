import { buildStack } from "../tests/integration/support/harness";

const DATABASE_NAME = "vidya_school_e2e";

function assertTestTarget(): void {
  if (process.env.SCHOOL_E2E_TEST_RUN !== "true") {
    throw new Error("refusing to seed without SCHOOL_E2E_TEST_RUN=true");
  }
  if (process.env.INTEGRATION_DB_NAME !== DATABASE_NAME) {
    throw new Error(`refusing to seed INTEGRATION_DB_NAME=${process.env.INTEGRATION_DB_NAME ?? "(unset)"}`);
  }
  const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
  if (databaseUrl.pathname !== `/${DATABASE_NAME}`) {
    throw new Error(`refusing to seed database ${databaseUrl.pathname || "(unset)"}`);
  }
}

async function main(): Promise<void> {
  assertTestTarget();
  const stack = buildStack("school");
  try {
    const currentDatabase = await stack.pool.query<{ current_database: string }>("SELECT current_database()");
    if (currentDatabase.rows[0]?.current_database !== DATABASE_NAME) {
      throw new Error("connected database did not match the school E2E target");
    }
    const { collegeId } = await stack.bootstrap();
    console.log(`seeded school E2E bootstrap administrator in ${DATABASE_NAME} for college ${collegeId}`);
  } finally {
    await stack.close();
  }
}

main().catch((error: unknown) => {
  console.error("school E2E seed failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});

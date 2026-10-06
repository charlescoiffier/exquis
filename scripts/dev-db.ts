// Postgres local embarqué pour le dev et les tests (voir package.json: db:dev).
import EmbeddedPostgres from "embedded-postgres";
import postgres from "postgres";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const PORT = 5432;
const USER = "exquis";
const PASSWORD = "exquis";
const DATABASES = ["exquis", "exquis_test"];
const dataDir = resolve(process.cwd(), ".pgdata");

async function alreadyServed(): Promise<boolean> {
  const sql = postgres(`postgres://${USER}:${PASSWORD}@localhost:${PORT}/postgres`, {
    max: 1,
    connect_timeout: 2,
  });
  try {
    await sql`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

async function main() {
  if (await alreadyServed()) {
    console.log(`dev-db: a Postgres is already reachable on :${PORT}, nothing to do`);
    process.exit(0);
  }

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: true,
  });

  if (!existsSync(resolve(dataDir, "PG_VERSION"))) {
    await pg.initialise();
  }
  await pg.start();

  for (const name of DATABASES) {
    try {
      await pg.createDatabase(name);
    } catch (e) {
      if (!/already exists/i.test(String(e instanceof Error ? e.message : e))) throw e;
    }
  }

  console.log(`dev-db ready on :${PORT}`);

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await pg.stop();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  setInterval(() => {}, 1 << 30);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

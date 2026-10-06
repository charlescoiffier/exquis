import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL manquant");
  const { db, close } = createDb(url);
  try {
    await migrate(db, { migrationsFolder: "drizzle" });
  } finally {
    await close();
  }
  console.log("migrations appliquées");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

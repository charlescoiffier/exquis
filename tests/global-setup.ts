import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "@/lib/db/client";
import { TEST_DB_URL } from "./config";

export default async function setup() {
  const { db, close } = createDb(TEST_DB_URL);
  await migrate(db, { migrationsFolder: "drizzle" });
  await close();
}

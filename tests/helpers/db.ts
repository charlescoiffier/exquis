import { sql } from "drizzle-orm";
import { createDb, type Db } from "@/lib/db/client";
import { user } from "@/lib/db/auth-schema";
import { TEST_DB_URL } from "../config";

let cached: Db | undefined;
export function testDb(): Db {
  return (cached ??= createDb(TEST_DB_URL).db);
}

export async function resetDb(db: Db): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE "user", "game", "invitation" CASCADE`);
}

export async function makeUser(db: Db, name: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(user).values({ id, name, email: `${name}-${id}@test.dev`, emailVerified: true });
  return id;
}

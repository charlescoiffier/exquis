import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as appSchema from "./schema";
import * as authSchema from "./auth-schema";
import { env } from "@/lib/env";

export const fullSchema = { ...appSchema, ...authSchema };
export type Db = PostgresJsDatabase<typeof fullSchema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Executor = Db | Tx;

export function createDb(url: string): { db: Db; close: () => Promise<void> } {
  const client = postgres(url, { max: 10 });
  return { db: drizzle(client, { schema: fullSchema }), close: () => client.end() };
}

const globalForDb = globalThis as unknown as { __db?: Db };
export function getDb(): Db {
  return (globalForDb.__db ??= createDb(env().DATABASE_URL).db);
}

import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL manquant");
const { db, close } = createDb(url);
await migrate(db, { migrationsFolder: "drizzle" });
await close();
console.log("migrations appliquées");

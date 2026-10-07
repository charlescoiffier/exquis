/** Donne ou retire le rôle de modérateur : `npm run role -- adresse@exemple.fr moderator` (ou `player`). */
import { eq } from "drizzle-orm";
import { createDb } from "../src/lib/db/client";
import { user } from "../src/lib/db/auth-schema";
import { setRole } from "../src/lib/services/moderation";

async function main() {
  const [email, role] = process.argv.slice(2);
  if (!email || (role !== "moderator" && role !== "player")) {
    console.error("Usage : npm run role -- <email> <moderator|player>");
    process.exit(1);
  }
  const { db, close } = createDb(process.env.DATABASE_URL ?? "postgres://exquis:exquis@localhost:5432/exquis");
  const [u] = await db.select({ id: user.id }).from(user).where(eq(user.email, email.toLowerCase()));
  if (!u) {
    console.error(`Aucun compte avec l'adresse ${email}.`);
    await close();
    process.exit(1);
  }
  await setRole(db, u.id, role);
  console.log(`${email} : rôle « ${role} ».`);
  await close();
}

main();

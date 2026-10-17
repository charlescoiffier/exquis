/**
 * Valide les adresses email de comptes existants (sans leur envoyer de message) : utile quand la vérification d'adresse vient
 * d'être activée et que des personnes déjà inscrites ne peuvent plus se connecter.
 *   npm run verify-users                     # tous les comptes non vérifiés
 *   npm run verify-users -- a@x.fr b@y.fr    # seulement ces adresses
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { createDb } from "../src/lib/db/client";
import { user } from "../src/lib/db/auth-schema";

async function main() {
  const emails = process.argv.slice(2).map((e) => e.toLowerCase());
  const { db, close } = createDb(process.env.DATABASE_URL ?? "postgres://exquis:exquis@localhost:5432/exquis");
  const where = emails.length
    ? and(eq(user.emailVerified, false), inArray(sql`lower(${user.email})`, emails))
    : and(eq(user.emailVerified, false), sql`${user.email} not like '%@exquis.invalid'`);
  const rows = await db.update(user).set({ emailVerified: true, updatedAt: new Date() }).where(where).returning({ email: user.email });
  console.log(rows.length ? `Adresses validées (${rows.length}) :\n${rows.map((r) => ` - ${r.email}`).join("\n")}` : "Aucune adresse à valider.");
  await close();
}

main();

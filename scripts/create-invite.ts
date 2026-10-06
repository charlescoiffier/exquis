import { createDb } from "../src/lib/db/client";
import { createInvitation } from "../src/lib/services/invitations";

const url = process.env.DATABASE_URL ?? "postgres://exquis:exquis@localhost:5432/exquis";
const { db, close } = createDb(url);
console.log(await createInvitation(db, null));
await close();

import { createDb } from "../src/lib/db/client";
import { createInvitation } from "../src/lib/services/invitations";

async function main() {
  const url = process.env.DATABASE_URL ?? "postgres://exquis:exquis@localhost:5432/exquis";
  const { db, close } = createDb(url);
  try {
    console.log(await createInvitation(db, null));
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

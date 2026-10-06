import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WORKER_FRESHNESS_MS = 5 * 60_000;

export async function GET() {
  const db = getDb();
  try {
    await db.execute(sql`select 1`);
  } catch (e) {
    console.error("[health] base injoignable", e);
    return Response.json({ db: false, worker: false }, { status: 503 });
  }

  // Vivacité du worker : dernier balayage `turn-sweep` terminé. Si le schéma pgboss n'existe pas encore
  // (worker jamais démarré), on considère simplement le worker comme absent.
  let last: Date | null = null;
  try {
    const rows = await db.execute(
      sql`select max(completed_on) as last from pgboss.job where name = 'turn-sweep' and state = 'completed'`,
    );
    last = (rows as unknown as { last: Date | null }[])[0]?.last ?? null;
  } catch {
    last = null;
  }
  const workerOk = last !== null && Date.now() - new Date(last).getTime() < WORKER_FRESHNESS_MS;
  return Response.json({ db: true, worker: workerOk, lastSweep: last }, { status: workerOk ? 200 : 503 });
}

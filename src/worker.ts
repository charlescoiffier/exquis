import PgBoss from "pg-boss";
import { getDb } from "@/lib/db/client";
import { env } from "@/lib/env";
import type { Effect } from "@/lib/effects";
import { handleExpire, handleFinalize, handleFlush, handleRemind, handleSweep, type Deps } from "@/lib/jobs/handlers";
import { QUEUES, createQueues, runEffectsWithRetry } from "@/lib/jobs/queue";
import { getMailer } from "@/lib/notifications/mailer";
import { getStorage } from "@/lib/storage";

async function main() {
  const boss = new PgBoss({ connectionString: env().DATABASE_URL });
  boss.on("error", (e) => console.error("[pg-boss]", e));
  await boss.start();
  await createQueues(boss);

  const deps: Deps = { db: getDb(), storage: getStorage(), mailer: getMailer() };
  const wrap =
    <T>(fn: (d: Deps, data: T) => Promise<Effect[] | void>) =>
    async (jobs: { data: T }[]) => {
      for (const job of jobs) {
        const effects = await fn(deps, job.data);
        // Le handler a déjà commité : relancer le job ne retrouverait pas les effets (le tour a avancé).
        // On réessaie donc l'envoi ici, sans relancer le job en cas d'échec final. Filet de sécurité :
        // le balayage (turn-expire) et le cron de flush récupèrent expirations et emails ; les rappels sont best-effort.
        if (effects?.length) await runEffectsWithRetry(boss, effects);
      }
    };

  await boss.work(QUEUES.expire, wrap(handleExpire));
  await boss.work(QUEUES.remind, wrap(handleRemind));
  await boss.work(QUEUES.finalize, wrap(handleFinalize));
  await boss.work(QUEUES.flush, wrap(async (d: Deps) => handleFlush(d)));
  await boss.work(QUEUES.sweep, wrap(async (d: Deps) => handleSweep(d)));
  await boss.schedule(QUEUES.sweep, "* * * * *");
  await boss.schedule(QUEUES.flush, "* * * * *");

  const shutdown = () => {
    boss.stop().finally(() => process.exit(0));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);

  console.log("worker démarré");
}

main().catch((err) => {
  console.error("[worker] échec fatal", err);
  process.exit(1);
});

import PgBoss from "pg-boss";
import { SUBMIT_GRACE_MS } from "@/lib/access";
import type { Effect } from "@/lib/effects";
import { env } from "@/lib/env";

export const QUEUES = {
  expire: "turn-expire",
  remind: "turn-remind",
  finalize: "game-finalize",
  flush: "notifications-flush",
  sweep: "turn-sweep",
  purge: "game-purge",
} as const;

export const MIN_REMINDER_DURATION = 120;

/** Moments de rappel proposés, en pourcentage du temps du tour restant à ce moment-là ; 0 = aucun rappel. */
export const REMINDER_STAGES = [50, 25, 10] as const;
export const DEFAULT_REMINDER_STAGE = 25;

export function reminderTime(deadline: Date, durationSeconds: number, stage: number = DEFAULT_REMINDER_STAGE): Date | null {
  if (durationSeconds < MIN_REMINDER_DURATION) return null;
  return new Date(deadline.getTime() - (stage / 100) * durationSeconds * 1000);
}

export async function createQueues(boss: PgBoss) {
  for (const name of Object.values(QUEUES)) await boss.createQueue(name);
}

type BossLike = Pick<PgBoss, "start" | "stop" | "on" | "createQueue">;
export type BossSlot = { promise?: Promise<PgBoss> };

/** Démarre (une seule fois) une instance ; en cas d'échec, le cache est vidé pour permettre un nouvel essai. */
export function getBossWith(slot: BossSlot, factory: () => PgBoss): Promise<PgBoss> {
  return (slot.promise ??= (async () => {
    const boss = factory();
    try {
      boss.on("error", (e) => console.error("[pg-boss]", e));
      await boss.start();
      await createQueues(boss);
      return boss;
    } catch (err) {
      slot.promise = undefined;
      await (boss as BossLike).stop().catch(() => {});
      throw err;
    }
  })());
}

const g = globalThis as unknown as { __bossSlot?: BossSlot };

/** Instance d'envoi (web) : ne traite pas les jobs et ne fait pas de maintenance. */
export function getBoss(): Promise<PgBoss> {
  return getBossWith((g.__bossSlot ??= {}), () => new PgBoss({ connectionString: env().DATABASE_URL, supervise: false, schedule: false }));
}

export async function runEffectsWithRetry(
  boss: PgBoss,
  effects: Effect[],
  opts: { attempts?: number; delaysMs?: number[]; logger?: (msg: string, ...args: unknown[]) => void } = {},
): Promise<void> {
  const attempts = opts.attempts ?? 3;
  const delays = opts.delaysMs ?? [200, 800];
  const log = opts.logger ?? console.error;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await runEffects(boss, effects);
      return;
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delays[i] ?? delays[delays.length - 1] ?? 0));
    }
  }
  log("[jobs] effets non envoyés après plusieurs essais", lastErr, JSON.stringify(effects));
}

export async function runEffects(boss: PgBoss, effects: Effect[]): Promise<void> {
  for (const e of effects) {
    if (e.kind === "schedule-turn") {
      const data = { turnId: e.turnId, deadline: e.deadline.toISOString() };
      await boss.send(QUEUES.expire, data, { startAfter: new Date(e.deadline.getTime() + SUBMIT_GRACE_MS) });
      // Un rappel programmé par étape : celui qui correspond à la préférence du joueur est seul envoyé (voir handleRemind).
      for (const stage of REMINDER_STAGES) {
        const remindAt = reminderTime(e.deadline, e.durationSeconds, stage);
        if (remindAt && remindAt.getTime() > Date.now()) await boss.send(QUEUES.remind, { ...data, stage }, { startAfter: remindAt });
      }
    } else if (e.kind === "finalize-game") {
      await boss.send(QUEUES.finalize, { gameId: e.gameId });
    } else {
      await boss.send(QUEUES.flush, {}, { singletonKey: "flush", singletonSeconds: 5 });
    }
  }
}

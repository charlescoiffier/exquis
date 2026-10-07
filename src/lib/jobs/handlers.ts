import { eq } from "drizzle-orm";
import { canActOnTurn } from "@/lib/access";
import type { Db } from "@/lib/db/client";
import { profile, turn } from "@/lib/db/schema";
import type { Effect } from "@/lib/effects";
import { DEFAULT_REMINDER_STAGE } from "@/lib/jobs/queue";
import type { Mailer } from "@/lib/notifications/mailer";
import { flushNotifications } from "@/lib/services/email-outbox";
import { purgeStaleGames } from "@/lib/services/games";
import { assembleFinalWork } from "@/lib/services/final-work";
import { queueNotification } from "@/lib/services/notifications";
import { expireOverdue, expireTurn } from "@/lib/services/turns";
import type { Storage } from "@/lib/storage";

export type Deps = { db: Db; storage: Storage; mailer: Mailer; now?: () => Date };
const nowOf = (d: Deps) => (d.now ? d.now() : new Date());

export async function handleExpire(deps: Deps, data: { turnId: string; deadline: string }): Promise<Effect[]> {
  return expireTurn(deps.db, { turnId: data.turnId, deadline: new Date(data.deadline), now: nowOf(deps) });
}

/**
 * Rappel avant la fin d'un tour. Chaque étape (50, 25, 10 % du temps restant) est programmée au début du tour ; seule celle
 * qui correspond à la préférence du joueur envoie une notification (0 : aucun rappel). Sans étape (ancien job) : 25 %.
 */
export async function handleRemind(deps: Deps, data: { turnId: string; deadline: string; stage?: number }): Promise<Effect[]> {
  const now = nowOf(deps);
  const [t] = await deps.db.select().from(turn).where(eq(turn.id, data.turnId));
  if (!t || t.status !== "active" || !t.assignedUserId || t.deadline?.getTime() !== new Date(data.deadline).getTime()) return [];
  const userId = t.assignedUserId;
  if (!canActOnTurn(t, userId, now)) return [];
  const [pref] = await deps.db.select({ stage: profile.reminderStage }).from(profile).where(eq(profile.userId, userId));
  if ((pref?.stage ?? DEFAULT_REMINDER_STAGE) !== (data.stage ?? DEFAULT_REMINDER_STAGE)) return [];
  await deps.db.transaction((tx) =>
    queueNotification(tx, { userId, type: "turn_reminder", gameId: t.gameId, turnId: t.id, suffix: String(t.attempts) }),
  );
  return [{ kind: "flush-notifications" }];
}

export async function handleFinalize(deps: Deps, data: { gameId: string }): Promise<Effect[]> {
  await assembleFinalWork(deps.db, deps.storage, data.gameId);
  return [{ kind: "flush-notifications" }];
}

export async function handleSweep(deps: Deps): Promise<Effect[]> {
  return expireOverdue(deps.db, nowOf(deps));
}

/** Supprime les parties jamais lancées depuis plus d'une semaine. */
export async function handlePurge(deps: Deps): Promise<void> {
  const n = await purgeStaleGames(deps.db, nowOf(deps));
  if (n > 0) console.log(`[purge] ${n} partie(s) en attente supprimée(s)`);
}

export async function handleFlush(deps: Deps): Promise<void> {
  await flushNotifications(deps.db, deps.mailer, nowOf(deps));
}

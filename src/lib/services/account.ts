import { count, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { user } from "@/lib/db/auth-schema";
import { comment, contribution, game, participant, profile, turn } from "@/lib/db/schema";
import { isValidAvatar, resolveAvatar, type AvatarSpec } from "@/lib/avatar";
import { DomainError } from "@/lib/errors";
import { DEFAULT_REMINDER_STAGE, REMINDER_STAGES } from "@/lib/jobs/queue";

export const MAX_NAME_LENGTH = 60;

/** Étapes de rappel acceptées : 0 (aucun) ou une étape programmée par le worker. */
export const REMINDER_CHOICES: readonly number[] = [0, ...REMINDER_STAGES];

/** Canaux de notification choisis : email, téléphone (push), les deux ou aucun. */
export type NotifyMode = "both" | "email" | "push" | "none";
export const NOTIFY_MODES: readonly NotifyMode[] = ["both", "email", "push", "none"];
export const notifyModeOf = (emailEnabled: boolean, notifyPush: boolean): NotifyMode =>
  emailEnabled && notifyPush ? "both" : emailEnabled ? "email" : notifyPush ? "push" : "none";

export type ProfilePatch = { name?: string; emailEnabled?: boolean; notifyMode?: NotifyMode; reminderStage?: number; avatar?: { shape: string; color: string; bg: string } };

/** Modifie le nom affiché, la préférence d'email, le moment du rappel et/ou l'avatar d'un compte. Au moins un champ est requis. */
export async function updateProfile(db: Db, userId: string, patch: ProfilePatch): Promise<void> {
  const name = patch.name?.trim();
  if (patch.name !== undefined && (!name || name.length > MAX_NAME_LENGTH)) {
    throw new DomainError("invalid_name", `Le nom doit faire entre 1 et ${MAX_NAME_LENGTH} caractères.`, 400);
  }
  if (patch.notifyMode !== undefined && !NOTIFY_MODES.includes(patch.notifyMode)) {
    throw new DomainError("invalid_notify_mode", "Type de notification inconnu.", 400);
  }
  if (patch.reminderStage !== undefined && !REMINDER_CHOICES.includes(patch.reminderStage)) {
    throw new DomainError("invalid_reminder", "Moment de rappel inconnu.", 400);
  }
  if (patch.avatar !== undefined && !isValidAvatar(patch.avatar)) {
    throw new DomainError("invalid_avatar", "Avatar invalide : forme et fond doivent être différents et pris dans la palette.", 400);
  }
  if (name === undefined && patch.emailEnabled === undefined && patch.notifyMode === undefined && patch.reminderStage === undefined && patch.avatar === undefined) {
    throw new DomainError("invalid_params", "Rien à modifier.", 400);
  }
  const set = {
    ...(patch.emailEnabled !== undefined ? { emailEnabled: patch.emailEnabled } : {}),
    ...(patch.notifyMode !== undefined ? { emailEnabled: patch.notifyMode === "both" || patch.notifyMode === "email", notifyPush: patch.notifyMode === "both" || patch.notifyMode === "push" } : {}),
    ...(patch.reminderStage !== undefined ? { reminderStage: patch.reminderStage } : {}),
    ...(patch.avatar !== undefined ? { avatarShape: patch.avatar.shape, avatarColor: patch.avatar.color, avatarBg: patch.avatar.bg } : {}),
  };
  await db.transaction(async (tx) => {
    if (name !== undefined) await tx.update(user).set({ name, updatedAt: new Date() }).where(eq(user.id, userId));
    if (Object.keys(set).length > 0) {
      await tx.insert(profile).values({ userId, ...set }).onConflictDoUpdate({ target: profile.userId, set });
    }
  });
}

export type ProfileView = { emailEnabled: boolean; notifyMode: NotifyMode; reminderStage: number; avatar: AvatarSpec };

/** Préférences et avatar d'un compte (valeurs par défaut tant qu'il n'a rien choisi). */
export async function getProfile(db: Db, userId: string): Promise<ProfileView> {
  const [p] = await db.select().from(profile).where(eq(profile.userId, userId));
  return { emailEnabled: p?.emailEnabled ?? true, notifyMode: notifyModeOf(p?.emailEnabled ?? true, p?.notifyPush ?? true), reminderStage: p?.reminderStage ?? DEFAULT_REMINDER_STAGE, avatar: resolveAvatar(userId, p) };
}

export type ProfileStats = {
  /** Parties où le joueur a participé, toutes situations confondues. */
  gamesJoined: number;
  gamesCompleted: number;
  gamesInProgress: number;
  gamesCreated: number;
  /** Tours joués (contributions envoyées), dont dessins et textes. */
  turnsPlayed: number;
  drawings: number;
  texts: number;
  commentsWritten: number;
};

export async function getProfileStats(db: Db, userId: string): Promise<ProfileStats> {
  const joined = await db
    .select({ status: game.status, n: count() })
    .from(participant)
    .innerJoin(game, eq(game.id, participant.gameId))
    .where(eq(participant.userId, userId))
    .groupBy(game.status);
  const byStatus = (...s: string[]) => joined.filter((r) => s.includes(r.status)).reduce((a, r) => a + r.n, 0);
  const [{ n: created }] = await db.select({ n: count() }).from(game).where(eq(game.creatorId, userId));
  const played = await db
    .select({ type: game.type, n: count() })
    .from(contribution)
    .innerJoin(turn, eq(turn.id, contribution.turnId))
    .innerJoin(game, eq(game.id, turn.gameId))
    .where(eq(contribution.userId, userId))
    .groupBy(game.type);
  const drawings = played.find((r) => r.type === "drawing")?.n ?? 0;
  const texts = played.find((r) => r.type === "text")?.n ?? 0;
  const [{ n: comments }] = await db.select({ n: count() }).from(comment).where(eq(comment.userId, userId));
  return {
    gamesJoined: byStatus("open", "in_progress", "completed", "cancelled"),
    gamesCompleted: byStatus("completed"),
    gamesInProgress: byStatus("open", "in_progress"),
    gamesCreated: created,
    turnsPlayed: drawings + texts,
    drawings,
    texts,
    commentsWritten: comments,
  };
}

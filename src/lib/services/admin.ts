import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { resolveAvatar } from "@/lib/avatar";
import type { Db } from "@/lib/db/client";
import { account, session, user } from "@/lib/db/auth-schema";
import { comment, contribution, draft, finalWork, game, invitation, participant, profile, report, turn } from "@/lib/db/schema";
import { DomainError } from "@/lib/errors";
import type { Storage } from "@/lib/storage";
import { releaseSeat } from "./games";
import { isAdmin, requireAdmin } from "./moderation";

export const ADMIN_PAGE_SIZE = 20;

const windowOf = (total: number, requested: number) => {
  const pageCount = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  const page = Math.min(Math.max(1, requested), pageCount);
  return { page, pageCount, offset: (page - 1) * ADMIN_PAGE_SIZE };
};

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  role: string;
  gamesJoined: number;
};

/** Tous les inscrits, les plus récents d'abord ; `q` filtre sur le nom ou l'adresse. */
export async function listUsers(db: Db, p: { adminId: string; q?: string; page?: number }) {
  await requireAdmin(db, p.adminId);
  const q = p.q?.trim();
  const where = q ? or(ilike(user.name, `%${q}%`), ilike(user.email, `%${q}%`)) : undefined;
  const [{ n: total }] = await db.select({ n: count() }).from(user).where(where);
  const w = windowOf(total, p.page ?? 1);
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
      role: profile.role,
      gamesJoined: sql<number>`(select count(*)::int from participant pp where pp.user_id = ${user.id})`,
    })
    .from(user)
    .leftJoin(profile, eq(profile.userId, user.id))
    .where(where)
    .orderBy(desc(user.createdAt), asc(user.id))
    .limit(ADMIN_PAGE_SIZE)
    .offset(w.offset);
  const items: AdminUser[] = rows.map((r) => ({ ...r, role: r.role ?? "player" }));
  return { items, total, page: w.page, pageCount: w.pageCount };
}

/** Passe un compte en modérateur ou le ramène joueur (le rôle d'administrateur se donne par `npm run role` ou ADMIN_EMAILS). */
export async function setUserRole(db: Db, p: { adminId: string; userId: string; role: "player" | "moderator" }): Promise<void> {
  await requireAdmin(db, p.adminId);
  if (p.userId === p.adminId) throw new DomainError("self_role", "Vous ne pouvez pas modifier votre propre rôle.", 400);
  if (await isAdmin(db, p.userId)) throw new DomainError("target_admin", "Le rôle d'un administrateur ne se change pas ici.", 409);
  const [u] = await db.select({ id: user.id }).from(user).where(eq(user.id, p.userId));
  if (!u) throw new DomainError("not_found", "Compte introuvable.", 404);
  await db.insert(profile).values({ userId: p.userId, role: p.role }).onConflictDoUpdate({ target: profile.userId, set: { role: p.role } });
}

/**
 * Supprime un compte. Ses données personnelles (identifiants, sessions, amis, notifications, préférences) disparaissent ; les
 * œuvres auxquelles il a contribué restent, avec un auteur « Compte supprimé » (les contributions sont anonymisées, pas effacées).
 * Les parties en attente ou en cours sont libérées de sa place avant l'anonymisation.
 */
export async function deleteUser(db: Db, p: { adminId: string; userId: string; now?: Date }): Promise<void> {
  await requireAdmin(db, p.adminId);
  if (p.userId === p.adminId) throw new DomainError("self_delete", "Vous ne pouvez pas supprimer votre propre compte ici.", 400);
  if (await isAdmin(db, p.userId)) throw new DomainError("target_admin", "Un administrateur ne se supprime pas ici : retirez d'abord son rôle.", 409);
  const now = p.now ?? new Date();
  await db.transaction(async (tx) => {
    const [target] = await tx.select({ id: user.id }).from(user).where(eq(user.id, p.userId));
    if (!target) throw new DomainError("not_found", "Compte introuvable.", 404);
    // Libère les places dans les parties non terminées.
    const open = await tx
      .select({ g: game })
      .from(participant)
      .innerJoin(game, eq(game.id, participant.gameId))
      .where(and(eq(participant.userId, p.userId), inArray(game.status, ["open", "in_progress"])));
    for (const { g } of open) await releaseSeat(tx, g, p.userId, now);
    // Parties en attente créées par ce compte et désormais vides : supprimées.
    // (libérer la dernière place d'une partie en attente l'annule : on la supprime, elle n'a jamais commencé.)
    await tx.delete(game).where(and(eq(game.creatorId, p.userId), sql`${game.startedAt} is null`, sql`not exists (select 1 from participant pp where pp.game_id = ${game.id})`));
    // Anonymisation : un compte « Compte supprimé » propre à cette suppression reprend tout ce qui référence le compte.
    const ghost = `deleted-${randomUUID()}`;
    await tx.insert(user).values({ id: ghost, name: "Compte supprimé", email: `${ghost}@exquis.invalid`, emailVerified: false, createdAt: now, updatedAt: now });
    await tx.delete(draft).where(eq(draft.userId, p.userId));
    await tx.update(participant).set({ userId: ghost }).where(eq(participant.userId, p.userId));
    await tx.update(contribution).set({ userId: ghost }).where(eq(contribution.userId, p.userId));
    await tx.update(comment).set({ userId: ghost }).where(eq(comment.userId, p.userId));
    await tx.update(game).set({ creatorId: ghost }).where(eq(game.creatorId, p.userId));
    await tx.update(turn).set({ assignedUserId: ghost }).where(eq(turn.assignedUserId, p.userId));
    await tx.update(report).set({ reporterId: ghost }).where(eq(report.reporterId, p.userId));
    await tx.update(report).set({ resolvedBy: ghost }).where(eq(report.resolvedBy, p.userId));
    await tx.update(invitation).set({ createdBy: null }).where(eq(invitation.createdBy, p.userId));
    await tx.update(invitation).set({ usedBy: null }).where(eq(invitation.usedBy, p.userId));
    await tx.delete(session).where(eq(session.userId, p.userId));
    await tx.delete(account).where(eq(account.userId, p.userId));
    await tx.delete(user).where(eq(user.id, p.userId));
  });
}

export type AdminWorkRow = { id: string; name: string; type: "drawing" | "text"; creatorName: string; completedAt: Date | null; comments: number; hidden: boolean };

/** Toutes les parties terminées, les plus récentes d'abord. */
export async function listCompletedWorks(db: Db, p: { adminId: string; page?: number }) {
  await requireAdmin(db, p.adminId);
  const where = eq(game.status, "completed");
  const [{ n: total }] = await db.select({ n: count() }).from(game).where(where);
  const w = windowOf(total, p.page ?? 1);
  const rows = await db
    .select({
      id: game.id,
      name: game.name,
      type: game.type,
      creatorName: user.name,
      completedAt: game.completedAt,
      hiddenAt: game.hiddenAt,
      comments: sql<number>`(select count(*)::int from comment c where c.game_id = ${game.id})`,
    })
    .from(game)
    .innerJoin(user, eq(user.id, game.creatorId))
    .where(where)
    .orderBy(desc(sql`coalesce(${game.completedAt}, ${game.createdAt})`))
    .limit(ADMIN_PAGE_SIZE)
    .offset(w.offset);
  const items: AdminWorkRow[] = rows.map(({ hiddenAt, ...r }) => ({ ...r, hidden: !!hiddenAt }));
  return { items, total, page: w.page, pageCount: w.pageCount };
}

export type AdminWork = {
  id: string;
  name: string;
  type: "drawing" | "text";
  theme: string | null;
  creatorName: string;
  completedAt: Date | null;
  hidden: boolean;
  ready: boolean;
  contributions: { rank: number; author: string; text: string | null }[];
  comments: { id: string; author: string; avatar: ReturnType<typeof resolveAvatar>; body: string; createdAt: Date; hidden: boolean }[];
};

/** Une œuvre terminée avec ses contributions et tous ses commentaires (même masqués). */
export async function getWorkForAdmin(db: Db, p: { adminId: string; gameId: string }): Promise<AdminWork> {
  await requireAdmin(db, p.adminId);
  const [g] = await db
    .select({ g: game, creatorName: user.name })
    .from(game)
    .innerJoin(user, eq(user.id, game.creatorId))
    .where(eq(game.id, p.gameId));
  if (!g) throw new DomainError("not_found", "Partie introuvable.", 404);
  const [fw] = await db.select({ imageKey: finalWork.imageKey }).from(finalWork).where(eq(finalWork.gameId, p.gameId));
  const contribs = await db
    .select({ rank: turn.rank, author: user.name, text: contribution.text })
    .from(contribution)
    .innerJoin(turn, eq(turn.id, contribution.turnId))
    .innerJoin(user, eq(user.id, contribution.userId))
    .where(eq(turn.gameId, p.gameId))
    .orderBy(asc(turn.rank));
  const comments = await db
    .select({
      id: comment.id, authorId: comment.userId, author: user.name, body: comment.body, createdAt: comment.createdAt, hiddenAt: comment.hiddenAt,
      avatarShape: profile.avatarShape, avatarColor: profile.avatarColor, avatarBg: profile.avatarBg,
    })
    .from(comment)
    .innerJoin(user, eq(user.id, comment.userId))
    .leftJoin(profile, eq(profile.userId, comment.userId))
    .where(eq(comment.gameId, p.gameId))
    .orderBy(asc(comment.createdAt), asc(comment.id));
  return {
    id: g.g.id,
    name: g.g.name,
    type: g.g.type,
    theme: g.g.theme,
    creatorName: g.creatorName,
    completedAt: g.g.completedAt,
    hidden: !!g.g.hiddenAt,
    ready: g.g.type === "text" || !!fw?.imageKey,
    contributions: contribs,
    comments: comments.map((c) => ({
      id: c.id, author: c.author, body: c.body, createdAt: c.createdAt, hidden: !!c.hiddenAt,
      avatar: resolveAvatar(c.authorId, { avatarShape: c.avatarShape, avatarColor: c.avatarColor, avatarBg: c.avatarBg }),
    })),
  };
}

/** Supprime définitivement un commentaire. */
export async function deleteCommentAsAdmin(db: Db, p: { adminId: string; commentId: string }): Promise<void> {
  await requireAdmin(db, p.adminId);
  const res = await db.delete(comment).where(eq(comment.id, p.commentId)).returning({ id: comment.id });
  if (res.length === 0) throw new DomainError("not_found", "Commentaire introuvable.", 404);
}

/** Supprime définitivement une œuvre terminée (ou annulée), avec ses contributions, commentaires et images stockées. */
export async function deleteWorkAsAdmin(db: Db, storage: Storage, p: { adminId: string; gameId: string }): Promise<void> {
  await requireAdmin(db, p.adminId);
  const [g] = await db.select({ id: game.id, status: game.status }).from(game).where(eq(game.id, p.gameId));
  if (!g) throw new DomainError("not_found", "Partie introuvable.", 404);
  if (g.status !== "completed" && g.status !== "cancelled") throw new DomainError("game_not_finished", "Seule une partie terminée ou annulée se supprime ici.", 409);
  const keys = [
    ...(await db
      .select({ a: contribution.imageKey, b: contribution.stripKey })
      .from(contribution)
      .innerJoin(turn, eq(turn.id, contribution.turnId))
      .where(eq(turn.gameId, p.gameId))
      .then((rows) => rows.flatMap((r) => [r.a, r.b]))),
    ...(await db.select({ k: finalWork.imageKey }).from(finalWork).where(eq(finalWork.gameId, p.gameId)).then((rows) => rows.map((r) => r.k))),
    `games/${p.gameId}/final/guides.png`,
  ].filter((k): k is string => !!k);
  await db.delete(game).where(eq(game.id, p.gameId));
  // Les fichiers sont supprimés après la base : un échec ici laisse seulement des objets orphelins, sans incidence pour les joueurs.
  for (const key of keys) await storage.delete(key).catch((e) => console.error("[admin] suppression du fichier impossible", key, e));
}

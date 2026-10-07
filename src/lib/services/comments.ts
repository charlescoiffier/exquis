import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { user } from "@/lib/db/auth-schema";
import { resolveAvatar, type AvatarSpec } from "@/lib/avatar";
import { comment, game, participant, profile } from "@/lib/db/schema";
import { DomainError } from "@/lib/errors";
import { queueNotification } from "./notifications";

export const MAX_COMMENT_LENGTH = 500;

export type CommentView = { id: string; authorId: string; author: string; avatar: AvatarSpec; body: string; createdAt: Date };

async function requireParticipant(db: Db, userId: string, gameId: string) {
  const [g] = await db.select().from(game).where(eq(game.id, gameId));
  if (!g) throw new DomainError("not_found", "Partie introuvable.", 404);
  const [me] = await db.select({ id: participant.id }).from(participant).where(and(eq(participant.gameId, gameId), eq(participant.userId, userId)));
  if (!me) throw new DomainError("forbidden", "Seuls les participants peuvent commenter.", 403);
  return g;
}

/** Commentaires d'une œuvre, du plus ancien au plus récent. Réservés aux participants de la partie. */
export async function listComments(db: Db, p: { userId: string; gameId: string }): Promise<CommentView[]> {
  await requireParticipant(db, p.userId, p.gameId);
  const rows = await db
    .select({
      id: comment.id, authorId: comment.userId, author: user.name, body: comment.body, createdAt: comment.createdAt,
      avatarShape: profile.avatarShape, avatarColor: profile.avatarColor, avatarBg: profile.avatarBg,
    })
    .from(comment)
    .innerJoin(user, eq(user.id, comment.userId))
    .leftJoin(profile, eq(profile.userId, comment.userId))
    .where(and(eq(comment.gameId, p.gameId), isNull(comment.hiddenAt)))
    .orderBy(asc(comment.createdAt), asc(comment.id));
  return rows.map(({ avatarShape, avatarColor, avatarBg, ...c }) => ({ ...c, avatar: resolveAvatar(c.authorId, { avatarShape, avatarColor, avatarBg }) }));
}

/** Ajoute un commentaire sous une œuvre terminée ; les autres participants sont prévenus dans l'application. */
export async function addComment(db: Db, p: { userId: string; gameId: string; body: string; now?: Date }): Promise<{ id: string }> {
  const body = p.body.trim();
  if (!body) throw new DomainError("empty_comment", "Le commentaire est vide.", 400);
  if (body.length > MAX_COMMENT_LENGTH) throw new DomainError("comment_too_long", `Un commentaire fait ${MAX_COMMENT_LENGTH} caractères au plus.`, 400);
  const g = await requireParticipant(db, p.userId, p.gameId);
  if (g.status !== "completed" || g.hiddenAt) throw new DomainError("game_not_completed", "On ne commente que les œuvres terminées.", 409);
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(comment).values({ gameId: g.id, userId: p.userId, body, createdAt: p.now ?? new Date() }).returning({ id: comment.id });
    const others = await tx.select({ userId: participant.userId }).from(participant).where(eq(participant.gameId, g.id));
    for (const o of others) {
      if (o.userId !== p.userId) await queueNotification(tx, { userId: o.userId, type: "comment_added", gameId: g.id, suffix: row.id, inAppOnly: true });
    }
    return row;
  });
}

/** Supprime un commentaire : son auteur seulement. */
export async function deleteComment(db: Db, p: { userId: string; gameId: string; commentId: string }): Promise<void> {
  const res = await db
    .delete(comment)
    .where(and(eq(comment.id, p.commentId), eq(comment.gameId, p.gameId), eq(comment.userId, p.userId)))
    .returning({ id: comment.id });
  if (res.length === 0) throw new DomainError("not_found", "Commentaire introuvable.", 404);
}

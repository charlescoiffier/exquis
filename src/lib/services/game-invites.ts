import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { user } from "@/lib/db/auth-schema";
import { game, gameInvitation, participant } from "@/lib/db/schema";
import { DomainError } from "@/lib/errors";
import { listFriends, type Person } from "./friends";
import { queueNotification } from "./notifications";

export const MAX_INVITES_PER_REQUEST = 8;

/** Vrai si ce joueur a reçu une invitation ciblée à cette partie (accès même si elle est sur invitation). */
export async function hasGameInvitation(db: Db, userId: string, gameId: string): Promise<boolean> {
  const [row] = await db.select({ id: gameInvitation.id }).from(gameInvitation).where(and(eq(gameInvitation.gameId, gameId), eq(gameInvitation.userId, userId)));
  return !!row;
}

/** Amis que l'on peut encore inviter à cette partie (ni inscrits, ni déjà invités). */
export async function listInvitableFriends(db: Db, p: { userId: string; gameId: string }): Promise<Person[]> {
  const [mine] = await db.select({ id: participant.id }).from(participant).where(and(eq(participant.gameId, p.gameId), eq(participant.userId, p.userId)));
  if (!mine) return [];
  const [taken, invited] = await Promise.all([
    db.select({ id: participant.userId }).from(participant).where(eq(participant.gameId, p.gameId)),
    db.select({ id: gameInvitation.userId }).from(gameInvitation).where(eq(gameInvitation.gameId, p.gameId)),
  ]);
  const skip = new Set([...taken, ...invited].map((r) => r.id));
  return (await listFriends(db, p.userId)).filter((f) => !skip.has(f.userId));
}

/** Invite des amis à une partie en attente de joueurs ; chacun reçoit une notification et peut rejoindre même si la partie est sur invitation. */
export async function inviteFriendsToGame(db: Db, p: { userId: string; gameId: string; friendIds: string[] }): Promise<{ invited: number }> {
  const ids = [...new Set(p.friendIds)];
  if (ids.length === 0 || ids.length > MAX_INVITES_PER_REQUEST) throw new DomainError("invalid_params", `Invitez entre 1 et ${MAX_INVITES_PER_REQUEST} amis à la fois.`, 400);
  return db.transaction(async (tx) => {
    const [g] = await tx.select().from(game).where(eq(game.id, p.gameId));
    if (!g) throw new DomainError("not_found", "Partie introuvable.", 404);
    const [mine] = await tx.select({ id: participant.id }).from(participant).where(and(eq(participant.gameId, g.id), eq(participant.userId, p.userId)));
    if (!mine) throw new DomainError("forbidden", "Seuls les participants invitent des amis.", 403);
    if (g.status !== "open") throw new DomainError("game_not_open", "Cette partie n'accepte plus de joueurs.", 409);
    const friends = new Set((await listFriends(tx as unknown as Db, p.userId)).map((f) => f.userId));
    if (ids.some((id) => !friends.has(id))) throw new DomainError("not_friends", "Vous ne pouvez inviter que vos amis.", 403);
    const already = new Set([
      ...(await tx.select({ id: participant.userId }).from(participant).where(and(eq(participant.gameId, g.id), inArray(participant.userId, ids)))).map((r) => r.id),
      ...(await tx.select({ id: gameInvitation.userId }).from(gameInvitation).where(and(eq(gameInvitation.gameId, g.id), inArray(gameInvitation.userId, ids)))).map((r) => r.id),
    ]);
    const fresh = ids.filter((id) => !already.has(id));
    for (const id of fresh) {
      await tx.insert(gameInvitation).values({ gameId: g.id, userId: id, invitedBy: p.userId });
      await queueNotification(tx, { userId: id, type: "game_invite", gameId: g.id, actorId: p.userId, inAppOnly: true });
    }
    return { invited: fresh.length };
  });
}

export type ReceivedInvitation = { gameId: string; name: string; type: "drawing" | "text"; theme: string | null; inviterName: string; turns: number; turnDurationSeconds: number; players: string[] };

/** Invitations reçues pour des parties encore en attente de joueurs où l'on n'est pas inscrit. */
export async function listMyInvitations(db: Db, userId: string): Promise<ReceivedInvitation[]> {
  return db
    .select({
      gameId: game.id,
      name: game.name,
      type: game.type,
      theme: game.theme,
      inviterName: user.name,
      turns: game.turns,
      turnDurationSeconds: game.turnDurationSeconds,
      players: sql<string[]>`coalesce(array(select pu.name from participant pp join "user" pu on pu.id = pp.user_id where pp.game_id = ${game.id} and pp.left_at is null order by pp.joined_at, pu.name), '{}'::text[])`,
    })
    .from(gameInvitation)
    .innerJoin(game, eq(game.id, gameInvitation.gameId))
    .innerJoin(user, eq(user.id, gameInvitation.invitedBy))
    .where(and(eq(gameInvitation.userId, userId), eq(game.status, "open")))
    .orderBy(desc(gameInvitation.createdAt))
    .limit(10)
    .then(async (rows) => {
      const mine = await db.select({ id: participant.gameId }).from(participant).where(eq(participant.userId, userId));
      const joined = new Set(mine.map((r) => r.id));
      return rows.filter((r) => !joined.has(r.gameId));
    });
}

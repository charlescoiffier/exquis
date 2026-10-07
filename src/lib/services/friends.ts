import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { resolveAvatar, type AvatarSpec } from "@/lib/avatar";
import type { Db } from "@/lib/db/client";
import { user } from "@/lib/db/auth-schema";
import { friendship, game, participant, profile } from "@/lib/db/schema";
import { DomainError } from "@/lib/errors";
import { queueNotification } from "./notifications";

/** Alphabet du code ami : sans 0/O, 1/I/L, pour éviter les confusions à la dictée. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const FRIEND_CODE_LENGTH = 8;
export const MAX_FRIENDS = 200;

export type Person = { userId: string; name: string; avatar: AvatarSpec };

function newCode(): string {
  const bytes = randomBytes(FRIEND_CODE_LENGTH);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

/** Normalise un code saisi : majuscules, sans espaces ni tirets. */
export const normalizeFriendCode = (raw: string) => raw.toUpperCase().replace(/[\s-]/g, "");

/** Code ami d'un compte, créé à la première demande. */
export async function ensureFriendCode(db: Db, userId: string): Promise<string> {
  const [p] = await db.select({ code: profile.friendCode }).from(profile).where(eq(profile.userId, userId));
  if (p?.code) return p.code;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    try {
      await db.insert(profile).values({ userId, friendCode: code }).onConflictDoUpdate({ target: profile.userId, set: { friendCode: code }, setWhere: sql`${profile.friendCode} is null` });
      const [row] = await db.select({ code: profile.friendCode }).from(profile).where(eq(profile.userId, userId));
      if (row?.code) return row.code;
    } catch {
      // collision de code (très improbable) : on réessaie avec un autre
    }
  }
  throw new DomainError("friend_code_failed", "Impossible de créer votre code ami, réessayez.", 500);
}

async function relation(db: Db, a: string, b: string) {
  const [row] = await db
    .select()
    .from(friendship)
    .where(or(and(eq(friendship.requesterId, a), eq(friendship.addresseeId, b)), and(eq(friendship.requesterId, b), eq(friendship.addresseeId, a))));
  return row;
}

async function sendRequestTo(db: Db, userId: string, targetId: string): Promise<{ status: "pending" | "accepted" }> {
  if (targetId === userId) throw new DomainError("self_friend", "C'est votre propre code.", 400);
  return db.transaction(async (tx) => {
    const existing = await relation(tx as unknown as Db, userId, targetId);
    if (existing?.status === "accepted") throw new DomainError("already_friends", "Vous êtes déjà amis.", 409);
    if (existing) {
      if (existing.requesterId === userId) throw new DomainError("already_requested", "Demande déjà envoyée.", 409);
      // Demande croisée : l'autre personne avait déjà demandé, on accepte.
      await tx.update(friendship).set({ status: "accepted" }).where(eq(friendship.id, existing.id));
      await queueNotification(tx, { userId: targetId, type: "friend_accepted", actorId: userId, inAppOnly: true });
      return { status: "accepted" as const };
    }
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(friendship).where(and(or(eq(friendship.requesterId, userId), eq(friendship.addresseeId, userId)), eq(friendship.status, "accepted")));
    if (n >= MAX_FRIENDS) throw new DomainError("friend_limit", "Nombre maximal d'amis atteint.", 429);
    await tx.insert(friendship).values({ requesterId: userId, addresseeId: targetId });
    await queueNotification(tx, { userId: targetId, type: "friend_request", actorId: userId, inAppOnly: true });
    return { status: "pending" as const };
  });
}

/** Demande d'ami à partir du code ami d'une autre personne. */
export async function sendFriendRequestByCode(db: Db, p: { userId: string; code: string }): Promise<{ status: "pending" | "accepted" }> {
  const code = normalizeFriendCode(p.code);
  if (code.length !== FRIEND_CODE_LENGTH) throw new DomainError("unknown_code", "Code inconnu.", 404);
  const [target] = await db.select({ userId: profile.userId }).from(profile).where(eq(profile.friendCode, code));
  if (!target) throw new DomainError("unknown_code", "Code inconnu.", 404);
  return sendRequestTo(db, p.userId, target.userId);
}

/** Demande d'ami à un joueur rencontré (qui a participé à une partie avec vous). */
export async function sendFriendRequestToMetPlayer(db: Db, p: { userId: string; targetId: string }): Promise<{ status: "pending" | "accepted" }> {
  const met = await metPlayerIds(db, p.userId);
  if (!met.includes(p.targetId)) throw new DomainError("not_met", "Vous n'avez pas joué avec cette personne.", 403);
  return sendRequestTo(db, p.userId, p.targetId);
}

/** Accepte ou refuse une demande reçue. */
export async function respondToFriendRequest(db: Db, p: { userId: string; requestId: string; accept: boolean }): Promise<void> {
  await db.transaction(async (tx) => {
    const [req] = await tx.select().from(friendship).where(and(eq(friendship.id, p.requestId), eq(friendship.addresseeId, p.userId), eq(friendship.status, "pending")));
    if (!req) throw new DomainError("not_found", "Demande introuvable.", 404);
    if (p.accept) {
      await tx.update(friendship).set({ status: "accepted" }).where(eq(friendship.id, req.id));
      await queueNotification(tx, { userId: req.requesterId, type: "friend_accepted", actorId: p.userId, inAppOnly: true });
    } else {
      await tx.delete(friendship).where(eq(friendship.id, req.id));
    }
  });
}

/** Retire un ami, ou annule une demande envoyée. */
export async function removeFriend(db: Db, p: { userId: string; otherId: string }): Promise<void> {
  const rel = await relation(db, p.userId, p.otherId);
  if (!rel || (rel.status === "pending" && rel.requesterId !== p.userId)) throw new DomainError("not_found", "Introuvable.", 404);
  await db.delete(friendship).where(eq(friendship.id, rel.id));
}

async function people(db: Db, ids: string[]): Promise<Map<string, Person>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: user.id, name: user.name, shape: profile.avatarShape, color: profile.avatarColor, bg: profile.avatarBg })
    .from(user)
    .leftJoin(profile, eq(profile.userId, user.id))
    .where(inArray(user.id, ids));
  return new Map(rows.map((r) => [r.id, { userId: r.id, name: r.name, avatar: resolveAvatar(r.id, { avatarShape: r.shape, avatarColor: r.color, avatarBg: r.bg }) }]));
}

export async function listFriends(db: Db, userId: string): Promise<Person[]> {
  const rows = await db
    .select()
    .from(friendship)
    .where(and(eq(friendship.status, "accepted"), or(eq(friendship.requesterId, userId), eq(friendship.addresseeId, userId))));
  const others = rows.map((r) => (r.requesterId === userId ? r.addresseeId : r.requesterId));
  const map = await people(db, others);
  return others.map((id) => map.get(id)).filter((x): x is Person => !!x).sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

export type FriendRequest = Person & { requestId: string };

export async function listFriendRequests(db: Db, userId: string): Promise<{ incoming: FriendRequest[]; outgoing: FriendRequest[] }> {
  const rows = await db
    .select()
    .from(friendship)
    .where(and(eq(friendship.status, "pending"), or(eq(friendship.requesterId, userId), eq(friendship.addresseeId, userId))))
    .orderBy(desc(friendship.createdAt));
  const map = await people(db, rows.map((r) => (r.requesterId === userId ? r.addresseeId : r.requesterId)));
  const build = (r: (typeof rows)[number], other: string): FriendRequest | null => {
    const p = map.get(other);
    return p ? { ...p, requestId: r.id } : null;
  };
  return {
    incoming: rows.filter((r) => r.addresseeId === userId).map((r) => build(r, r.requesterId)).filter((x): x is FriendRequest => !!x),
    outgoing: rows.filter((r) => r.requesterId === userId).map((r) => build(r, r.addresseeId)).filter((x): x is FriendRequest => !!x),
  };
}

async function metPlayerIds(db: Db, userId: string): Promise<string[]> {
  const mine = db.select({ id: participant.gameId }).from(participant).where(eq(participant.userId, userId));
  const rows = await db
    .select({ id: participant.userId })
    .from(participant)
    .where(and(inArray(participant.gameId, mine), ne(participant.userId, userId)))
    .groupBy(participant.userId);
  return rows.map((r) => r.id);
}

/** Joueurs avec qui l'on a partagé une partie et qui ne sont ni amis ni en attente, les plus récemment rencontrés d'abord. */
export async function listMetPlayers(db: Db, userId: string, limit = 12): Promise<Person[]> {
  const rows = await db
    .select({ id: participant.userId, last: sql<Date>`max(${game.createdAt})` })
    .from(participant)
    .innerJoin(game, eq(game.id, participant.gameId))
    .where(
      and(
        inArray(participant.gameId, db.select({ id: participant.gameId }).from(participant).where(eq(participant.userId, userId))),
        ne(participant.userId, userId),
        sql`not exists (select 1 from friendship f where (f.requester_id = ${userId} and f.addressee_id = ${participant.userId}) or (f.addressee_id = ${userId} and f.requester_id = ${participant.userId}))`,
      ),
    )
    .groupBy(participant.userId)
    .orderBy(desc(sql`max(${game.createdAt})`))
    .limit(limit);
  const map = await people(db, rows.map((r) => r.id));
  return rows.map((r) => map.get(r.id)).filter((x): x is Person => !!x);
}

export async function areFriends(db: Db, a: string, b: string): Promise<boolean> {
  return (await relation(db, a, b))?.status === "accepted";
}

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { friendship, notification } from "@/lib/db/schema";
import { inviteFriendsToGame, listInvitableFriends, listMyInvitations } from "@/lib/services/game-invites";
import {
  ensureFriendCode, listFriendRequests, listFriends, listMetPlayers, normalizeFriendCode,
  removeFriend, respondToFriendRequest, sendFriendRequestByCode, sendFriendRequestToMetPlayer,
} from "@/lib/services/friends";
import { createGame, getGameView, joinGame, listJoinableGames } from "@/lib/services/games";
import { makeUser, resetDb, testDb } from "../helpers/db";
import { startedGame, textParams } from "../helpers/games";

const db = testDb();
beforeEach(() => resetDb(db));

async function befriend(a: string, b: string) {
  const code = await ensureFriendCode(db, b);
  await sendFriendRequestByCode(db, { userId: a, code });
  const { incoming } = await listFriendRequests(db, b);
  await respondToFriendRequest(db, { userId: b, requestId: incoming[0].requestId, accept: true });
}

describe("amis", () => {
  it("le code ami est créé une fois, stable, et tolère la saisie (minuscules, espaces, tirets)", async () => {
    const a = await makeUser(db, "a");
    const code = await ensureFriendCode(db, a);
    expect(code).toMatch(/^[A-Z2-9]{8}$/);
    expect(await ensureFriendCode(db, a)).toBe(code);
    expect(normalizeFriendCode(` ${code.slice(0, 4).toLowerCase()}-${code.slice(4)} `)).toBe(code);
  });

  it("demande par code, acceptation, notifications, liste d'amis des deux côtés", async () => {
    const a = await makeUser(db, "a");
    const b = await makeUser(db, "b");
    const code = await ensureFriendCode(db, b);
    expect(await sendFriendRequestByCode(db, { userId: a, code: code.toLowerCase() })).toEqual({ status: "pending" });
    expect((await listFriendRequests(db, b)).incoming.map((r) => r.name)).toEqual(["a"]);
    expect((await listFriendRequests(db, a)).outgoing).toHaveLength(1);
    const { incoming } = await listFriendRequests(db, b);
    await respondToFriendRequest(db, { userId: b, requestId: incoming[0].requestId, accept: true });
    expect((await listFriends(db, a)).map((f) => f.userId)).toEqual([b]);
    expect((await listFriends(db, b)).map((f) => f.userId)).toEqual([a]);
    const types = (await db.select().from(notification)).map((n) => [n.userId, n.type, n.actorId, n.gameId, n.emailPending]);
    expect(types).toEqual(expect.arrayContaining([[b, "friend_request", a, null, false], [a, "friend_accepted", b, null, false]]));
  });

  it("erreurs : code inconnu ou mal formé, soi-même, déjà amis, déjà demandé ; demandes croisées acceptées d'office", async () => {
    const a = await makeUser(db, "a");
    const b = await makeUser(db, "b");
    await expect(sendFriendRequestByCode(db, { userId: a, code: "ZZZZZZZZ" })).rejects.toMatchObject({ code: "unknown_code" });
    await expect(sendFriendRequestByCode(db, { userId: a, code: "abc" })).rejects.toMatchObject({ code: "unknown_code" });
    await expect(sendFriendRequestByCode(db, { userId: a, code: await ensureFriendCode(db, a) })).rejects.toMatchObject({ code: "self_friend" });
    const codeB = await ensureFriendCode(db, b);
    await sendFriendRequestByCode(db, { userId: a, code: codeB });
    await expect(sendFriendRequestByCode(db, { userId: a, code: codeB })).rejects.toMatchObject({ code: "already_requested" });
    // B demande à A en retour : l'amitié est créée tout de suite.
    expect(await sendFriendRequestByCode(db, { userId: b, code: await ensureFriendCode(db, a) })).toEqual({ status: "accepted" });
    await expect(sendFriendRequestByCode(db, { userId: a, code: codeB })).rejects.toMatchObject({ code: "already_friends" });
  });

  it("refuser supprime la demande ; seul le destinataire répond ; retirer un ami ou annuler une demande", async () => {
    const [a, b, c] = [await makeUser(db, "a"), await makeUser(db, "b"), await makeUser(db, "c")];
    await sendFriendRequestByCode(db, { userId: a, code: await ensureFriendCode(db, b) });
    const [req] = (await listFriendRequests(db, b)).incoming;
    await expect(respondToFriendRequest(db, { userId: c, requestId: req.requestId, accept: true })).rejects.toMatchObject({ code: "not_found" });
    await expect(respondToFriendRequest(db, { userId: a, requestId: req.requestId, accept: true })).rejects.toMatchObject({ code: "not_found" });
    await respondToFriendRequest(db, { userId: b, requestId: req.requestId, accept: false });
    expect(await db.select().from(friendship)).toEqual([]);
    await sendFriendRequestByCode(db, { userId: a, code: await ensureFriendCode(db, b) });
    await expect(removeFriend(db, { userId: b, otherId: a })).rejects.toMatchObject({ code: "not_found" }); // pas à lui d'annuler
    await removeFriend(db, { userId: a, otherId: b }); // annulation par l'expéditeur
    await befriend(a, c);
    await removeFriend(db, { userId: c, otherId: a });
    expect(await listFriends(db, a)).toEqual([]);
  });

  it("joueurs rencontrés : seulement ceux d'une partie commune, ni amis ni en attente ; demande directe réservée à eux", async () => {
    const { users } = await startedGame(db, textParams(3));
    const [a, b, c] = users;
    const stranger = await makeUser(db, "etranger");
    expect((await listMetPlayers(db, a)).map((p) => p.userId).sort()).toEqual([b, c].sort());
    await expect(sendFriendRequestToMetPlayer(db, { userId: a, targetId: stranger })).rejects.toMatchObject({ code: "not_met" });
    await sendFriendRequestToMetPlayer(db, { userId: a, targetId: b });
    expect((await listMetPlayers(db, a)).map((p) => p.userId)).toEqual([c]);
  });
});

describe("invitations ciblées", () => {
  it("un participant invite ses amis : notification, accès à une partie sur invitation, liste des invitations reçues", async () => {
    const [a, b, c] = [await makeUser(db, "a"), await makeUser(db, "b"), await makeUser(db, "c")];
    await befriend(a, b);
    const { gameId } = await createGame(db, a, textParams(3, { visibility: "invite", name: "Privée" }));
    await expect(getGameView(db, { gameId, userId: b })).rejects.toMatchObject({ code: "forbidden" });
    expect((await listInvitableFriends(db, { userId: a, gameId })).map((f) => f.userId)).toEqual([b]);
    expect(await inviteFriendsToGame(db, { userId: a, gameId, friendIds: [b] })).toEqual({ invited: 1 });
    expect(await inviteFriendsToGame(db, { userId: a, gameId, friendIds: [b] })).toEqual({ invited: 0 });
    expect(await listInvitableFriends(db, { userId: a, gameId })).toEqual([]);
    expect((await getGameView(db, { gameId, userId: b })).game.name).toBe("Privée");
    expect(await listMyInvitations(db, b)).toMatchObject([{ gameId, name: "Privée", inviterName: "a" }]);
    // Une partie publique à laquelle on est invité figure dans « Invitations reçues », pas dans « Parties à rejoindre ».
    const pub = await createGame(db, a, textParams(3, { name: "Publique" }));
    await inviteFriendsToGame(db, { userId: a, gameId: pub.gameId, friendIds: [b] });
    expect((await listJoinableGames(db, { userId: b })).items.map((g) => g.name)).toEqual([]);
    expect((await listJoinableGames(db, { userId: c })).items.map((g) => g.name)).toEqual(["Publique"]);
    await joinGame(db, { userId: b, gameId: pub.gameId });
    expect((await db.select().from(notification).where(eq(notification.type, "game_invite"))).map((n) => [n.userId, n.actorId])).toEqual([[b, a], [b, a]]);
    // L'invité rejoint ; l'invitation disparaît de sa liste. Un non-invité reste refusé.
    await joinGame(db, { userId: b, gameId });
    expect(await listMyInvitations(db, b)).toEqual([]);
    await expect(joinGame(db, { userId: c, gameId })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("refus : non-ami, non-participant, partie non ouverte, liste vide ou trop longue", async () => {
    const [a, b, c] = [await makeUser(db, "a"), await makeUser(db, "b"), await makeUser(db, "c")];
    await befriend(a, b);
    const { gameId } = await createGame(db, a, textParams(3));
    await expect(inviteFriendsToGame(db, { userId: a, gameId, friendIds: [c] })).rejects.toMatchObject({ code: "not_friends" });
    await expect(inviteFriendsToGame(db, { userId: b, gameId, friendIds: [a] })).rejects.toMatchObject({ code: "forbidden" });
    await expect(inviteFriendsToGame(db, { userId: a, gameId, friendIds: [] })).rejects.toMatchObject({ code: "invalid_params" });
    const started = await startedGame(db, textParams(2));
    await befriend(started.users[0], c);
    await expect(inviteFriendsToGame(db, { userId: started.users[0], gameId: started.gameId, friendIds: [c] })).rejects.toMatchObject({ code: "game_not_open" });
  });
});

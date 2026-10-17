import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { account, session, user } from "@/lib/db/auth-schema";
import { comment, game, participant, profile } from "@/lib/db/schema";
import { MemoryStorage } from "@/lib/storage/memory";
import {
  deleteCommentAsAdmin, deleteUser, deleteWorkAsAdmin, getWorkForAdmin, listCompletedWorks, listUsers, setUserRole,
} from "@/lib/services/admin";
import { addComment, listComments } from "@/lib/services/comments";
import { createGame, getGameView } from "@/lib/services/games";
import { isAdmin, isModerator, setRole } from "@/lib/services/moderation";
import { submitText } from "@/lib/services/turns";
import { makeUser, resetDb, testDb } from "../helpers/db";
import { activeTurn, startedGame, textParams } from "../helpers/games";

// Avant le premier appel à env() : cette adresse est administratrice sans rôle en base.
process.env.ADMIN_EMAILS = "chef@exemple.fr, AUTRE@exemple.fr";

const db = testDb();
beforeEach(() => resetDb(db));

async function makeAdmin() {
  const id = await makeUser(db, "admin");
  await setRole(db, id, "admin");
  return id;
}
async function completedGame() {
  const g = await startedGame(db, textParams(2, { name: "Terminée" }));
  for (let i = 0; i < 2; i++) {
    const t = await activeTurn(db, g.gameId);
    await submitText(db, { userId: t.assignedUserId, gameId: g.gameId, text: `tour ${i + 1} du texte` });
  }
  return g;
}

describe("rôle d'administrateur", () => {
  it("rôle « admin » ou adresse listée dans ADMIN_EMAILS ; un administrateur est aussi modérateur", async () => {
    const a = await makeAdmin();
    const p = await makeUser(db, "joueur");
    expect(await isAdmin(db, a)).toBe(true);
    expect(await isModerator(db, a)).toBe(true);
    expect(await isAdmin(db, p)).toBe(false);
    await db.update(user).set({ email: "Chef@Exemple.fr" }).where(eq(user.id, p));
    expect(await isAdmin(db, p)).toBe(true);
  });

  it("toutes les opérations d'administration sont refusées aux autres", async () => {
    const p = await makeUser(db, "joueur");
    const q = await makeUser(db, "autre");
    await expect(listUsers(db, { adminId: p })).rejects.toMatchObject({ code: "forbidden" });
    await expect(setUserRole(db, { adminId: p, userId: q, role: "moderator" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(deleteUser(db, { adminId: p, userId: q })).rejects.toMatchObject({ code: "forbidden" });
    await expect(listCompletedWorks(db, { adminId: p })).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("inscrits", () => {
  it("liste paginée, recherche par nom ou adresse, rôle effectif", async () => {
    const a = await makeAdmin();
    for (let i = 0; i < ADMIN_COUNT; i++) await makeUser(db, `membre${i}`);
    const all = await listUsers(db, { adminId: a });
    expect(all.total).toBe(ADMIN_COUNT + 1);
    expect(all.items).toHaveLength(20);
    expect(all.pageCount).toBe(2);
    expect((await listUsers(db, { adminId: a, page: 2 })).items).toHaveLength(ADMIN_COUNT + 1 - 20);
    expect((await listUsers(db, { adminId: a, q: "membre3" })).items.map((u) => u.name)).toEqual(["membre3"]);
    expect((await listUsers(db, { adminId: a, q: "admin" })).items[0].role).toBe("admin");
  });

  it("passer un compte en modérateur ; pas soi-même, pas un administrateur", async () => {
    const a = await makeAdmin();
    const b = await makeAdmin();
    const p = await makeUser(db, "joueur");
    await setUserRole(db, { adminId: a, userId: p, role: "moderator" });
    expect(await isModerator(db, p)).toBe(true);
    await setUserRole(db, { adminId: a, userId: p, role: "player" });
    expect(await isModerator(db, p)).toBe(false);
    await expect(setUserRole(db, { adminId: a, userId: a, role: "player" })).rejects.toMatchObject({ code: "self_role" });
    await expect(setUserRole(db, { adminId: a, userId: b, role: "player" })).rejects.toMatchObject({ code: "target_admin" });
  });
});

const ADMIN_COUNT = 24;

describe("suppression d'un compte", () => {
  it("les œuvres restent, avec un auteur « Compte supprimé » ; identifiants et sessions disparaissent", async () => {
    const a = await makeAdmin();
    const { gameId, users } = await completedGame();
    const victim = users[1];
    await db.insert(account).values({ id: crypto.randomUUID(), accountId: victim, providerId: "credential", userId: victim, password: "x" });
    await db.insert(session).values({ id: crypto.randomUUID(), token: crypto.randomUUID(), userId: victim, expiresAt: new Date(Date.now() + 1e6) });
    await addComment(db, { userId: victim, gameId, body: "mon commentaire" });
    await deleteUser(db, { adminId: a, userId: victim });
    expect(await db.select().from(user).where(eq(user.id, victim))).toEqual([]);
    expect(await db.select().from(account).where(eq(account.userId, victim))).toEqual([]);
    expect(await db.select().from(session).where(eq(session.userId, victim))).toEqual([]);
    const work = await getWorkForAdmin(db, { adminId: a, gameId });
    expect(work.contributions.map((c) => c.author).sort()).toEqual(["Compte supprimé", "p0"]);
    expect(work.comments).toMatchObject([{ author: "Compte supprimé", body: "mon commentaire" }]);
    expect((await listComments(db, { userId: users[0], gameId })).map((c) => c.author)).toEqual(["Compte supprimé"]);
  });

  it("libère sa place dans une partie en attente ou en cours ; supprime ses parties en attente vides", async () => {
    const a = await makeAdmin();
    const [x, y] = [await makeUser(db, "x"), await makeUser(db, "y")];
    const waiting = await createGame(db, x, textParams(3, { name: "attente de x" }));
    const shared = await createGame(db, y, textParams(3, { name: "attente de y" }));
    await db.insert(participant).values({ gameId: shared.gameId, userId: x });
    const running = await startedGame(db, textParams(2, { name: "en cours" }));
    const victimInRunning = running.users[1];
    await deleteUser(db, { adminId: a, userId: x });
    expect(await db.select().from(game).where(eq(game.id, waiting.gameId))).toEqual([]);
    expect((await getGameView(db, { gameId: shared.gameId, userId: y })).participantCount).toBe(1);
    await deleteUser(db, { adminId: a, userId: victimInRunning });
    const [g] = await db.select().from(game).where(eq(game.id, running.gameId));
    expect(g.status).toBe("in_progress");
  });

  it("refus : soi-même, un administrateur, un compte inconnu", async () => {
    const a = await makeAdmin();
    const b = await makeAdmin();
    await expect(deleteUser(db, { adminId: a, userId: a })).rejects.toMatchObject({ code: "self_delete" });
    await expect(deleteUser(db, { adminId: a, userId: b })).rejects.toMatchObject({ code: "target_admin" });
    await expect(deleteUser(db, { adminId: a, userId: "inconnu" })).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("œuvres terminées et commentaires", () => {
  it("liste des œuvres terminées, détail avec commentaires même masqués", async () => {
    const a = await makeAdmin();
    const { gameId, users } = await completedGame();
    await startedGame(db, textParams(2, { name: "pas terminée" }));
    const { id } = await addComment(db, { userId: users[0], gameId, body: "visible" });
    const hidden = await addComment(db, { userId: users[1], gameId, body: "masqué" });
    await db.update(comment).set({ hiddenAt: new Date() }).where(eq(comment.id, hidden.id));
    const list = await listCompletedWorks(db, { adminId: a });
    expect(list.items).toMatchObject([{ id: gameId, name: "Terminée", comments: 2, hidden: false }]);
    const work = await getWorkForAdmin(db, { adminId: a, gameId });
    expect(work.comments.map((c) => [c.body, c.hidden])).toEqual([["visible", false], ["masqué", true]]);
    await deleteCommentAsAdmin(db, { adminId: a, commentId: id });
    expect((await getWorkForAdmin(db, { adminId: a, gameId })).comments).toHaveLength(1);
    await expect(deleteCommentAsAdmin(db, { adminId: a, commentId: id })).rejects.toMatchObject({ code: "not_found" });
  });

  it("supprimer une œuvre : base et fichiers ; refusé pour une partie en cours", async () => {
    const a = await makeAdmin();
    const { gameId } = await completedGame();
    const running = await startedGame(db, textParams(2));
    const storage = new MemoryStorage();
    await storage.put(`games/${gameId}/final/guides.png`, Buffer.from("x"), "image/png");
    await expect(deleteWorkAsAdmin(db, storage, { adminId: a, gameId: running.gameId })).rejects.toMatchObject({ code: "game_not_finished" });
    await deleteWorkAsAdmin(db, storage, { adminId: a, gameId });
    expect(await db.select().from(game).where(eq(game.id, gameId))).toEqual([]);
    expect(await storage.exists(`games/${gameId}/final/guides.png`)).toBe(false);
    expect((await db.select().from(profile)).length).toBeGreaterThan(0);
  });
});

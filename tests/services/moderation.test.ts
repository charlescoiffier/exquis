import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { comment, game, notification, report } from "@/lib/db/schema";
import { addComment, listComments } from "@/lib/services/comments";
import { getFinal, getPublicFinal } from "@/lib/services/final-work";
import { createReport, isModerator, listOpenReports, resolveReport, setRole } from "@/lib/services/moderation";
import { setPublicLink } from "@/lib/services/sharing";
import { submitText } from "@/lib/services/turns";
import { makeUser, resetDb, testDb } from "../helpers/db";
import { activeTurn, startedGame, textParams } from "../helpers/games";

const db = testDb();
beforeEach(() => resetDb(db));

async function completedGame() {
  const g = await startedGame(db, textParams(2, { name: "Signalée" }));
  for (let i = 0; i < 2; i++) {
    const t = await activeTurn(db, g.gameId);
    await submitText(db, { userId: t.assignedUserId, gameId: g.gameId, text: `tour ${i + 1} du texte` });
  }
  return g;
}

describe("signalement", () => {
  it("un participant signale le commentaire d'un autre ; doublon, propre contenu, non-participant et motif inconnu refusés", async () => {
    const { gameId, users } = await completedGame();
    const { id } = await addComment(db, { userId: users[0], gameId, body: "texte déplacé" });
    const stranger = await makeUser(db, "etranger");
    await createReport(db, { userId: users[1], targetType: "comment", targetId: id, reason: "harassment", details: "  insulte  " });
    expect((await db.select().from(report))[0]).toMatchObject({ reporterId: users[1], status: "open", reason: "harassment", details: "insulte" });
    await expect(createReport(db, { userId: users[1], targetType: "comment", targetId: id, reason: "spam" })).rejects.toMatchObject({ code: "already_reported" });
    await expect(createReport(db, { userId: users[0], targetType: "comment", targetId: id, reason: "spam" })).rejects.toMatchObject({ code: "own_content" });
    await expect(createReport(db, { userId: stranger, targetType: "comment", targetId: id, reason: "spam" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(createReport(db, { userId: users[1], targetType: "comment", targetId: id, reason: "bof" })).rejects.toMatchObject({ code: "invalid_reason" });
    await expect(createReport(db, { userId: users[1], targetType: "comment", targetId: "00000000-0000-4000-8000-000000000000", reason: "spam" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("signaler une œuvre : terminée seulement, participants seulement", async () => {
    const running = await startedGame(db, textParams(2));
    await expect(createReport(db, { userId: running.users[0], targetType: "work", targetId: running.gameId, reason: "spam" })).rejects.toMatchObject({ code: "not_found" });
    const { gameId, users } = await completedGame();
    const stranger = await makeUser(db, "etranger");
    await expect(createReport(db, { userId: stranger, targetType: "work", targetId: gameId, reason: "spam" })).rejects.toMatchObject({ code: "forbidden" });
    await createReport(db, { userId: users[1], targetType: "work", targetId: gameId, reason: "inappropriate" });
    expect(await db.select().from(report)).toHaveLength(1);
  });
});

describe("modération", () => {
  it("seuls les modérateurs traitent les signalements", async () => {
    const { gameId, users } = await completedGame();
    const { id } = await addComment(db, { userId: users[0], gameId, body: "x" });
    await createReport(db, { userId: users[1], targetType: "comment", targetId: id, reason: "spam" });
    const [r] = await db.select().from(report);
    expect(await isModerator(db, users[1])).toBe(false);
    await expect(resolveReport(db, { moderatorId: users[1], reportId: r.id, action: "hide" })).rejects.toMatchObject({ code: "forbidden" });
    await setRole(db, users[1], "moderator");
    expect(await isModerator(db, users[1])).toBe(true);
    await setRole(db, users[1], "player");
    expect(await isModerator(db, users[1])).toBe(false);
  });

  it("masquer un commentaire : il disparaît, son auteur est prévenu, les doublons sont clos ; la file ne montre que l'ouvert", async () => {
    const { gameId, users } = await completedGame();
    const mod = await makeUser(db, "mod");
    await setRole(db, mod, "moderator");
    const { id } = await addComment(db, { userId: users[0], gameId, body: "texte déplacé" });
    await createReport(db, { userId: users[1], targetType: "comment", targetId: id, reason: "harassment" });
    const open = await listOpenReports(db);
    expect(open).toMatchObject([{ targetType: "comment", excerpt: "texte déplacé", authorName: "p0", reporterName: "p1", gameName: "Signalée" }]);
    await resolveReport(db, { moderatorId: mod, reportId: open[0].id, action: "hide" });
    expect(await listComments(db, { userId: users[0], gameId })).toEqual([]);
    expect((await db.select().from(comment).where(eq(comment.id, id)))[0].hiddenAt).not.toBeNull();
    expect((await db.select().from(report))[0]).toMatchObject({ status: "resolved", resolvedBy: mod });
    expect(await listOpenReports(db)).toEqual([]);
    expect((await db.select().from(notification).where(eq(notification.type, "comment_hidden"))).map((n) => n.userId)).toEqual([users[0]]);
    await expect(resolveReport(db, { moderatorId: mod, reportId: open[0].id, action: "dismiss" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("rejeter un signalement laisse le contenu en place", async () => {
    const { gameId, users } = await completedGame();
    const mod = await makeUser(db, "mod");
    await setRole(db, mod, "moderator");
    const { id } = await addComment(db, { userId: users[0], gameId, body: "tout va bien" });
    await createReport(db, { userId: users[1], targetType: "comment", targetId: id, reason: "other" });
    await resolveReport(db, { moderatorId: mod, reportId: (await listOpenReports(db))[0].id, action: "dismiss" });
    expect(await listComments(db, { userId: users[0], gameId })).toHaveLength(1);
    expect((await db.select().from(report))[0].status).toBe("dismissed");
  });

  it("masquer une œuvre : lien public retiré, plus visible des participants, plus commentable ni partageable, participants prévenus", async () => {
    const { gameId, users } = await completedGame();
    const mod = await makeUser(db, "mod");
    await setRole(db, mod, "moderator");
    const { token } = await setPublicLink(db, { userId: users[0], gameId, enabled: true });
    await createReport(db, { userId: users[1], targetType: "work", targetId: gameId, reason: "inappropriate" });
    const [item] = await listOpenReports(db);
    expect(item).toMatchObject({ targetType: "work", gameName: "Signalée", isDrawing: false });
    expect(item.excerpt).toContain("tour 1 du texte");
    await resolveReport(db, { moderatorId: mod, reportId: item.id, action: "hide" });
    const [g] = await db.select().from(game).where(eq(game.id, gameId));
    expect(g.hiddenAt).not.toBeNull();
    expect(g.publicToken).toBeNull();
    await expect(getPublicFinal(db, token!)).rejects.toMatchObject({ code: "not_found" });
    await expect(getFinal(db, { userId: users[0], gameId })).rejects.toMatchObject({ code: "work_hidden" });
    await expect(addComment(db, { userId: users[0], gameId, body: "encore" })).rejects.toMatchObject({ code: "game_not_completed" });
    await expect(setPublicLink(db, { userId: users[0], gameId, enabled: true })).rejects.toMatchObject({ code: "game_not_completed" });
    expect((await db.select().from(notification).where(eq(notification.type, "work_hidden"))).map((n) => n.userId).sort()).toEqual([...users].sort());
  });
});

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { game, notification } from "@/lib/db/schema";
import { MemoryStorage } from "@/lib/storage/memory";
import { addComment, deleteComment, listComments, MAX_COMMENT_LENGTH } from "@/lib/services/comments";
import { getPublicFinal, getPublicImage } from "@/lib/services/final-work";
import { PUBLIC_TOKEN_PATTERN, getShareState, setPublicLink } from "@/lib/services/sharing";
import { submitText } from "@/lib/services/turns";
import { makeUser, resetDb, testDb } from "../helpers/db";
import { activeTurn, startedGame, textParams } from "../helpers/games";

const db = testDb();
beforeEach(() => resetDb(db));

/** Partie de texte à deux joueurs menée à son terme ; le créateur est users[0]. */
async function completedGame() {
  const g = await startedGame(db, textParams(2, { name: "Partagée" }));
  for (let i = 0; i < 2; i++) {
    const t = await activeTurn(db, g.gameId);
    await submitText(db, { userId: t.assignedUserId, gameId: g.gameId, text: `tour ${i + 1} du texte` });
  }
  return g;
}

describe("commentaires", () => {
  it("les participants commentent une œuvre terminée ; les autres participants sont prévenus (sans email)", async () => {
    const { gameId, users } = await completedGame();
    await addComment(db, { userId: users[1], gameId, body: "  Superbe !  " });
    const list = await listComments(db, { userId: users[0], gameId });
    expect(list).toMatchObject([{ author: "p1", body: "Superbe !", authorId: users[1] }]);
    const notes = await db.select().from(notification).where(eq(notification.type, "comment_added"));
    expect(notes.map((n) => [n.userId, n.emailPending])).toEqual([[users[0], false]]);
  });

  it("refuse : non participant, partie non terminée, vide, trop long", async () => {
    const { gameId, users } = await completedGame();
    const stranger = await makeUser(db, "etranger");
    await expect(addComment(db, { userId: stranger, gameId, body: "salut" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(listComments(db, { userId: stranger, gameId })).rejects.toMatchObject({ code: "forbidden" });
    await expect(addComment(db, { userId: users[0], gameId, body: "   " })).rejects.toMatchObject({ code: "empty_comment" });
    await expect(addComment(db, { userId: users[0], gameId, body: "x".repeat(MAX_COMMENT_LENGTH + 1) })).rejects.toMatchObject({ code: "comment_too_long" });
    const running = await startedGame(db, textParams(2));
    await expect(addComment(db, { userId: running.users[0], gameId: running.gameId, body: "trop tôt" })).rejects.toMatchObject({ code: "game_not_completed" });
  });

  it("seul l'auteur supprime son commentaire", async () => {
    const { gameId, users } = await completedGame();
    const { id } = await addComment(db, { userId: users[0], gameId, body: "à moi" });
    await expect(deleteComment(db, { userId: users[1], gameId, commentId: id })).rejects.toMatchObject({ code: "not_found" });
    await deleteComment(db, { userId: users[0], gameId, commentId: id });
    expect(await listComments(db, { userId: users[0], gameId })).toEqual([]);
  });
});

describe("lien public", () => {
  it("le créateur l'active (jeton stable) et le révoque ; les autres participants le voient seulement", async () => {
    const { gameId, users } = await completedGame();
    expect(await getShareState(db, { userId: users[1], gameId })).toEqual({ token: null, isCreator: false });
    await expect(setPublicLink(db, { userId: users[1], gameId, enabled: true })).rejects.toMatchObject({ code: "forbidden" });
    const { token } = await setPublicLink(db, { userId: users[0], gameId, enabled: true });
    expect(token).toMatch(PUBLIC_TOKEN_PATTERN);
    expect((await setPublicLink(db, { userId: users[0], gameId, enabled: true })).token).toBe(token);
    expect(await getShareState(db, { userId: users[1], gameId })).toEqual({ token, isCreator: false });
    await setPublicLink(db, { userId: users[0], gameId, enabled: false });
    expect((await db.select().from(game).where(eq(game.id, gameId)))[0].publicToken).toBeNull();
    await expect(getPublicFinal(db, token!)).rejects.toMatchObject({ code: "not_found" });
  });

  it("une partie non terminée ne se partage pas", async () => {
    const { gameId, users } = await startedGame(db, textParams(2));
    await expect(setPublicLink(db, { userId: users[0], gameId, enabled: true })).rejects.toMatchObject({ code: "game_not_completed" });
  });

  it("l'œuvre se lit sans compte avec le jeton ; un faux jeton ne donne rien ; l'image exige l'assemblage", async () => {
    const { gameId, users } = await completedGame();
    const { token } = await setPublicLink(db, { userId: users[0], gameId, enabled: true });
    const view = await getPublicFinal(db, token!);
    expect(view).toMatchObject({ name: "Partagée", type: "text", contributions: [{ text: "tour 1 du texte" }, { text: "tour 2 du texte" }] });
    await expect(getPublicFinal(db, "x".repeat(32))).rejects.toMatchObject({ code: "not_found" });
    await expect(getPublicImage(db, new MemoryStorage(), token!)).rejects.toMatchObject({ code: "not_ready" });
  });
});

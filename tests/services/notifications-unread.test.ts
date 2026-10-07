import { beforeEach, describe, expect, it } from "vitest";
import { countUnread, markAllRead } from "@/lib/services/notifications";
import { resetDb, testDb } from "../helpers/db";
import { startedGame, textParams } from "../helpers/games";

const db = testDb();
beforeEach(() => resetDb(db));

describe("countUnread", () => {
  it("compte les notifications non lues d'un utilisateur seulement", async () => {
    const { users } = await startedGame(db, textParams(2));
    const [first, second] = users;
    const a = await countUnread(db, first);
    const b = await countUnread(db, second);
    expect(a + b).toBeGreaterThan(0);
    await markAllRead(db, first);
    expect(await countUnread(db, first)).toBe(0);
    expect(await countUnread(db, second)).toBe(b);
  });
  it("renvoie 0 sans notification", async () => {
    expect(await countUnread(db, "inconnu")).toBe(0);
  });
});

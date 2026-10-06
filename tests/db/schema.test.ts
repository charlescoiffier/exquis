import { beforeEach, describe, expect, it } from "vitest";
import { game, participant, turn } from "@/lib/db/schema";
import { makeUser, resetDb, testDb } from "../helpers/db";

const db = testDb();
beforeEach(() => resetDb(db));

describe("schéma", () => {
  it("interdit deux rangs identiques dans une partie", async () => {
    const u = await makeUser(db, "a");
    const [g] = await db.insert(game).values({ creatorId: u, name: "g", type: "text", turns: 2, turnDurationSeconds: 60, visibility: "public", inviteToken: "t" }).returning();
    await db.insert(turn).values({ gameId: g.id, rank: 1, assignedUserId: u });
    await expect(db.insert(turn).values({ gameId: g.id, rank: 1, assignedUserId: u })).rejects.toThrow();
  });
  it("interdit une double inscription", async () => {
    const u = await makeUser(db, "a");
    const [g] = await db.insert(game).values({ creatorId: u, name: "g", type: "text", turns: 2, turnDurationSeconds: 60, visibility: "public", inviteToken: "t" }).returning();
    await db.insert(participant).values({ gameId: g.id, userId: u });
    await expect(db.insert(participant).values({ gameId: g.id, userId: u })).rejects.toThrow();
  });
});

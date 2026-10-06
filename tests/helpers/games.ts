import { and, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { turn } from "@/lib/db/schema";
import { createGame, joinGame } from "@/lib/services/games";
import { makeUser } from "./db";

export type GameOpts = Record<string, unknown>;

export const drawingParams = (turns: number, extra: GameOpts = {}) => ({
  type: "drawing", name: "Dessin", turns, turnDurationSeconds: 3600, visibility: "public", direction: "down", ...extra,
});
export const textParams = (turns: number, extra: GameOpts = {}) => ({
  type: "text", name: "Texte", turns, turnDurationSeconds: 3600, visibility: "public",
  language: "fr", minWords: 2, maxWords: 50, excerptMode: "paragraph", ...extra,
});

/** Crée une partie pleine et démarrée ; renvoie ses joueurs. */
export async function startedGame(db: Db, params: GameOpts, now = new Date()) {
  const n = params.turns as number;
  const users: string[] = [];
  for (let i = 0; i < n; i++) users.push(await makeUser(db, `p${i}`));
  const { gameId } = await createGame(db, users[0], params, now);
  let effects: Awaited<ReturnType<typeof joinGame>>["effects"] = [];
  for (const u of users.slice(1)) effects = (await joinGame(db, { userId: u, gameId, now })).effects;
  return { gameId, users, effects };
}

export async function activeTurn(db: Db, gameId: string) {
  const [t] = await db.select().from(turn).where(and(eq(turn.gameId, gameId), eq(turn.status, "active")));
  // Un tour actif a toujours un joueur assigné (seul open_call a assignedUserId = null).
  return t as typeof t & { assignedUserId: string };
}

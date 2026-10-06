import { readJson, route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { createGame, listMyGames, listOpenCalls, listOpenGames } from "@/lib/services/games";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

export const GET = route(async () => {
  const user = await requireUser();
  const db = getDb();
  return { open: await listOpenGames(db), openCalls: await listOpenCalls(db), mine: await listMyGames(db, user.id) };
});

export const POST = route(
  async (req) => {
    const user = await requireUser();
    return createGame(getDb(), user.id, await readJson(req));
  },
  { limit: { name: "create-game", max: 10, windowMs: 3600_000 } },
);

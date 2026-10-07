import { readJson, route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { createGame, listMyCurrentGames, listOpenCalls, listOpenGames, parsePage } from "@/lib/services/games";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

export const GET = route(async (req) => {
  const user = await requireUser();
  const db = getDb();
  const page = parsePage(new URL(req.url).searchParams.get("page") ?? undefined);
  return { open: await listOpenGames(db, { page }), openCalls: await listOpenCalls(db, { page }), mine: await listMyCurrentGames(db, user.id, { page }) };
});

export const POST = route(
  async (req) => {
    const user = await requireUser();
    return createGame(getDb(), user.id, await readJson(req));
  },
  { limit: { name: "create-game", max: 10, windowMs: 3600_000 } },
);

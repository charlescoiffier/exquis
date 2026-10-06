import { parseId, route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { getGameView } from "@/lib/services/games";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

export const GET = route(async (req, ctx) => {
  const user = await requireUser();
  const id = await parseId(ctx);
  const token = new URL(req.url).searchParams.get("token") ?? undefined;
  return getGameView(getDb(), { gameId: id, userId: user.id, token });
});

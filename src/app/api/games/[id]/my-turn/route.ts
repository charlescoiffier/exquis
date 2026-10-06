import { parseId, route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { getMyTurn } from "@/lib/services/turns";
import { requireUser } from "@/lib/session";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";

export const GET = route(async (_req, ctx) => {
  const user = await requireUser();
  const id = await parseId(ctx);
  return { turn: await getMyTurn(getDb(), getStorage(), { userId: user.id, gameId: id }) };
});

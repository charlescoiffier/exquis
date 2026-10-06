import { fireEffects, parseId, readTokenBody, route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { joinGame } from "@/lib/services/games";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

export const POST = route(
  async (req, ctx) => {
    const user = await requireUser();
    const id = await parseId(ctx);
    const body = await readTokenBody(req);
    const { started, effects } = await joinGame(getDb(), { userId: user.id, gameId: id, token: body.token });
    await fireEffects(effects);
    return { started };
  },
  { limit: { name: "join", max: 30, windowMs: 3600_000 } },
);

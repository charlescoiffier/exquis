import { fireEffects, parseId, route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { leaveGame } from "@/lib/services/games";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

export const POST = route(
  async (_req, ctx) => {
    const user = await requireUser();
    const id = await parseId(ctx);
    const { effects } = await leaveGame(getDb(), { userId: user.id, gameId: id });
    await fireEffects(effects);
    return { ok: true };
  },
  { limit: { name: "leave", max: 30, windowMs: 3600_000 } },
);

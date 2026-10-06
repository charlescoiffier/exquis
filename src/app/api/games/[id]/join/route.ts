import { route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { getBoss, runEffects } from "@/lib/jobs/queue";
import { joinGame } from "@/lib/services/games";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

export const POST = route(
  async (req, ctx) => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { token?: string };
    const { started, effects } = await joinGame(getDb(), { userId: user.id, gameId: id, token: body.token });
    if (effects.length) await runEffects(await getBoss(), effects);
    return { started };
  },
  { limit: { name: "join", max: 30, windowMs: 3600_000 } },
);

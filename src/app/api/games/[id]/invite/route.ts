import { z } from "zod";
import { parseId, readJson, route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { inviteFriendsToGame } from "@/lib/services/game-invites";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

const body = z.object({ friendIds: z.array(z.string().max(100)).max(20) });

export const POST = route(
  async (req, ctx) => {
    const user = await requireUser();
    return inviteFriendsToGame(getDb(), { userId: user.id, gameId: await parseId(ctx), friendIds: body.parse(await readJson(req)).friendIds });
  },
  { limit: { name: "game-invite", max: 30, windowMs: 3600_000 } },
);

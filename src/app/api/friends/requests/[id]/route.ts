import { z } from "zod";
import { parseId, readJson, route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { respondToFriendRequest } from "@/lib/services/friends";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

const body = z.object({ accept: z.boolean() });

export const POST = route(async (req, ctx) => {
  const user = await requireUser();
  await respondToFriendRequest(getDb(), { userId: user.id, requestId: await parseId(ctx), accept: body.parse(await readJson(req)).accept });
  return { ok: true };
});

import { route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { getFinal } from "@/lib/services/final-work";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

export const GET = route(async (_req, ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  return getFinal(getDb(), { userId: user.id, gameId: id });
});

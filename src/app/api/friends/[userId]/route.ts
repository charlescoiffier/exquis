import { route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { removeFriend } from "@/lib/services/friends";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

/** Retire un ami ou annule une demande envoyée. */
export const DELETE = route(async (_req, ctx) => {
  const user = await requireUser();
  const { userId } = await ctx.params;
  await removeFriend(getDb(), { userId: user.id, otherId: userId });
  return { ok: true };
});

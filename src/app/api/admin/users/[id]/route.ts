import { route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { deleteUser } from "@/lib/services/admin";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

/** Supprime un compte (administration) : ses contributions restent, anonymisées. */
export const DELETE = route(async (_req, ctx) => {
  const admin = await requireUser();
  const { id } = await ctx.params;
  await deleteUser(getDb(), { adminId: admin.id, userId: id });
  return { ok: true };
});

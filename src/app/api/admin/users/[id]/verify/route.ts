import { route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { verifyUserEmail } from "@/lib/services/admin";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

export const POST = route(async (_req, ctx) => {
  const admin = await requireUser();
  const { id } = await ctx.params;
  await verifyUserEmail(getDb(), { adminId: admin.id, userId: id });
  return { ok: true };
});

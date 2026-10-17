import { parseId, route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { deleteCommentAsAdmin } from "@/lib/services/admin";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

export const DELETE = route(async (_req, ctx) => {
  const admin = await requireUser();
  await deleteCommentAsAdmin(getDb(), { adminId: admin.id, commentId: await parseId(ctx) });
  return { ok: true };
});

import { parseId, route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { deleteWorkAsAdmin } from "@/lib/services/admin";
import { requireUser } from "@/lib/session";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";

/** Supprime définitivement une œuvre terminée, ses commentaires et ses images. */
export const DELETE = route(async (_req, ctx) => {
  const admin = await requireUser();
  await deleteWorkAsAdmin(getDb(), getStorage(), { adminId: admin.id, gameId: await parseId(ctx) });
  return { ok: true };
});

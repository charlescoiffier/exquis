import { parseId, route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { getModerationImage } from "@/lib/services/final-work";
import { requireModerator } from "@/lib/services/moderation";
import { requireUser } from "@/lib/session";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";

/** Image d'une œuvre signalée, pour la modération uniquement. */
export const GET = route(async (_req, ctx) => {
  const user = await requireUser();
  await requireModerator(getDb(), user.id);
  const png = await getModerationImage(getDb(), getStorage(), await parseId(ctx));
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" } });
});

import { route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { DomainError } from "@/lib/errors";
import { getPublicImage } from "@/lib/services/final-work";
import { PUBLIC_TOKEN_PATTERN } from "@/lib/services/sharing";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";

/** Image d'une œuvre partagée par lien public : sans connexion, mais seulement avec un jeton valide et activé. */
export const GET = route(async (_req, ctx) => {
  const { token } = await ctx.params;
  if (!PUBLIC_TOKEN_PATTERN.test(token)) throw new DomainError("not_found", "Lien introuvable.", 404);
  const png = await getPublicImage(getDb(), getStorage(), token);
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=300" } });
});

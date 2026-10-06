import { env } from "@/lib/env";
import { getStorage } from "@/lib/storage";
import { verifyToken } from "@/lib/storage/token";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const key = verifyToken(token, env().STORAGE_SECRET);
  if (!key) return new Response("Lien expiré ou invalide", { status: 403 });
  try {
    const data = await getStorage().get(key);
    return new Response(new Uint8Array(data), {
      headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=60" },
    });
  } catch {
    return new Response("Introuvable", { status: 404 });
  }
}

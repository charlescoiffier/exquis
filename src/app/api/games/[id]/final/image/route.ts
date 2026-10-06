import { route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { getFinalImage } from "@/lib/services/final-work";
import { requireUser } from "@/lib/session";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";

export const GET = route(async (req, ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const guides = url.searchParams.get("guides") === "1";
  const png = await getFinalImage(getDb(), getStorage(), { userId: user.id, gameId: id, guides });
  const headers: Record<string, string> = { "Content-Type": "image/png", "Cache-Control": "private, max-age=300" };
  if (url.searchParams.get("download") === "1") headers["Content-Disposition"] = `attachment; filename="exquis-${id}${guides ? "-jointures" : ""}.png"`;
  return new Response(new Uint8Array(png), { headers });
});

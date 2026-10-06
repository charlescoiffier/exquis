import { route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { DomainError } from "@/lib/errors";
import { MAX_PNG_BYTES } from "@/lib/images/strip";
import { getBoss, runEffects } from "@/lib/jobs/queue";
import { submitDrawing, submitText } from "@/lib/services/turns";
import { requireUser } from "@/lib/session";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";

export const POST = route(
  async (req, ctx) => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const type = req.headers.get("content-type") ?? "";
    let effects;
    if (type.startsWith("image/png")) {
      const declared = Number(req.headers.get("content-length") ?? 0);
      if (declared > MAX_PNG_BYTES) throw new DomainError("invalid_image", "Image trop volumineuse.", 413);
      effects = await submitDrawing(getDb(), getStorage(), { userId: user.id, gameId: id, png: Buffer.from(await req.arrayBuffer()) });
    } else {
      const body = (await req.json().catch(() => null)) as { text?: unknown } | null;
      if (typeof body?.text !== "string") throw new DomainError("invalid_text", "Texte manquant.", 400);
      effects = await submitText(getDb(), { userId: user.id, gameId: id, text: body.text });
    }
    await runEffects(await getBoss(), effects);
    return { ok: true };
  },
  { limit: { name: "submit", max: 60, windowMs: 3600_000 } },
);

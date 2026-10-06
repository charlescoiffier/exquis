import { fireEffects, parseId, readBodyLimited, readJson, route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { DomainError } from "@/lib/errors";
import { MAX_PNG_BYTES } from "@/lib/images/strip";
import { submitDrawing, submitText } from "@/lib/services/turns";
import { requireUser } from "@/lib/session";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";

export const POST = route(
  async (req, ctx) => {
    const user = await requireUser();
    const id = await parseId(ctx);
    const type = req.headers.get("content-type") ?? "";
    let effects;
    if (type.startsWith("image/png")) {
      effects = await submitDrawing(getDb(), getStorage(), { userId: user.id, gameId: id, png: await readBodyLimited(req, MAX_PNG_BYTES) });
    } else {
      const body = (await readJson(req)) as { text?: unknown } | null;
      if (typeof body?.text !== "string") throw new DomainError("invalid_text", "Texte manquant.", 400);
      effects = await submitText(getDb(), { userId: user.id, gameId: id, text: body.text });
    }
    await fireEffects(effects);
    return { ok: true };
  },
  { limit: { name: "submit", max: 60, windowMs: 3600_000 } },
);

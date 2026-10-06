import { parseId, readJson, route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { saveDraft } from "@/lib/services/turns";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

export const PUT = route(
  async (req, ctx) => {
    const user = await requireUser();
    const id = await parseId(ctx);
    await saveDraft(getDb(), { userId: user.id, gameId: id, content: await readJson(req) });
    return { ok: true };
  },
  { limit: { name: "draft", max: 600, windowMs: 3600_000 } },
);

import { route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { saveDraft } from "@/lib/services/turns";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

export const PUT = route(
  async (req, ctx) => {
    const user = await requireUser();
    const { id } = await ctx.params;
    await saveDraft(getDb(), { userId: user.id, gameId: id, content: await req.json() });
    return { ok: true };
  },
  { limit: { name: "draft", max: 600, windowMs: 3600_000 } },
);

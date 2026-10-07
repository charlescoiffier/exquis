import { z } from "zod";
import { parseId, readJson, route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { setPublicLink } from "@/lib/services/sharing";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

const body = z.object({ enabled: z.boolean() });

export const POST = route(
  async (req, ctx) => {
    const user = await requireUser();
    const { enabled } = body.parse(await readJson(req));
    return setPublicLink(getDb(), { userId: user.id, gameId: await parseId(ctx), enabled });
  },
  { limit: { name: "share", max: 20, windowMs: 3600_000 } },
);

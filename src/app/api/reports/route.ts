import { z } from "zod";
import { readJson, route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { createReport } from "@/lib/services/moderation";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

const body = z.object({
  targetType: z.enum(["comment", "work"]),
  targetId: z.string().uuid(),
  reason: z.string().max(40),
  details: z.string().max(1000).optional(),
});

export const POST = route(
  async (req) => {
    const user = await requireUser();
    await createReport(getDb(), { userId: user.id, ...body.parse(await readJson(req)) });
    return { ok: true };
  },
  { limit: { name: "report", max: 20, windowMs: 3600_000 } },
);

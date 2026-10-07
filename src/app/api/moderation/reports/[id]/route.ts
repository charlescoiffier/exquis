import { z } from "zod";
import { parseId, readJson, route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { resolveReport } from "@/lib/services/moderation";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

const body = z.object({ action: z.enum(["hide", "dismiss"]) });

export const POST = route(async (req, ctx) => {
  const user = await requireUser();
  await resolveReport(getDb(), { moderatorId: user.id, reportId: await parseId(ctx), action: body.parse(await readJson(req)).action });
  return { ok: true };
});

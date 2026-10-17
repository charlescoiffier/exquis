import { z } from "zod";
import { readJson, route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { setUserRole } from "@/lib/services/admin";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

const body = z.object({ role: z.enum(["player", "moderator"]) });

export const POST = route(async (req, ctx) => {
  const admin = await requireUser();
  const { id } = await ctx.params;
  await setUserRole(getDb(), { adminId: admin.id, userId: id, role: body.parse(await readJson(req)).role });
  return { ok: true };
});

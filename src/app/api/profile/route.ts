import { z } from "zod";
import { readJson, route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { updateProfile } from "@/lib/services/account";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

const body = z.object({ name: z.string().optional(), emailEnabled: z.boolean().optional() });

export const PUT = route(async (req) => {
  const user = await requireUser();
  await updateProfile(getDb(), user.id, body.parse(await readJson(req)));
  return { ok: true };
});

import { z } from "zod";
import { route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { profile } from "@/lib/db/schema";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

export const PUT = route(async (req) => {
  const user = await requireUser();
  const { emailEnabled } = z.object({ emailEnabled: z.boolean() }).parse(await req.json());
  await getDb()
    .insert(profile)
    .values({ userId: user.id, emailEnabled })
    .onConflictDoUpdate({ target: profile.userId, set: { emailEnabled } });
  return { ok: true };
});

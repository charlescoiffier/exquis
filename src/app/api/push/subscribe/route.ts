import { z } from "zod";
import { readJson, route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { pushConfigured } from "@/lib/env";
import { DomainError } from "@/lib/errors";
import { removeSubscription, saveSubscription } from "@/lib/services/push";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

const subscribe = z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) });
const unsubscribe = z.object({ endpoint: z.string().max(1000) });

/** Active les notifications sur cet appareil. */
export const POST = route(
  async (req) => {
    const user = await requireUser();
    if (!pushConfigured()) throw new DomainError("push_unavailable", "Les notifications sur téléphone ne sont pas configurées sur ce serveur.", 503);
    const b = subscribe.parse(await readJson(req));
    await saveSubscription(getDb(), { userId: user.id, endpoint: b.endpoint, p256dh: b.keys.p256dh, auth: b.keys.auth, userAgent: req.headers.get("user-agent") ?? undefined });
    return { ok: true };
  },
  { limit: { name: "push-subscribe", max: 30, windowMs: 3600_000 } },
);

/** Désactive les notifications sur cet appareil. */
export const DELETE = route(async (req) => {
  const user = await requireUser();
  await removeSubscription(getDb(), { userId: user.id, endpoint: unsubscribe.parse(await readJson(req)).endpoint });
  return { ok: true };
});

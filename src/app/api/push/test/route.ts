import { route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { getPushSender, sendTestPush } from "@/lib/services/push";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

/** Envoie une notification de test aux appareils du compte. */
export const POST = route(
  async () => {
    const user = await requireUser();
    const devices = await sendTestPush(getDb(), getPushSender(), user.id);
    return { sent: devices.filter((d) => d.ok).length, devices };
  },
  { limit: { name: "push-test", max: 10, windowMs: 3600_000 } },
);

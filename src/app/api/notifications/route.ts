import { route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { listNotifications, markAllRead } from "@/lib/services/notifications";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

export const GET = route(async () => {
  const user = await requireUser();
  return { notifications: await listNotifications(getDb(), user.id) };
});

export const POST = route(async () => {
  const user = await requireUser();
  await markAllRead(getDb(), user.id);
  return { ok: true };
});

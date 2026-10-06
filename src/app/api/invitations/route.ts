import { route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { createInvitation } from "@/lib/services/invitations";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

export const POST = route(async () => {
  const user = await requireUser();
  return { code: await createInvitation(getDb(), user.id) };
});

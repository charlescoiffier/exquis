import { route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { verifyAllEmails } from "@/lib/services/admin";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

export const POST = route(async () => {
  const admin = await requireUser();
  return { verified: await verifyAllEmails(getDb(), { adminId: admin.id }) };
});

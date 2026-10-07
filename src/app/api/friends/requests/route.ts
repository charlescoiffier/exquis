import { z } from "zod";
import { readJson, route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { DomainError } from "@/lib/errors";
import { sendFriendRequestByCode, sendFriendRequestToMetPlayer } from "@/lib/services/friends";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

const body = z.union([z.object({ code: z.string().max(40) }), z.object({ userId: z.string().max(100) })]);

/** Demande d'ami : par code ami, ou à un joueur rencontré. */
export const POST = route(
  async (req) => {
    const user = await requireUser();
    const parsed = body.safeParse(await readJson(req));
    if (!parsed.success) throw new DomainError("invalid_params", "Données invalides.", 400);
    return "code" in parsed.data
      ? sendFriendRequestByCode(getDb(), { userId: user.id, code: parsed.data.code })
      : sendFriendRequestToMetPlayer(getDb(), { userId: user.id, targetId: parsed.data.userId });
  },
  { limit: { name: "friend-request", max: 30, windowMs: 3600_000 } },
);

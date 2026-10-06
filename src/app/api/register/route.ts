import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db/client";
import { env } from "@/lib/env";
import { inviteContext } from "@/lib/invite-context";
import { claimInvitation, markInvitationUsed, releaseInvitation } from "@/lib/services/invitations";
import { z } from "zod";

export const runtime = "nodejs";

const body = z.object({
  name: z.string().trim().min(1).max(60),
  email: z.string().email(),
  password: z.string().min(10).max(128),
  invitationCode: z.string().optional(),
});

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Données invalides." }, { status: 400 });
  const { invitationCode, ...rest } = parsed.data;
  const db = getDb();
  const inviteOnly = env().REGISTRATION_MODE === "invite";

  let claimed = false;
  if (inviteOnly) {
    if (!invitationCode || !(await claimInvitation(db, invitationCode))) {
      return Response.json({ error: "Invitation invalide ou déjà utilisée." }, { status: 403 });
    }
    claimed = true;
  }
  try {
    const res = await inviteContext.run({ code: invitationCode ?? "" }, () =>
      auth.api.signUpEmail({ body: rest, asResponse: true }),
    );
    if (!res.ok) {
      if (claimed) await releaseInvitation(db, invitationCode!);
      return res;
    }
    if (claimed) {
      const data = (await res.clone().json()) as { user?: { id: string } };
      if (data.user) await markInvitationUsed(db, invitationCode!, data.user.id);
    }
    return res;
  } catch {
    if (claimed) await releaseInvitation(db, invitationCode!);
    return Response.json({ error: "Création du compte impossible." }, { status: 400 });
  }
}

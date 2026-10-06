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
  const ctx: { code: string; userId?: string } = { code: invitationCode ?? "" };
  let res: Response;
  try {
    res = await inviteContext.run(ctx, () => auth.api.signUpEmail({ body: rest, asResponse: true }));
  } catch {
    // Ne libère que si aucun compte n'a été créé par cette requête.
    if (claimed && !ctx.userId) await releaseInvitation(db, invitationCode!);
    else if (claimed) await markInvitationUsed(db, invitationCode!, ctx.userId!).catch(() => {});
    return Response.json({ error: "Création du compte impossible." }, { status: 400 });
  }
  if (claimed) {
    // Better Auth peut répondre 200 avec un faux utilisateur (email déjà pris) : seul un compte
    // réellement créé par cette requête (ctx.userId) consomme l'invitation. Réponse inchangée.
    if (ctx.userId) await markInvitationUsed(db, invitationCode!, ctx.userId);
    else await releaseInvitation(db, invitationCode!);
  }
  return res;
}

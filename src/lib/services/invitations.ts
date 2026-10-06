import { and, count, eq, gt, isNull } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { invitation } from "@/lib/db/schema";
import type { Db } from "@/lib/db/client";
import { DomainError } from "@/lib/errors";

export const MAX_OPEN_INVITATIONS = 5;
const INVITATION_TTL_MS = 7 * 86400_000;

export async function createInvitation(db: Db, createdBy: string | null, now = new Date()): Promise<string> {
  if (createdBy) {
    const [{ n }] = await db
      .select({ n: count() })
      .from(invitation)
      .where(and(eq(invitation.createdBy, createdBy), isNull(invitation.usedBy), gt(invitation.expiresAt, new Date())));
    if (n >= MAX_OPEN_INVITATIONS) throw new DomainError("invitation_limit", "Trop d'invitations en attente.", 429);
  }
  const code = randomBytes(9).toString("base64url");
  await db.insert(invitation).values({ code, createdBy, expiresAt: new Date(now.getTime() + INVITATION_TTL_MS) });
  return code;
}

/** Réclamation atomique : renvoie true pour un seul appelant. */
export async function claimInvitation(db: Db, code: string, now = new Date()): Promise<boolean> {
  const rows = await db
    .update(invitation)
    .set({ claimedAt: now })
    .where(and(eq(invitation.code, code), isNull(invitation.claimedAt), gt(invitation.expiresAt, now)))
    .returning({ code: invitation.code });
  return rows.length === 1;
}

export async function releaseInvitation(db: Db, code: string): Promise<void> {
  await db.update(invitation).set({ claimedAt: null }).where(and(eq(invitation.code, code), isNull(invitation.usedBy)));
}

export async function markInvitationUsed(db: Db, code: string, userId: string): Promise<void> {
  await db.update(invitation).set({ usedBy: userId }).where(eq(invitation.code, code));
}

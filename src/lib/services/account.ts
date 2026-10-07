import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { user } from "@/lib/db/auth-schema";
import { profile } from "@/lib/db/schema";
import { DomainError } from "@/lib/errors";

export const MAX_NAME_LENGTH = 60;

/** Modifie le nom affiché et/ou la préférence d'email d'un compte. Au moins un champ est requis. */
export async function updateProfile(db: Db, userId: string, patch: { name?: string; emailEnabled?: boolean }): Promise<void> {
  const name = patch.name?.trim();
  if (patch.name !== undefined && (!name || name.length > MAX_NAME_LENGTH)) {
    throw new DomainError("invalid_name", `Le nom doit faire entre 1 et ${MAX_NAME_LENGTH} caractères.`, 400);
  }
  if (name === undefined && patch.emailEnabled === undefined) throw new DomainError("invalid_params", "Rien à modifier.", 400);
  await db.transaction(async (tx) => {
    if (name !== undefined) await tx.update(user).set({ name, updatedAt: new Date() }).where(eq(user.id, userId));
    if (patch.emailEnabled !== undefined) {
      await tx
        .insert(profile)
        .values({ userId, emailEnabled: patch.emailEnabled })
        .onConflictDoUpdate({ target: profile.userId, set: { emailEnabled: patch.emailEnabled } });
    }
  });
}

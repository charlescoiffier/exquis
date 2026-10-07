import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { game, participant } from "@/lib/db/schema";
import { DomainError } from "@/lib/errors";

/** Forme d'un jeton public (24 octets aléatoires en base64url). */
export const PUBLIC_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

/** Jeton public d'une œuvre, visible des participants (null : pas de lien). */
export async function getShareState(db: Db, p: { userId: string; gameId: string }): Promise<{ token: string | null; isCreator: boolean }> {
  const [g] = await db.select().from(game).where(eq(game.id, p.gameId));
  if (!g) throw new DomainError("not_found", "Partie introuvable.", 404);
  const ps = await db.select({ userId: participant.userId }).from(participant).where(eq(participant.gameId, p.gameId));
  if (!ps.some((x) => x.userId === p.userId)) throw new DomainError("forbidden", "Œuvre non accessible.", 403);
  return { token: g.publicToken, isCreator: g.creatorId === p.userId };
}

/** Active (jeton conservé s'il existe déjà) ou révoque le lien public. Créateur seulement, parties terminées seulement. */
export async function setPublicLink(db: Db, p: { userId: string; gameId: string; enabled: boolean }): Promise<{ token: string | null }> {
  const [g] = await db.select().from(game).where(eq(game.id, p.gameId));
  if (!g) throw new DomainError("not_found", "Partie introuvable.", 404);
  if (g.creatorId !== p.userId) throw new DomainError("forbidden", "Seul le créateur de la partie gère le lien public.", 403);
  if (g.status !== "completed") throw new DomainError("game_not_completed", "Seule une œuvre terminée se partage.", 409);
  if (!p.enabled) {
    await db.update(game).set({ publicToken: null }).where(eq(game.id, g.id));
    return { token: null };
  }
  if (g.publicToken) return { token: g.publicToken };
  const token = randomBytes(24).toString("base64url");
  await db.update(game).set({ publicToken: token }).where(eq(game.id, g.id));
  return { token };
}

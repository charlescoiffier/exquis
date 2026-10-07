import { asc, eq } from "drizzle-orm";
import { canViewFinal } from "@/lib/access";
import type { Db } from "@/lib/db/client";
import { user } from "@/lib/db/auth-schema";
import { contribution, finalWork, game, participant, turn } from "@/lib/db/schema";
import { DomainError } from "@/lib/errors";
import { turnLabelOf } from "@/lib/format";
import { authorSegments } from "@/lib/images/geometry";
import { assembleDrawing, renderWithGuides } from "@/lib/images/strip";
import type { Storage } from "@/lib/storage";
import { queueNotification } from "./notifications";

const cleanKey = (id: string) => `games/${id}/final/clean.png`;
const guidesKey = (id: string) => `games/${id}/final/guides.png`;

export async function assembleFinalWork(db: Db, storage: Storage, gameId: string): Promise<void> {
  const [g] = await db.select().from(game).where(eq(game.id, gameId));
  if (!g || (g.status !== "completed" && g.status !== "cancelled")) return;
  const cancelled = g.status === "cancelled";
  const [existing] = await db.select().from(finalWork).where(eq(finalWork.gameId, gameId));
  if (existing) return;

  if (g.type === "drawing") {
    const rows = await db
      .select({ imageKey: contribution.imageKey })
      .from(contribution)
      .innerJoin(turn, eq(contribution.turnId, turn.id))
      .where(eq(turn.gameId, gameId))
      .orderBy(asc(turn.rank));
    // Partie annulée : seules les contributions existantes (tours « done ») sont assemblées, éventuellement aucune.
    if (rows.length === 0) {
      await db.insert(finalWork).values({ gameId }).onConflictDoNothing();
    } else {
      const pngs = await Promise.all(rows.map((r) => storage.get(r.imageKey!)));
      const out = await assembleDrawing(pngs, g.direction!);
      await storage.put(cleanKey(gameId), out.image, "image/png");
      await db.insert(finalWork).values({ gameId, imageKey: cleanKey(gameId), width: out.width, height: out.height, joints: out.joints }).onConflictDoNothing();
    }
  } else {
    await db.insert(finalWork).values({ gameId }).onConflictDoNothing();
  }
  // Partie annulée : game_cancelled est déjà parti, pas de work_ready.
  if (cancelled) return;
  const ps = await db.select().from(participant).where(eq(participant.gameId, gameId));
  await db.transaction(async (tx) => {
    for (const p of ps) await queueNotification(tx, { userId: p.userId, type: "work_ready", gameId });
  });
}

async function authorize(db: Db, userId: string, gameId: string) {
  const [g] = await db.select().from(game).where(eq(game.id, gameId));
  if (!g) throw new DomainError("not_found", "Partie introuvable.", 404);
  const ps = await db.select({ userId: participant.userId }).from(participant).where(eq(participant.gameId, gameId));
  if (!canViewFinal(g, ps.map((p) => p.userId), userId)) throw new DomainError("forbidden", "Œuvre non accessible.", 403);
  if (g.hiddenAt) throw new DomainError("work_hidden", "Cette œuvre a été masquée par la modération.", 403);
  return g;
}

export type FinalView = {
  type: "drawing" | "text";
  name: string;
  ready: boolean;
  cancelled: boolean;
  direction: "down" | "right" | null;
  width: number | null;
  height: number | null;
  joints: { start: number; end: number }[];
  /** Zone dessinée par chaque auteur le long de l'axe (dessin uniquement ; vide pour le texte). */
  segments: { rank: number; author: string; label: string; start: number; end: number }[];
  contributions: { rank: number; author: string; label: string; text: string | null }[];
  /** Rappel des informations de la partie (page de l'œuvre). */
  info: {
    creatorName: string;
    createdAt: string;
    completedAt: string | null;
    turns: number;
    turnDurationSeconds: number;
    language: string | null;
    theme: string | null;
    participants: string[];
  };
};

export async function getFinal(db: Db, p: { userId: string; gameId: string }): Promise<FinalView> {
  return buildFinalView(db, await authorize(db, p.userId, p.gameId));
}

async function buildFinalView(db: Db, g: typeof game.$inferSelect): Promise<FinalView> {
  const [fw] = await db.select().from(finalWork).where(eq(finalWork.gameId, g.id));
  const raw = await db
    .select({ rank: turn.rank, author: user.name, text: contribution.text })
    .from(contribution)
    .innerJoin(turn, eq(contribution.turnId, turn.id))
    .innerJoin(user, eq(user.id, contribution.userId))
    .where(eq(turn.gameId, g.id))
    .orderBy(asc(turn.rank));
  const rows = raw.map((r) => ({ ...r, label: turnLabelOf(g.turnLabels, r.rank) }));
  const [creator] = await db.select({ name: user.name }).from(user).where(eq(user.id, g.creatorId));
  const people = await db
    .select({ name: user.name })
    .from(participant)
    .innerJoin(user, eq(user.id, participant.userId))
    .where(eq(participant.gameId, g.id))
    .orderBy(asc(participant.joinedAt));
  return {
    type: g.type,
    name: g.name,
    ready: !!fw,
    cancelled: g.status === "cancelled",
    direction: g.direction,
    width: fw?.width ?? null,
    height: fw?.height ?? null,
    joints: fw?.joints ?? [],
    segments:
      g.type === "drawing"
        ? authorSegments(rows.length).map((s, i) => ({ ...s, author: rows[i].author, label: rows[i].label }))
        : [],
    contributions: rows,
    info: {
      creatorName: creator?.name ?? "",
      createdAt: g.createdAt.toISOString(),
      completedAt: g.completedAt ? g.completedAt.toISOString() : null,
      turns: g.turns,
      turnDurationSeconds: g.turnDurationSeconds,
      language: g.language,
      theme: g.theme,
      participants: people.map((x) => x.name),
    },
  };
}

export async function getFinalImage(db: Db, storage: Storage, p: { userId: string; gameId: string; guides: boolean }): Promise<Buffer> {
  const g = await authorize(db, p.userId, p.gameId);
  const [fw] = await db.select().from(finalWork).where(eq(finalWork.gameId, g.id));
  if (!fw?.imageKey) throw new DomainError("not_ready", "L'œuvre est en cours d'assemblage.", 404);
  if (!p.guides) return storage.get(fw.imageKey);
  if (await storage.exists(guidesKey(g.id))) return storage.get(guidesKey(g.id));
  const clean = await storage.get(fw.imageKey);
  const out = await renderWithGuides(clean, g.direction!, fw.width!, fw.height!, fw.joints ?? []);
  await storage.put(guidesKey(g.id), out, "image/png");
  return out;
}

/** Œuvre d'une partie terminée à partir de son jeton public (sans connexion) ; introuvable si le lien n'est pas activé. */
export async function getPublicFinal(db: Db, token: string): Promise<FinalView> {
  const [g] = await db.select().from(game).where(eq(game.publicToken, token));
  if (!g || g.status !== "completed" || g.hiddenAt) throw new DomainError("not_found", "Lien introuvable.", 404);
  return buildFinalView(db, g);
}

export async function getPublicImage(db: Db, storage: Storage, token: string): Promise<Buffer> {
  const [g] = await db.select().from(game).where(eq(game.publicToken, token));
  if (!g || g.status !== "completed" || g.hiddenAt) throw new DomainError("not_found", "Lien introuvable.", 404);
  const [fw] = await db.select().from(finalWork).where(eq(finalWork.gameId, g.id));
  if (!fw?.imageKey) throw new DomainError("not_ready", "L'œuvre est en cours d'assemblage.", 404);
  return storage.get(fw.imageKey);
}

/** Image d'une œuvre pour la modération (même masquée) ; le contrôle du rôle est fait par l'appelant. */
export async function getModerationImage(db: Db, storage: Storage, gameId: string): Promise<Buffer> {
  const [fw] = await db.select().from(finalWork).where(eq(finalWork.gameId, gameId));
  if (!fw?.imageKey) throw new DomainError("not_found", "Image introuvable.", 404);
  return storage.get(fw.imageKey);
}

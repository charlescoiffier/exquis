import { asc, eq } from "drizzle-orm";
import { canViewFinal } from "@/lib/access";
import type { Db } from "@/lib/db/client";
import { user } from "@/lib/db/auth-schema";
import { contribution, finalWork, game, participant, turn } from "@/lib/db/schema";
import { DomainError } from "@/lib/errors";
import { assembleDrawing, renderWithGuides } from "@/lib/images/strip";
import type { Storage } from "@/lib/storage";
import { queueNotification } from "./notifications";

const cleanKey = (id: string) => `games/${id}/final/clean.png`;
const guidesKey = (id: string) => `games/${id}/final/guides.png`;

export async function assembleFinalWork(db: Db, storage: Storage, gameId: string): Promise<void> {
  const [g] = await db.select().from(game).where(eq(game.id, gameId));
  if (!g || g.status !== "completed") return;
  const [existing] = await db.select().from(finalWork).where(eq(finalWork.gameId, gameId));
  if (existing) return;

  if (g.type === "drawing") {
    const rows = await db
      .select({ imageKey: contribution.imageKey })
      .from(contribution)
      .innerJoin(turn, eq(contribution.turnId, turn.id))
      .where(eq(turn.gameId, gameId))
      .orderBy(asc(turn.rank));
    const pngs = await Promise.all(rows.map((r) => storage.get(r.imageKey!)));
    const out = await assembleDrawing(pngs, g.direction!);
    await storage.put(cleanKey(gameId), out.image, "image/png");
    await db.insert(finalWork).values({ gameId, imageKey: cleanKey(gameId), width: out.width, height: out.height, joints: out.joints }).onConflictDoNothing();
  } else {
    await db.insert(finalWork).values({ gameId }).onConflictDoNothing();
  }
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
  return g;
}

export type FinalView = {
  type: "drawing" | "text";
  name: string;
  ready: boolean;
  direction: "down" | "right" | null;
  width: number | null;
  height: number | null;
  joints: { start: number; end: number }[];
  contributions: { rank: number; author: string; text: string | null }[];
};

export async function getFinal(db: Db, p: { userId: string; gameId: string }): Promise<FinalView> {
  const g = await authorize(db, p.userId, p.gameId);
  const [fw] = await db.select().from(finalWork).where(eq(finalWork.gameId, g.id));
  const rows = await db
    .select({ rank: turn.rank, author: user.name, text: contribution.text })
    .from(contribution)
    .innerJoin(turn, eq(contribution.turnId, turn.id))
    .innerJoin(user, eq(user.id, contribution.userId))
    .where(eq(turn.gameId, g.id))
    .orderBy(asc(turn.rank));
  return {
    type: g.type,
    name: g.name,
    ready: !!fw,
    direction: g.direction,
    width: fw?.width ?? null,
    height: fw?.height ?? null,
    joints: fw?.joints ?? [],
    contributions: rows,
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

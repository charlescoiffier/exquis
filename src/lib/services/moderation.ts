import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { user } from "@/lib/db/auth-schema";
import { comment, contribution, game, participant, profile, report, turn } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { DomainError } from "@/lib/errors";
import { REPORT_REASONS } from "@/lib/report-reasons";
import { queueNotification } from "./notifications";

export { REPORT_REASONS };
export const MAX_REPORT_DETAILS = 500;

export type ReportTarget = "comment" | "work";

/** Administrateur : rôle « admin », ou adresse listée dans ADMIN_EMAILS. Il a aussi tous les droits d'un modérateur. */
export async function isAdmin(db: Db, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ role: profile.role, email: user.email })
    .from(user)
    .leftJoin(profile, eq(profile.userId, user.id))
    .where(eq(user.id, userId));
  if (!row) return false;
  if (row.role === "admin") return true;
  const listed = env().ADMIN_EMAILS.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  return listed.includes(row.email.toLowerCase());
}

export async function isModerator(db: Db, userId: string): Promise<boolean> {
  const [p] = await db.select({ role: profile.role }).from(profile).where(eq(profile.userId, userId));
  return p?.role === "moderator" || (await isAdmin(db, userId));
}

export async function requireAdmin(db: Db, userId: string): Promise<void> {
  if (!(await isAdmin(db, userId))) throw new DomainError("forbidden", "Réservé à l'administration.", 403);
}

export async function requireModerator(db: Db, userId: string): Promise<void> {
  if (!(await isModerator(db, userId))) throw new DomainError("forbidden", "Réservé à la modération.", 403);
}

/** Change le rôle d'un compte (script d'administration) : « player » ou « moderator ». */
export async function setRole(db: Db, userId: string, role: "player" | "moderator" | "admin"): Promise<void> {
  await db.insert(profile).values({ userId, role }).onConflictDoUpdate({ target: profile.userId, set: { role } });
}

async function isParticipant(db: Db, userId: string, gameId: string): Promise<boolean> {
  const [row] = await db.select({ id: participant.id }).from(participant).where(and(eq(participant.gameId, gameId), eq(participant.userId, userId)));
  return !!row;
}

/** Signale un commentaire (tout participant de la partie, sauf son auteur) ou une œuvre terminée (tout participant). */
export async function createReport(
  db: Db,
  p: { userId: string; targetType: ReportTarget; targetId: string; reason: string; details?: string },
): Promise<void> {
  if (!REPORT_REASONS.some((r) => r.id === p.reason)) throw new DomainError("invalid_reason", "Motif inconnu.", 400);
  const details = p.details?.trim() || null;
  if (details && details.length > MAX_REPORT_DETAILS) throw new DomainError("details_too_long", `Précisions : ${MAX_REPORT_DETAILS} caractères au plus.`, 400);
  let gameId: string;
  if (p.targetType === "comment") {
    const [c] = await db.select().from(comment).where(eq(comment.id, p.targetId));
    if (!c || c.hiddenAt) throw new DomainError("not_found", "Commentaire introuvable.", 404);
    if (c.userId === p.userId) throw new DomainError("own_content", "Vous ne pouvez pas signaler votre propre commentaire.", 400);
    gameId = c.gameId;
  } else {
    const [g] = await db.select().from(game).where(eq(game.id, p.targetId));
    if (!g || g.hiddenAt || g.status !== "completed") throw new DomainError("not_found", "Œuvre introuvable.", 404);
    gameId = g.id;
  }
  if (!(await isParticipant(db, p.userId, gameId))) throw new DomainError("forbidden", "Seuls les participants peuvent signaler.", 403);
  const inserted = await db
    .insert(report)
    .values({ targetType: p.targetType, targetId: p.targetId, reporterId: p.userId, reason: p.reason, details })
    .onConflictDoNothing()
    .returning({ id: report.id });
  if (inserted.length === 0) throw new DomainError("already_reported", "Vous avez déjà signalé ce contenu.", 409);
}

export type ReportItem = {
  id: string;
  targetType: ReportTarget;
  targetId: string;
  reason: string;
  details: string | null;
  createdAt: Date;
  reporterName: string;
  gameId: string;
  gameName: string;
  /** Texte du commentaire, ou résumé de l'œuvre. */
  excerpt: string;
  authorName: string;
  isDrawing: boolean;
};

/** Signalements à traiter, les plus anciens d'abord. */
export async function listOpenReports(db: Db, limit = 50): Promise<ReportItem[]> {
  const rows = await db
    .select({ r: report, reporterName: user.name })
    .from(report)
    .innerJoin(user, eq(user.id, report.reporterId))
    .where(eq(report.status, "open"))
    .orderBy(asc(report.createdAt))
    .limit(limit);
  const out: ReportItem[] = [];
  for (const { r, reporterName } of rows) {
    if (r.targetType === "comment") {
      const [c] = await db
        .select({ body: comment.body, gameId: comment.gameId, gameName: game.name, author: user.name })
        .from(comment)
        .innerJoin(game, eq(game.id, comment.gameId))
        .innerJoin(user, eq(user.id, comment.userId))
        .where(eq(comment.id, r.targetId));
      if (c) out.push({ id: r.id, targetType: "comment", targetId: r.targetId, reason: r.reason, details: r.details, createdAt: r.createdAt, reporterName, gameId: c.gameId, gameName: c.gameName, excerpt: c.body, authorName: c.author, isDrawing: false });
    } else {
      const [g] = await db
        .select({ id: game.id, name: game.name, type: game.type, theme: game.theme, creator: user.name })
        .from(game)
        .innerJoin(user, eq(user.id, game.creatorId))
        .where(eq(game.id, r.targetId));
      if (!g) continue;
      let excerpt = g.theme ? `Thème : ${g.theme}` : "";
      if (g.type === "text") {
        const texts = await db
          .select({ text: contribution.text })
          .from(contribution)
          .innerJoin(turn, eq(turn.id, contribution.turnId))
          .where(eq(turn.gameId, g.id))
          .orderBy(asc(turn.rank));
        excerpt = texts.map((t) => t.text ?? "").join("\n\n").slice(0, 600);
      }
      out.push({ id: r.id, targetType: "work", targetId: r.targetId, reason: r.reason, details: r.details, createdAt: r.createdAt, reporterName, gameId: g.id, gameName: g.name, excerpt, authorName: g.creator, isDrawing: g.type === "drawing" });
    }
  }
  return out;
}

/**
 * Traite un signalement. `hide` masque le contenu (commentaire : n'apparaît plus ; œuvre : plus visible de personne, lien
 * public retiré) et prévient les personnes concernées ; `dismiss` rejette le signalement. Tous les signalements ouverts sur
 * le même contenu sont clos avec lui.
 */
export async function resolveReport(db: Db, p: { moderatorId: string; reportId: string; action: "hide" | "dismiss"; now?: Date }): Promise<void> {
  await requireModerator(db, p.moderatorId);
  const now = p.now ?? new Date();
  await db.transaction(async (tx) => {
    const [r] = await tx.select().from(report).where(eq(report.id, p.reportId)).for("update");
    if (!r || r.status !== "open") throw new DomainError("not_found", "Signalement introuvable ou déjà traité.", 404);
    if (p.action === "hide") {
      if (r.targetType === "comment") {
        const [c] = await tx.update(comment).set({ hiddenAt: now }).where(eq(comment.id, r.targetId)).returning({ userId: comment.userId, gameId: comment.gameId });
        if (c) await queueNotification(tx, { userId: c.userId, type: "comment_hidden", gameId: c.gameId, suffix: r.targetId, inAppOnly: true });
      } else {
        await tx.update(game).set({ hiddenAt: now, publicToken: null }).where(eq(game.id, r.targetId));
        const ps = await tx.select({ userId: participant.userId }).from(participant).where(eq(participant.gameId, r.targetId));
        for (const part of ps) await queueNotification(tx, { userId: part.userId, type: "work_hidden", gameId: r.targetId, inAppOnly: true });
      }
    }
    await tx
      .update(report)
      .set({ status: p.action === "hide" ? "resolved" : "dismissed", resolvedBy: p.moderatorId, resolvedAt: now })
      .where(and(eq(report.targetType, r.targetType), eq(report.targetId, r.targetId), eq(report.status, "open")));
  });
}

/** Nombre de signalements en attente (pastille de la page de modération). */
export async function countOpenReports(db: Db): Promise<number> {
  const rows = await db.select({ id: report.id }).from(report).where(eq(report.status, "open"));
  return rows.length;
}


import { z } from "zod";
import { parseId, route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { DomainError } from "@/lib/errors";
import { deleteComment } from "@/lib/services/comments";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

export const DELETE = route(async (_req, ctx) => {
  const user = await requireUser();
  const gameId = await parseId(ctx);
  const commentId = z.string().uuid().safeParse((await ctx.params).commentId);
  if (!commentId.success) throw new DomainError("not_found", "Commentaire introuvable.", 404);
  await deleteComment(getDb(), { userId: user.id, gameId, commentId: commentId.data });
  return { ok: true };
});

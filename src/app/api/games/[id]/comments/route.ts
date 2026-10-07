import { z } from "zod";
import { parseId, readJson, route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { addComment, listComments } from "@/lib/services/comments";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

export const GET = route(async (_req, ctx) => {
  const user = await requireUser();
  return { comments: await listComments(getDb(), { userId: user.id, gameId: await parseId(ctx) }) };
});

const body = z.object({ body: z.string() });

export const POST = route(
  async (req, ctx) => {
    const user = await requireUser();
    const { body: text } = body.parse(await readJson(req));
    return addComment(getDb(), { userId: user.id, gameId: await parseId(ctx), body: text });
  },
  { limit: { name: "comment", max: 30, windowMs: 3600_000 } },
);

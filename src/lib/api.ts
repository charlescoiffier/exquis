import { z, ZodError } from "zod";
import { DomainError } from "@/lib/errors";
import { createRateLimiter } from "@/lib/rate-limit";
import { requireUser } from "@/lib/session";

export function toErrorResponse(err: unknown): Response {
  if (err instanceof DomainError) return Response.json({ error: err.message, code: err.code }, { status: err.status });
  if (err instanceof ZodError) return Response.json({ error: "Données invalides.", code: "invalid_params" }, { status: 400 });
  console.error(err);
  return Response.json({ error: "Erreur interne.", code: "internal" }, { status: 500 });
}

type Ctx = { params: Promise<Record<string, string>> };
type Opts = { limit?: { name: string; max: number; windowMs: number } };
const limiters = new Map<string, ReturnType<typeof createRateLimiter>>();

export function route(handler: (req: Request, ctx: Ctx) => Promise<unknown>, opts: Opts = {}) {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    try {
      if (opts.limit) {
        const user = await requireUser();
        let rl = limiters.get(opts.limit.name);
        if (!rl) limiters.set(opts.limit.name, (rl = createRateLimiter(opts.limit)));
        if (!rl.check(user.id)) throw new DomainError("rate_limited", "Trop de requêtes, réessayez plus tard.", 429);
      }
      const out = await handler(req, ctx);
      return out instanceof Response ? out : Response.json(out);
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}

export async function readJson(req: Request, opts: { allowEmpty?: boolean } = {}): Promise<unknown> {
  const text = await req.text();
  if (!text.trim()) {
    if (opts.allowEmpty) return {};
    throw new DomainError("invalid_json", "Corps JSON invalide.", 400);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new DomainError("invalid_json", "Corps JSON invalide.", 400);
  }
}

const tokenBody = z.object({ token: z.string().optional() });

/** Corps optionnel `{ token? }` : vide => {}, JSON malformé ou invalide => 400. */
export async function readTokenBody(req: Request): Promise<{ token?: string }> {
  const raw = await readJson(req, { allowEmpty: true });
  const parsed = tokenBody.safeParse(raw ?? {});
  if (!parsed.success) throw new DomainError("invalid_json", "Corps JSON invalide.", 400);
  return parsed.data;
}

export async function readBodyLimited(req: Request, maxBytes: number): Promise<Buffer> {
  const tooBig = () => new DomainError("invalid_image", "Image trop volumineuse.", 413);
  const declaredHeader = req.headers.get("content-length");
  if (declaredHeader !== null) {
    const declared = Number(declaredHeader);
    if (!Number.isFinite(declared) || declared < 0) throw new DomainError("invalid_request", "En-tête Content-Length invalide.", 400);
    if (declared > maxBytes) throw tooBig();
  }
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw tooBig();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

const uuid = z.string().uuid();

export async function parseId(ctx: Ctx): Promise<string> {
  const { id } = await ctx.params;
  const parsed = uuid.safeParse(id);
  if (!parsed.success) throw new DomainError("not_found", "Introuvable.", 404);
  return parsed.data;
}

/** Exécute les effets après commit : ne lève jamais (le résultat déjà commité doit être renvoyé). */
export async function fireEffects(effects: import("@/lib/effects").Effect[]): Promise<void> {
  if (!effects.length) return;
  try {
    const { getBoss, runEffectsWithRetry } = await import("@/lib/jobs/queue");
    await runEffectsWithRetry(await getBoss(), effects);
  } catch (err) {
    console.error("effets non exécutés", err);
  }
}

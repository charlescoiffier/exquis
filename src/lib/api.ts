import { ZodError } from "zod";
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

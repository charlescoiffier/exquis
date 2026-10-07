import { appendFile, mkdir } from "node:fs/promises";
import { z } from "zod";
import { readJson, route } from "@/lib/api";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

const num = z.number().finite();
const body = z.object({
  activeSeconds: num,
  eventsPerSecond: num,
  framesPerSecond: num,
  msPerFrame: num,
  longTasks: num,
  dpr: num,
  viewport: z.string().max(40),
  canvasCssWidth: num,
  liveScale: num.optional(),
  userAgent: z.string().max(300),
  page: z.string().max(200),
  mode: z.enum(["layers", "direct"]).optional(),
});

/**
 * Mesures de fluidité du dessin envoyées par l'éditeur quand la page est ouverte avec `?perf=1` : moyennes sur les secondes
 * où l'on a dessiné. Écrites dans la sortie du serveur et dans `.perf/reports.jsonl` (ignoré par git) pour analyse.
 */
export const POST = route(
  async (req) => {
    const user = await requireUser();
    const report = { at: new Date().toISOString(), userId: user.id, ...body.parse(await readJson(req)) };
    const line = JSON.stringify(report);
    console.log(`[perf] ${line}`);
    try {
      await mkdir(".perf", { recursive: true });
      await appendFile(".perf/reports.jsonl", `${line}\n`);
    } catch (e) {
      console.error("[perf] écriture impossible", e);
    }
    return { ok: true };
  },
  { limit: { name: "perf", max: 120, windowMs: 3600_000 } },
);

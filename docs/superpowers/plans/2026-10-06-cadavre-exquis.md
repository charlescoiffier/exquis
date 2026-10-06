# Cadavre exquis web : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire l'application web de cadavre exquis (dessin et texte), asynchrone, sur invitation, décrite dans la spec.

**Architecture:** Monolithe TypeScript Next.js (App Router) + un processus worker (pg-boss) partageant le même code. Les règles métier vivent dans `src/lib/**` (fonctions pures + services prenant un `Db`), les routes API et pages sont des couches minces. Le filtrage de ce que voit chaque joueur est fait exclusivement côté serveur ; les images sont dans un stockage privé servi par URL signées.

**Tech Stack:** Next.js 15, TypeScript, PostgreSQL 16, Drizzle ORM (+ drizzle-kit), Better Auth, pg-boss 10, sharp, zod, perfect-freehand, Vitest, Playwright, Resend (HTTP), S3 (R2/B2).

**Spec:** `docs/superpowers/specs/2026-10-06-cadavre-exquis-design.md`

## Choix techniques tranchés (spec §13)

- Next.js (pas SvelteKit), Drizzle (pas Prisma), Better Auth (pas Auth.js), pg-boss (pas Graphile Worker).
- Canvas : **1200×1600 px** pour le sens `down`, **1600×1200 px** pour `right`. Bande de transition : **160 px** (10 % de 1600).
- Tolérance de soumission après l'échéance : **5 secondes** (`SUBMIT_GRACE_MS`).
- Google OAuth est **reporté** à l'ouverture des inscriptions (en mode invitation, toute création de compte passe par `/api/register`).

## Global Constraints

- 2 à 8 participants et autant de tours par partie ; durée de tour de 30 s à 604800 s (7 jours).
- Types de partie : `drawing` ou `text`. Statuts de partie : `open`, `in_progress`, `completed`, `cancelled`. Statuts de tour : `pending`, `active`, `done`, `expired`, `open_call`.
- Plafond de remises en jeu par tour : 2. Limite de parties actives par joueur : 5. Limite de parties créées par jour : 10.
- **Dernier tour expiré** : la partie n'est pas annulée. Le tour passe en `open_call` (appel à participation, sans joueur assigné ni échéance) et la partie apparaît sur l'accueil dans une section « Appels à participation » avec un logo spécial (📣). Tout utilisateur qui n'est pas déjà participant peut reprendre ce tour ; s'il le laisse expirer à son tour, l'appel est relancé sans limite de tentatives.
- Aucun joueur ne reçoit jamais l'œuvre en cours : seulement la bande (dessin) ou l'extrait (texte) du tour précédent. Aucune URL publique vers le stockage : URL signées de 300 s maximum.
- Les guides pointillés ne sont jamais incrustés dans les images stockées ; l'image assemblée « clean » est la référence.
- Emails uniquement si la durée du tour est ≥ 300 s et que le joueur n'a pas désactivé l'email. Rappel envoyé à 75 % du temps écoulé, seulement pour les tours ≥ 120 s (afin de garantir au moins 30 s de préavis).
- Inscription sur invitation par défaut (`REGISTRATION_MODE=invite`), réglage `open` pour ouvrir plus tard.
- Tests : Vitest sur une vraie base PostgreSQL (`exquis_test`), pas de mock de la base.
- Les messages de commit des tâches se terminent par la ligne `Co-Authored-By` demandée par la session.

## Review Focus

Cas implicites de la spec, chacun couvert par un test dans la tâche indiquée :
1. Fichier envoyé qui n'est pas un PNG, trop volumineux ou de mauvaises dimensions : refusé avec `invalid_image`, rien n'est stocké (tâches 3 et 8).
2. Texte vide ou fait d'espaces, avec accents/emoji, ou **sans saut de paragraphe** (le « dernier paragraphe » serait alors tout le texte) : comptage correct et extrait plafonné à 150 mots (tâche 2).
3. Double clic sur « Envoyer » ou deux requêtes simultanées : une seule contribution, la seconde reçoit `not_your_turn` (tâche 8).
4. Deux joueurs prennent simultanément le dernier siège : un seul réussit, l'autre reçoit un 409 (`game_full` ou `game_not_open` selon qu'il voit la partie déjà démarrée) (tâche 7).
5. Soumission juste après l'échéance (dans la tolérance) acceptée, après la tolérance refusée, et job d'expiration sur un tour déjà soumis sans effet (tâche 8).
6. Deux volontaires qui reprennent simultanément l'appel à participation : un seul réussit ; un participant existant ne peut pas le reprendre ; un appel non repris n'est pas touché par le balayage (tâche 8).

---

## Structure des fichiers

```
docker-compose.yml, docker/init.sql, .env.example, drizzle.config.ts, vitest.config.ts
scripts/create-invite.ts
src/worker.ts
src/lib/env.ts, errors.ts, format.ts, effects.ts, session.ts, access.ts, rate-limit.ts, api.ts
src/lib/domain/text.ts, game-rules.ts, expiry.ts
src/lib/images/geometry.ts, strip.ts
src/lib/db/client.ts, schema.ts, auth-schema.ts
src/lib/storage/index.ts, memory.ts, local.ts, s3.ts, token.ts
src/lib/auth.ts, invite-context.ts
src/lib/services/invitations.ts, games.ts, turns.ts, notifications.ts, final-work.ts
src/lib/notifications/mailer.ts, render.ts
src/lib/jobs/queue.ts, handlers.ts
src/app/api/**/route.ts
src/app/(pages) : login, register, page.tsx (lobby), games/new, games/[id], games/[id]/final, inbox
src/components/ : JoinButton, NewGameForm, TurnEditor, TextTurn, DrawingEditor, FinalViewer, Countdown
src/lib/drawing/ops.ts (opérations de dessin, pot de peinture)
tests/** (miroir des modules), tests/helpers/**, e2e/**
Dockerfile, README.md
```

---

### Task 1: Scaffold, outillage et base de données locale

**Files:**
- Create: `docker-compose.yml`, `docker/init.sql`, `.env.example`, `vitest.config.ts`, `src/lib/env.ts`, `src/lib/errors.ts`, `tests/config.ts`
- Modify: `package.json` (scripts), `.gitignore`

**Interfaces:**
- Produces: `env(): Env` (variables validées, mémoïsées), `DomainError(code, message, status)` utilisés par toutes les tâches suivantes.

- [ ] **Step 1: Générer le projet Next.js**

```bash
cd /Users/charlescoiffier/dev/exquis
npx create-next-app@latest . --ts --app --src-dir --no-tailwind --eslint --use-npm --import-alias "@/*" --yes
npm i drizzle-orm postgres better-auth "pg-boss@^10" sharp zod perfect-freehand @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
npm i -D drizzle-kit vitest tsx dotenv @playwright/test
```
Expected: `package.json` créé, `src/app/page.tsx` présent. Si `create-next-app` refuse le dossier non vide, le lancer dans `/tmp/exquis-scaffold` puis copier tout sauf `.git` et `docs`.

- [ ] **Step 2: Base PostgreSQL locale**

`docker-compose.yml` :
```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: exquis
      POSTGRES_PASSWORD: exquis
      POSTGRES_DB: exquis
    ports: ["5432:5432"]
    volumes:
      - dbdata:/var/lib/postgresql/data
      - ./docker/init.sql:/docker-entrypoint-initdb.d/init.sql
volumes:
  dbdata:
```
`docker/init.sql` :
```sql
CREATE DATABASE exquis_test;
```
Run: `docker compose up -d db` puis `docker compose exec db psql -U exquis -l`
Expected: les bases `exquis` et `exquis_test` sont listées. (Si le volume existait déjà : `docker compose exec db psql -U exquis -c "CREATE DATABASE exquis_test"`.)

- [ ] **Step 3: Erreurs de domaine et variables d'environnement**

`src/lib/errors.ts` :
```ts
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
```
`src/lib/env.ts` :
```ts
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default("http://localhost:3000"),
  BETTER_AUTH_SECRET: z.string().min(16),
  REGISTRATION_MODE: z.enum(["invite", "open"]).default("invite"),
  REQUIRE_EMAIL_VERIFICATION: z.enum(["true", "false"]).default("true"),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_DIR: z.string().default(".storage"),
  STORAGE_SECRET: z.string().min(16),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().default("Exquis <no-reply@localhost>"),
});

export type Env = z.infer<typeof schema>;
let cached: Env | undefined;
export function env(): Env {
  return (cached ??= schema.parse(process.env));
}
```
`.env.example` :
```
DATABASE_URL=postgres://exquis:exquis@localhost:5432/exquis
APP_URL=http://localhost:3000
BETTER_AUTH_SECRET=change-me-change-me-change-me
STORAGE_SECRET=change-me-change-me-change-me
REGISTRATION_MODE=invite
REQUIRE_EMAIL_VERIFICATION=false
STORAGE_DRIVER=local
```
Run: `cp .env.example .env.local`

- [ ] **Step 4: Configuration Vitest**

`tests/config.ts` :
```ts
export const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://exquis:exquis@localhost:5432/exquis_test";
```
`vitest.config.ts` :
```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 20000,
    globalSetup: ["tests/global-setup.ts"],
    env: {
      BETTER_AUTH_SECRET: "test-secret-test-secret-test",
      STORAGE_SECRET: "test-storage-secret-test-secret",
      DATABASE_URL: "postgres://exquis:exquis@localhost:5432/exquis_test",
    },
  },
});
```
`tests/global-setup.ts` sera créé à la tâche 4 ; pour l'instant le créer vide : `export default async function setup() {}`.

Ajouter dans `package.json` les scripts :
```json
"test": "vitest run",
"db:generate": "drizzle-kit generate",
"db:migrate": "tsx src/lib/db/migrate.ts",
"worker": "tsx src/worker.ts",
"typecheck": "tsc --noEmit"
```
Ajouter à `.gitignore` : `.storage/`, `.env.local`.

- [ ] **Step 5: Vérifier et commiter**

Run: `npx vitest run --passWithNoTests && npm run typecheck`
Expected: pas d'erreur.
```bash
git add -A && git commit -m "chore: scaffold Next.js, Vitest et PostgreSQL local"
```

---

### Task 2: Règles de domaine pures (texte, paramètres de partie, expiration)

**Files:**
- Create: `src/lib/domain/text.ts`, `src/lib/domain/game-rules.ts`, `src/lib/domain/expiry.ts`, `src/lib/format.ts`
- Test: `tests/domain/text.test.ts`, `tests/domain/game-rules.test.ts`, `tests/domain/expiry.test.ts`, `tests/format.test.ts`

**Interfaces:**
- Produces:
  - `countWords(text: string): number`, `sanitizeText(input: string): string`
  - `type ExcerptRule = { mode: "paragraph" } | { mode: "words"; count: number }`, `extractExcerpt(text: string, rule: ExcerptRule): string`, `PARAGRAPH_EXCERPT_CAP = 150`
  - `gameParamsSchema` (zod), `type GameParams`, `parseGameParams(input: unknown): GameParams` (lève `DomainError("invalid_params", …, 400)`), `shuffle<T>(items: T[], rand?: () => number): T[]`
  - `MAX_ATTEMPTS = 2`, `decideOnExpiry(args: { attempts: number; pending: { id: string; rank: number }[] }): { kind: "swap"; withTurnId: string } | { kind: "open_call" } | { kind: "cancel"; reason: "max_attempts" }` (`open_call` dès qu'il n'y a plus de tour en attente, quel que soit `attempts`)
  - `formatDuration(seconds: number): string`

- [ ] **Step 1: Écrire les tests de texte**

`tests/domain/text.test.ts` :
```ts
import { describe, expect, it } from "vitest";
import { countWords, extractExcerpt, sanitizeText, PARAGRAPH_EXCERPT_CAP } from "@/lib/domain/text";

describe("countWords", () => {
  it("compte les mots séparés par des espaces multiples et sauts de ligne", () => {
    expect(countWords("  un  deux\n\ntrois  ")).toBe(3);
  });
  it("renvoie 0 pour un texte vide ou fait d'espaces", () => {
    expect(countWords("")).toBe(0);
    expect(countWords(" \n\t ")).toBe(0);
  });
  it("gère accents et emoji comme des mots", () => {
    expect(countWords("été à Noël 🎄 ok")).toBe(5);
  });
});

describe("sanitizeText", () => {
  it("normalise les fins de ligne et retire les caractères de contrôle", () => {
    expect(sanitizeText("a\r\nb\u0000c")).toBe("a\nbc");
  });
});

describe("extractExcerpt", () => {
  it("renvoie le dernier paragraphe", () => {
    expect(extractExcerpt("Premier.\n\nSecond.\n\nTroisième.", { mode: "paragraph" })).toBe("Troisième.");
  });
  it("renvoie les X derniers mots", () => {
    expect(extractExcerpt("a b c d e", { mode: "words", count: 2 })).toBe("d e");
  });
  it("plafonne un paragraphe unique trop long", () => {
    const text = Array.from({ length: 400 }, (_, i) => `m${i}`).join(" ");
    const excerpt = extractExcerpt(text, { mode: "paragraph" });
    expect(countWords(excerpt)).toBe(PARAGRAPH_EXCERPT_CAP);
    expect(excerpt.endsWith("m399")).toBe(true);
  });
  it("renvoie une chaîne vide pour un texte vide", () => {
    expect(extractExcerpt("   ", { mode: "paragraph" })).toBe("");
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npx vitest run tests/domain/text.test.ts`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Implémenter `src/lib/domain/text.ts`**

```ts
export const PARAGRAPH_EXCERPT_CAP = 150;

export type ExcerptRule = { mode: "paragraph" } | { mode: "words"; count: number };

export function countWords(text: string): number {
  const t = text.trim();
  return t === "" ? 0 : t.split(/\s+/u).length;
}

export function sanitizeText(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .normalize("NFC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function lastWords(text: string, count: number): string {
  const words = text.split(/\s+/u).filter(Boolean);
  return words.slice(-count).join(" ");
}

export function extractExcerpt(text: string, rule: ExcerptRule): string {
  const clean = text.replace(/\r\n?/g, "\n").trim();
  if (clean === "") return "";
  if (rule.mode === "words") return lastWords(clean, rule.count);
  const paragraphs = clean.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const last = paragraphs[paragraphs.length - 1] ?? "";
  return countWords(last) > PARAGRAPH_EXCERPT_CAP ? lastWords(last, PARAGRAPH_EXCERPT_CAP) : last;
}
```

- [ ] **Step 4: Vérifier le succès**

Run: `npx vitest run tests/domain/text.test.ts`
Expected: PASS.

- [ ] **Step 5: Tests des paramètres de partie et de l'expiration**

`tests/domain/game-rules.test.ts` :
```ts
import { describe, expect, it } from "vitest";
import { parseGameParams, shuffle } from "@/lib/domain/game-rules";
import { DomainError } from "@/lib/errors";

const drawing = { type: "drawing", name: "Dessin", turns: 4, turnDurationSeconds: 3600, visibility: "public", direction: "down" };
const text = { type: "text", name: "Texte", turns: 3, turnDurationSeconds: 600, visibility: "invite", language: "fr", minWords: 10, maxWords: 100, excerptMode: "paragraph" };

describe("parseGameParams", () => {
  it("accepte un dessin valide", () => {
    expect(parseGameParams(drawing).type).toBe("drawing");
  });
  it("accepte un texte valide", () => {
    expect(parseGameParams(text).type).toBe("text");
  });
  it.each([
    ["trop de tours", { ...drawing, turns: 9 }],
    ["pas assez de tours", { ...drawing, turns: 1 }],
    ["durée < 30 s", { ...drawing, turnDurationSeconds: 29 }],
    ["durée > 7 jours", { ...drawing, turnDurationSeconds: 604801 }],
    ["min > max", { ...text, minWords: 50, maxWords: 10 }],
    ["mode words sans nombre", { ...text, excerptMode: "words" }],
    ["sens inconnu", { ...drawing, direction: "up" }],
    ["nom vide", { ...drawing, name: "  " }],
  ])("refuse : %s", (_label, input) => {
    expect(() => parseGameParams(input)).toThrow(DomainError);
  });
});

describe("shuffle", () => {
  it("est une permutation et ne modifie pas l'entrée", () => {
    const input = [1, 2, 3, 4, 5];
    const out = shuffle(input, () => 0.3);
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(input).toEqual([1, 2, 3, 4, 5]);
  });
});
```
`tests/domain/expiry.test.ts` :
```ts
import { describe, expect, it } from "vitest";
import { decideOnExpiry } from "@/lib/domain/expiry";

describe("decideOnExpiry", () => {
  it("échange avec le prochain tour en attente", () => {
    const d = decideOnExpiry({ attempts: 0, pending: [{ id: "b", rank: 3 }, { id: "a", rank: 2 }] });
    expect(d).toEqual({ kind: "swap", withTurnId: "a" });
  });
  it("annule au-delà de 2 remises en jeu s'il reste des tours en attente", () => {
    expect(decideOnExpiry({ attempts: 2, pending: [{ id: "a", rank: 2 }] })).toEqual({ kind: "cancel", reason: "max_attempts" });
  });
  it("lance un appel à participation quand il n'y a plus de tour en attente (dernier tour)", () => {
    expect(decideOnExpiry({ attempts: 0, pending: [] })).toEqual({ kind: "open_call" });
  });
  it("relance l'appel sans limite de tentatives", () => {
    expect(decideOnExpiry({ attempts: 7, pending: [] })).toEqual({ kind: "open_call" });
  });
});
```
`tests/format.test.ts` :
```ts
import { describe, expect, it } from "vitest";
import { formatDuration } from "@/lib/format";

describe("formatDuration", () => {
  it.each([[30, "30 s"], [90, "1 min 30 s"], [3600, "1 h"], [5400, "1 h 30 min"], [86400, "1 j"], [604800, "7 j"]])("%i s -> %s", (s, out) => {
    expect(formatDuration(s)).toBe(out);
  });
});
```

- [ ] **Step 6: Implémenter**

`src/lib/domain/game-rules.ts` :
```ts
import { z } from "zod";
import { DomainError } from "@/lib/errors";

export const MIN_TURNS = 2;
export const MAX_TURNS = 8;
export const MIN_DURATION = 30;
export const MAX_DURATION = 604800;

const base = z.object({
  name: z.string().trim().min(1).max(80),
  turns: z.number().int().min(MIN_TURNS).max(MAX_TURNS),
  turnDurationSeconds: z.number().int().min(MIN_DURATION).max(MAX_DURATION),
  visibility: z.enum(["public", "invite"]),
});

const drawing = base.extend({
  type: z.literal("drawing"),
  direction: z.enum(["down", "right"]),
});

const text = base.extend({
  type: z.literal("text"),
  language: z.string().trim().min(2).max(10),
  minWords: z.number().int().min(1).max(2000),
  maxWords: z.number().int().min(1).max(2000),
  excerptMode: z.enum(["paragraph", "words"]),
  excerptWords: z.number().int().min(1).max(150).optional(),
});

export const gameParamsSchema = z
  .discriminatedUnion("type", [drawing, text])
  .superRefine((p, ctx) => {
    if (p.type !== "text") return;
    if (p.minWords > p.maxWords) {
      ctx.addIssue({ code: "custom", message: "minWords doit être ≤ maxWords", path: ["minWords"] });
    }
    if (p.excerptMode === "words" && p.excerptWords === undefined) {
      ctx.addIssue({ code: "custom", message: "excerptWords requis", path: ["excerptWords"] });
    }
  });

export type GameParams = z.infer<typeof gameParamsSchema>;

export function parseGameParams(input: unknown): GameParams {
  const r = gameParamsSchema.safeParse(input);
  if (!r.success) {
    throw new DomainError("invalid_params", r.error.issues.map((i) => i.message).join("; "), 400);
  }
  return r.data;
}

export function shuffle<T>(items: readonly T[], rand: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
```
`src/lib/domain/expiry.ts` :
```ts
export const MAX_ATTEMPTS = 2;

export type ExpiryDecision =
  | { kind: "swap"; withTurnId: string }
  | { kind: "open_call" }
  | { kind: "cancel"; reason: "max_attempts" };

export function decideOnExpiry(args: {
  attempts: number;
  pending: { id: string; rank: number }[];
}): ExpiryDecision {
  if (args.pending.length === 0) return { kind: "open_call" };
  if (args.attempts >= MAX_ATTEMPTS) return { kind: "cancel", reason: "max_attempts" };
  const next = [...args.pending].sort((a, b) => a.rank - b.rank)[0];
  return { kind: "swap", withTurnId: next.id };
}
```
`src/lib/format.ts` :
```ts
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s ? `${m} min ${s} s` : `${m} min`;
  }
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return h ? `${d} j ${h} h` : `${d} j`;
}
```

- [ ] **Step 7: Vérifier et commiter**

Run: `npx vitest run tests/domain tests/format.test.ts`
Expected: PASS.
```bash
git add -A && git commit -m "feat: règles de domaine pures (texte, paramètres, expiration)"
```

---

### Task 3: Géométrie et traitement d'images (bande, intégrité, assemblage)

**Files:**
- Create: `src/lib/images/geometry.ts`, `src/lib/images/strip.ts`, `tests/helpers/images.ts`
- Test: `tests/images/geometry.test.ts`, `tests/images/strip.test.ts`

**Interfaces:**
- Consumes: `DomainError` (tâche 1).
- Produces (`geometry.ts`) : `type Direction = "down" | "right"`, `type Rect`, `type Joint = { start: number; end: number }`, `LONG_SIDE = 1600`, `BAND_SIZE = 160`, `canvasSize(d): { width: number; height: number }`, `outgoingRect(d): Rect`, `inheritedRect(d): Rect`, `ownRect(d): Rect`, `guideLines(d, rank, total): number[]`, `finalLength(total): number`, `jointsFor(total): Joint[]`, `guidesSvg(d, width, height, positions: number[]): string`.
- Produces (`strip.ts`) : `MAX_PNG_BYTES = 8_000_000`, `validateDrawingPng(png: Buffer, d: Direction): Promise<void>`, `extractStrip(png: Buffer, d: Direction): Promise<Buffer>`, `inheritedZoneIntact(png: Buffer, strip: Buffer, d: Direction, tolerance?: number): Promise<boolean>`, `assembleDrawing(pngs: Buffer[], d: Direction): Promise<{ image: Buffer; width: number; height: number; joints: Joint[] }>`, `renderWithGuides(clean: Buffer, d: Direction, width: number, height: number, joints: Joint[]): Promise<Buffer>`.

- [ ] **Step 1: Helpers de test**

`tests/helpers/images.ts` :
```ts
import sharp from "sharp";
import { canvasSize, type Direction } from "@/lib/images/geometry";

export async function solidPng(d: Direction, color: string): Promise<Buffer> {
  const { width, height } = canvasSize(d);
  return sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
}

export async function paste(base: Buffer, overlay: Buffer, left: number, top: number): Promise<Buffer> {
  return sharp(base).composite([{ input: overlay, left, top }]).png().toBuffer();
}

export async function pixel(png: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * 3;
  return [data[i], data[i + 1], data[i + 2]];
}
```

- [ ] **Step 2: Tests de géométrie**

`tests/images/geometry.test.ts` :
```ts
import { describe, expect, it } from "vitest";
import { canvasSize, finalLength, guideLines, guidesSvg, inheritedRect, jointsFor, outgoingRect, ownRect } from "@/lib/images/geometry";

describe("geometry", () => {
  it("dimensions selon le sens", () => {
    expect(canvasSize("down")).toEqual({ width: 1200, height: 1600 });
    expect(canvasSize("right")).toEqual({ width: 1600, height: 1200 });
  });
  it("bandes sens down", () => {
    expect(outgoingRect("down")).toEqual({ left: 0, top: 1440, width: 1200, height: 160 });
    expect(inheritedRect("down")).toEqual({ left: 0, top: 0, width: 1200, height: 160 });
    expect(ownRect("down")).toEqual({ left: 0, top: 160, width: 1200, height: 1440 });
  });
  it("bandes sens right", () => {
    expect(outgoingRect("right")).toEqual({ left: 1440, top: 0, width: 160, height: 1200 });
    expect(inheritedRect("right")).toEqual({ left: 0, top: 0, width: 160, height: 1200 });
    expect(ownRect("right")).toEqual({ left: 160, top: 0, width: 1440, height: 1200 });
  });
  it("lignes de guide selon le rang", () => {
    expect(guideLines("down", 1, 3)).toEqual([1440]);
    expect(guideLines("down", 2, 3)).toEqual([160, 1440]);
    expect(guideLines("down", 3, 3)).toEqual([160]);
  });
  it("longueur finale et jointures", () => {
    expect(finalLength(2)).toBe(3040);
    expect(jointsFor(3)).toEqual([{ start: 1440, end: 1600 }, { start: 2880, end: 3040 }]);
  });
  it("SVG de guides en pointillés", () => {
    const svg = guidesSvg("down", 1200, 1600, [160]);
    expect(svg).toContain("<svg");
    expect(svg).toContain("stroke-dasharray");
    expect(svg).toContain('y1="160"');
  });
});
```

- [ ] **Step 3: Vérifier l'échec** — Run: `npx vitest run tests/images/geometry.test.ts` — Expected: FAIL.

- [ ] **Step 4: Implémenter `src/lib/images/geometry.ts`**

```ts
export type Direction = "down" | "right";
export type Rect = { left: number; top: number; width: number; height: number };
export type Joint = { start: number; end: number };

export const LONG_SIDE = 1600;
export const SHORT_SIDE = 1200;
export const BAND_SIZE = 160;

export function canvasSize(d: Direction): { width: number; height: number } {
  return d === "down" ? { width: SHORT_SIDE, height: LONG_SIDE } : { width: LONG_SIDE, height: SHORT_SIDE };
}

export function outgoingRect(d: Direction): Rect {
  const { width, height } = canvasSize(d);
  return d === "down"
    ? { left: 0, top: height - BAND_SIZE, width, height: BAND_SIZE }
    : { left: width - BAND_SIZE, top: 0, width: BAND_SIZE, height };
}

export function inheritedRect(d: Direction): Rect {
  const { width, height } = canvasSize(d);
  return d === "down"
    ? { left: 0, top: 0, width, height: BAND_SIZE }
    : { left: 0, top: 0, width: BAND_SIZE, height };
}

export function ownRect(d: Direction): Rect {
  const { width, height } = canvasSize(d);
  return d === "down"
    ? { left: 0, top: BAND_SIZE, width, height: height - BAND_SIZE }
    : { left: BAND_SIZE, top: 0, width: width - BAND_SIZE, height };
}

/** Positions (le long de l'axe de défilement) des lignes pointillées d'un tour. */
export function guideLines(_d: Direction, rank: number, total: number): number[] {
  if (rank === 1) return [LONG_SIDE - BAND_SIZE];
  if (rank === total) return [BAND_SIZE];
  return [BAND_SIZE, LONG_SIDE - BAND_SIZE];
}

export function finalLength(total: number): number {
  return LONG_SIDE + (total - 1) * (LONG_SIDE - BAND_SIZE);
}

export function jointsFor(total: number): Joint[] {
  const joints: Joint[] = [];
  let end = LONG_SIDE;
  for (let k = 1; k < total; k++) {
    joints.push({ start: end - BAND_SIZE, end });
    end += LONG_SIDE - BAND_SIZE;
  }
  return joints;
}

export function guidesSvg(d: Direction, width: number, height: number, positions: number[]): string {
  const stroke = 'stroke="#e11d48" stroke-width="3" stroke-dasharray="14 10" fill="none"';
  const lines = positions
    .map((p) =>
      d === "down"
        ? `<line x1="0" x2="${width}" y1="${p}" y2="${p}" ${stroke}/>`
        : `<line x1="${p}" x2="${p}" y1="0" y2="${height}" ${stroke}/>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${lines}</svg>`;
}
```

- [ ] **Step 5: Vérifier le succès** — Run: `npx vitest run tests/images/geometry.test.ts` — Expected: PASS.

- [ ] **Step 6: Tests du traitement d'images**

`tests/images/strip.test.ts` :
```ts
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { assembleDrawing, extractStrip, inheritedZoneIntact, renderWithGuides, validateDrawingPng } from "@/lib/images/strip";
import { jointsFor } from "@/lib/images/geometry";
import { DomainError } from "@/lib/errors";
import { paste, pixel, solidPng } from "../helpers/images";

describe("validateDrawingPng", () => {
  it("accepte un PNG aux bonnes dimensions", async () => {
    await expect(validateDrawingPng(await solidPng("down", "#fff"), "down")).resolves.toBeUndefined();
  });
  it("refuse un fichier qui n'est pas un PNG", async () => {
    await expect(validateDrawingPng(Buffer.from("not an image"), "down")).rejects.toBeInstanceOf(DomainError);
  });
  it("refuse un JPEG", async () => {
    const jpeg = await sharp({ create: { width: 1200, height: 1600, channels: 3, background: "#fff" } }).jpeg().toBuffer();
    await expect(validateDrawingPng(jpeg, "down")).rejects.toMatchObject({ code: "invalid_image" });
  });
  it("refuse de mauvaises dimensions", async () => {
    const small = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#fff" } }).png().toBuffer();
    await expect(validateDrawingPng(small, "down")).rejects.toMatchObject({ code: "invalid_image" });
  });
  it("refuse les dimensions du mauvais sens", async () => {
    await expect(validateDrawingPng(await solidPng("right", "#fff"), "down")).rejects.toMatchObject({ code: "invalid_image" });
  });
});

describe("extractStrip / inheritedZoneIntact", () => {
  it("la bande extraite fait 1200×160 (down)", async () => {
    const strip = await extractStrip(await solidPng("down", "#ff0000"), "down");
    const meta = await sharp(strip).metadata();
    expect([meta.width, meta.height]).toEqual([1200, 160]);
  });
  it("la bande extraite fait 160×1200 (right)", async () => {
    const strip = await extractStrip(await solidPng("right", "#ff0000"), "right");
    const meta = await sharp(strip).metadata();
    expect([meta.width, meta.height]).toEqual([160, 1200]);
  });
  it("détecte une zone héritée intacte puis modifiée", async () => {
    const strip = await extractStrip(await solidPng("down", "#ff0000"), "down");
    const next = await paste(await solidPng("down", "#00ff00"), strip, 0, 0);
    expect(await inheritedZoneIntact(next, strip, "down")).toBe(true);
    const black = await sharp({ create: { width: 50, height: 50, channels: 3, background: "#000" } }).png().toBuffer();
    expect(await inheritedZoneIntact(await paste(next, black, 10, 10), strip, "down")).toBe(false);
  });
});

describe("assembleDrawing", () => {
  it("empile les tours sans dupliquer les bandes (down)", async () => {
    const red = await solidPng("down", "#ff0000");
    const stripRed = await extractStrip(red, "down");
    const green = await paste(await solidPng("down", "#00ff00"), stripRed, 0, 0);
    const stripGreen = await extractStrip(green, "down");
    const blue = await paste(await solidPng("down", "#0000ff"), stripGreen, 0, 0);

    const out = await assembleDrawing([red, green, blue], "down");
    expect(out.width).toBe(1200);
    expect(out.height).toBe(4480);
    expect(out.joints).toEqual(jointsFor(3));
    expect(await pixel(out.image, 10, 10)).toEqual([255, 0, 0]);
    expect(await pixel(out.image, 10, 1700)).toEqual([0, 255, 0]);
    expect(await pixel(out.image, 10, 3100)).toEqual([0, 0, 255]);
  });
  it("assemble horizontalement (right)", async () => {
    const a = await solidPng("right", "#ff0000");
    const b = await paste(await solidPng("right", "#00ff00"), await extractStrip(a, "right"), 0, 0);
    const out = await assembleDrawing([a, b], "right");
    expect([out.width, out.height]).toEqual([3040, 1200]);
    expect(await pixel(out.image, 1700, 10)).toEqual([0, 255, 0]);
  });
});

describe("renderWithGuides", () => {
  it("superpose des guides sans changer les dimensions", async () => {
    const out = await assembleDrawing([await solidPng("down", "#ffffff"), await solidPng("down", "#ffffff")], "down");
    const guided = await renderWithGuides(out.image, "down", out.width, out.height, out.joints);
    const meta = await sharp(guided).metadata();
    expect([meta.width, meta.height]).toEqual([out.width, out.height]);
    expect(guided.equals(out.image)).toBe(false);
  });
});
```

- [ ] **Step 7: Implémenter `src/lib/images/strip.ts`**

```ts
import sharp from "sharp";
import { DomainError } from "@/lib/errors";
import {
  BAND_SIZE,
  LONG_SIDE,
  canvasSize,
  finalLength,
  guidesSvg,
  inheritedRect,
  jointsFor,
  outgoingRect,
  ownRect,
  type Direction,
  type Joint,
  type Rect,
} from "./geometry";

export const MAX_PNG_BYTES = 8_000_000;
const WHITE = { r: 255, g: 255, b: 255 };
const bad = (message: string) => new DomainError("invalid_image", message, 400);

export async function validateDrawingPng(png: Buffer, d: Direction): Promise<void> {
  if (png.length === 0 || png.length > MAX_PNG_BYTES) throw bad("Image trop volumineuse ou vide.");
  let meta: sharp.Metadata;
  try {
    meta = await sharp(png, { limitInputPixels: 4_000_000 }).metadata();
  } catch {
    throw bad("Fichier image illisible.");
  }
  const { width, height } = canvasSize(d);
  if (meta.format !== "png") throw bad("L'image doit être un PNG.");
  if (meta.width !== width || meta.height !== height) throw bad(`Dimensions attendues : ${width}×${height}.`);
}

export async function extractStrip(png: Buffer, d: Direction): Promise<Buffer> {
  return sharp(png).flatten({ background: WHITE }).extract(outgoingRect(d)).png().toBuffer();
}

async function rawRegion(img: Buffer, rect: Rect): Promise<Buffer> {
  return sharp(img).flatten({ background: WHITE }).extract(rect).removeAlpha().raw().toBuffer();
}

export async function inheritedZoneIntact(png: Buffer, strip: Buffer, d: Direction, tolerance = 2): Promise<boolean> {
  const a = await rawRegion(png, inheritedRect(d));
  const b = await sharp(strip).flatten({ background: WHITE }).removeAlpha().raw().toBuffer();
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > tolerance) return false;
  }
  return true;
}

export async function assembleDrawing(
  pngs: Buffer[],
  d: Direction,
): Promise<{ image: Buffer; width: number; height: number; joints: Joint[] }> {
  const total = pngs.length;
  const length = finalLength(total);
  const size = canvasSize(d);
  const width = d === "down" ? size.width : length;
  const height = d === "down" ? length : size.height;

  const parts = await Promise.all(
    pngs.map(async (png, i) => {
      const base = sharp(png).flatten({ background: WHITE });
      const input = i === 0 ? await base.png().toBuffer() : await base.extract(ownRect(d)).png().toBuffer();
      const offset = i === 0 ? 0 : LONG_SIDE + (i - 1) * (LONG_SIDE - BAND_SIZE);
      return d === "down" ? { input, left: 0, top: offset } : { input, left: offset, top: 0 };
    }),
  );

  const image = await sharp({ create: { width, height, channels: 3, background: WHITE } })
    .composite(parts)
    .png()
    .toBuffer();
  return { image, width, height, joints: jointsFor(total) };
}

export async function renderWithGuides(
  clean: Buffer,
  d: Direction,
  width: number,
  height: number,
  joints: Joint[],
): Promise<Buffer> {
  const svg = guidesSvg(d, width, height, joints.flatMap((j) => [j.start, j.end]));
  return sharp(clean).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer();
}
```

- [ ] **Step 8: Vérifier et commiter**

Run: `npx vitest run tests/images`
Expected: PASS.
```bash
git add -A && git commit -m "feat: géométrie, bande de transition et assemblage d'images"
```

---

### Task 4: Schéma de base de données, migrations et helpers de test

**Files:**
- Create: `src/lib/db/auth-schema.ts`, `src/lib/db/schema.ts`, `src/lib/db/client.ts`, `src/lib/db/migrate.ts`, `drizzle.config.ts`, `tests/global-setup.ts` (remplacer), `tests/helpers/db.ts`, `tests/helpers/games.ts`
- Test: `tests/db/schema.test.ts`

**Interfaces:**
- Produces:
  - `createDb(url: string): { db: Db; close: () => Promise<void> }`, `getDb(): Db`, types `Db`, `Tx`, `Executor = Db | Tx`.
  - Tables : `user, session, account, verification` (auth) ; `game, participant, turn, contribution, draft, notification, invitation, report, finalWork, profile` (app).
  - Helpers de test : `testDb(): Db`, `resetDb(db)`, `makeUser(db, name): Promise<string>`.

- [ ] **Step 1: Schéma Better Auth** (conforme au schéma de base de Better Auth ; vérifié à la tâche 6)

`src/lib/db/auth-schema.ts` :
```ts
import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
```

- [ ] **Step 2: Schéma applicatif**

`src/lib/db/schema.ts` :
```ts
import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

export const gameType = pgEnum("game_type", ["drawing", "text"]);
export const gameStatus = pgEnum("game_status", ["open", "in_progress", "completed", "cancelled"]);
export const gameVisibility = pgEnum("game_visibility", ["public", "invite"]);
export const turnStatus = pgEnum("turn_status", ["pending", "active", "done", "expired", "open_call"]);
export const drawDirection = pgEnum("draw_direction", ["down", "right"]);

export const profile = pgTable("profile", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("player"),
  emailEnabled: boolean("email_enabled").notNull().default(true),
});

export const game = pgTable("game", {
  id: uuid("id").primaryKey().defaultRandom(),
  creatorId: text("creator_id").notNull().references(() => user.id),
  name: text("name").notNull(),
  type: gameType("type").notNull(),
  turns: integer("turns").notNull(),
  turnDurationSeconds: integer("turn_duration_seconds").notNull(),
  visibility: gameVisibility("visibility").notNull(),
  inviteToken: text("invite_token").notNull(),
  status: gameStatus("status").notNull().default("open"),
  direction: drawDirection("direction"),
  language: text("language"),
  minWords: integer("min_words"),
  maxWords: integer("max_words"),
  excerptMode: text("excerpt_mode"),
  excerptWords: integer("excerpt_words"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
});

export const participant = pgTable(
  "participant",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id").notNull().references(() => game.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id),
    rank: integer("rank"),
    joinedAt: timestamp("joined_at").notNull().defaultNow(),
  },
  (t) => [unique("participant_game_user").on(t.gameId, t.userId), index("participant_user_idx").on(t.userId)],
);

export const turn = pgTable(
  "turn",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id").notNull().references(() => game.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    // null uniquement pendant un appel à participation (statut open_call)
    assignedUserId: text("assigned_user_id").references(() => user.id),
    status: turnStatus("status").notNull().default("pending"),
    deadline: timestamp("deadline"),
    startedAt: timestamp("started_at"),
    attempts: integer("attempts").notNull().default(0),
  },
  (t) => [unique("turn_game_rank").on(t.gameId, t.rank), index("turn_active_idx").on(t.status, t.deadline)],
);

export const contribution = pgTable("contribution", {
  id: uuid("id").primaryKey().defaultRandom(),
  turnId: uuid("turn_id").notNull().unique().references(() => turn.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id),
  text: text("text"),
  imageKey: text("image_key"),
  stripKey: text("strip_key"),
  hiddenAt: timestamp("hidden_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const draft = pgTable("draft", {
  turnId: uuid("turn_id").primaryKey().references(() => turn.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id),
  content: jsonb("content").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const notification = pgTable(
  "notification",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    gameId: uuid("game_id").notNull().references(() => game.id, { onDelete: "cascade" }),
    turnId: uuid("turn_id"),
    dedupeKey: text("dedupe_key").notNull().unique(),
    readAt: timestamp("read_at"),
    emailPending: boolean("email_pending").notNull().default(false),
    emailedAt: timestamp("emailed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("notification_user_idx").on(t.userId, t.createdAt)],
);

export const invitation = pgTable("invitation", {
  code: text("code").primaryKey(),
  createdBy: text("created_by").references(() => user.id),
  claimedAt: timestamp("claimed_at"),
  usedBy: text("used_by").references(() => user.id),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const report = pgTable("report", {
  id: uuid("id").primaryKey().defaultRandom(),
  targetType: text("target_type").notNull(),
  targetId: uuid("target_id").notNull(),
  reporterId: text("reporter_id").notNull().references(() => user.id),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const finalWork = pgTable("final_work", {
  gameId: uuid("game_id").primaryKey().references(() => game.id, { onDelete: "cascade" }),
  imageKey: text("image_key"),
  width: integer("width"),
  height: integer("height"),
  joints: jsonb("joints").$type<{ start: number; end: number }[]>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

- [ ] **Step 3: Client, migration, config drizzle**

`src/lib/db/client.ts` :
```ts
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as appSchema from "./schema";
import * as authSchema from "./auth-schema";
import { env } from "@/lib/env";

export const fullSchema = { ...appSchema, ...authSchema };
export type Db = PostgresJsDatabase<typeof fullSchema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Executor = Db | Tx;

export function createDb(url: string): { db: Db; close: () => Promise<void> } {
  const client = postgres(url, { max: 10 });
  return { db: drizzle(client, { schema: fullSchema }), close: () => client.end() };
}

const globalForDb = globalThis as unknown as { __db?: Db };
export function getDb(): Db {
  return (globalForDb.__db ??= createDb(env().DATABASE_URL).db);
}
```
`src/lib/db/migrate.ts` :
```ts
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL manquant");
const { db, close } = createDb(url);
await migrate(db, { migrationsFolder: "drizzle" });
await close();
console.log("migrations appliquées");
```
`drizzle.config.ts` :
```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: ["./src/lib/db/schema.ts", "./src/lib/db/auth-schema.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://exquis:exquis@localhost:5432/exquis" },
});
```
Run: `npm run db:generate` — Expected : dossier `drizzle/` avec un `.sql`.

- [ ] **Step 4: Setup de test**

`tests/global-setup.ts` :
```ts
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "@/lib/db/client";
import { TEST_DB_URL } from "./config";

export default async function setup() {
  const { db, close } = createDb(TEST_DB_URL);
  await migrate(db, { migrationsFolder: "drizzle" });
  await close();
}
```
`tests/helpers/db.ts` :
```ts
import { sql } from "drizzle-orm";
import { createDb, type Db } from "@/lib/db/client";
import { user } from "@/lib/db/auth-schema";
import { TEST_DB_URL } from "../config";

let cached: Db | undefined;
export function testDb(): Db {
  return (cached ??= createDb(TEST_DB_URL).db);
}

export async function resetDb(db: Db): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE "user", "game", "invitation" CASCADE`);
}

export async function makeUser(db: Db, name: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(user).values({ id, name, email: `${name}-${id}@test.dev`, emailVerified: true });
  return id;
}
```
(`global-setup.ts` utilise l'alias `@` : si Vitest ne le résout pas dans ce fichier, utiliser des imports relatifs `../src/lib/db/client` — le test de l'étape suivante le révélera.)

- [ ] **Step 5: Test du schéma**

`tests/db/schema.test.ts` :
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { game, participant, turn } from "@/lib/db/schema";
import { makeUser, resetDb, testDb } from "../helpers/db";

const db = testDb();
beforeEach(() => resetDb(db));

describe("schéma", () => {
  it("interdit deux rangs identiques dans une partie", async () => {
    const u = await makeUser(db, "a");
    const [g] = await db.insert(game).values({ creatorId: u, name: "g", type: "text", turns: 2, turnDurationSeconds: 60, visibility: "public", inviteToken: "t" }).returning();
    await db.insert(turn).values({ gameId: g.id, rank: 1, assignedUserId: u });
    await expect(db.insert(turn).values({ gameId: g.id, rank: 1, assignedUserId: u })).rejects.toThrow();
  });
  it("interdit une double inscription", async () => {
    const u = await makeUser(db, "a");
    const [g] = await db.insert(game).values({ creatorId: u, name: "g", type: "text", turns: 2, turnDurationSeconds: 60, visibility: "public", inviteToken: "t" }).returning();
    await db.insert(participant).values({ gameId: g.id, userId: u });
    await expect(db.insert(participant).values({ gameId: g.id, userId: u })).rejects.toThrow();
  });
});
```
Run: `npx vitest run tests/db` — Expected : PASS (si FAIL à cause d'une base absente : `docker compose up -d db`).

- [ ] **Step 6: Commiter**
```bash
git add -A && git commit -m "feat: schéma PostgreSQL, migrations et helpers de test"
```

---

### Task 5: Abstraction de stockage (mémoire, local signé, S3)

**Files:**
- Create: `src/lib/storage/index.ts`, `memory.ts`, `local.ts`, `s3.ts`, `token.ts`, `src/app/api/storage/[token]/route.ts`
- Test: `tests/storage/token.test.ts`, `tests/storage/local.test.ts`

**Interfaces:**
- Produces: `interface Storage { put(key: string, data: Buffer, contentType: string): Promise<void>; get(key: string): Promise<Buffer>; exists(key: string): Promise<boolean>; signedUrl(key: string, ttlSeconds: number): Promise<string>; }`, `MemoryStorage`, `LocalStorage(dir, secret, baseUrl)`, `S3Storage`, `getStorage(): Storage`, `signToken(key, exp, secret)`, `verifyToken(token, secret, now?)`.

- [ ] **Step 1: Tests**

`tests/storage/token.test.ts` :
```ts
import { describe, expect, it } from "vitest";
import { signToken, verifyToken } from "@/lib/storage/token";

describe("token signé", () => {
  const secret = "s".repeat(32);
  it("valide un token non expiré", () => {
    const t = signToken("games/1/a.png", 2000, secret);
    expect(verifyToken(t, secret, 1000)).toBe("games/1/a.png");
  });
  it("refuse un token expiré", () => {
    expect(verifyToken(signToken("k", 1000, secret), secret, 1001)).toBeNull();
  });
  it("refuse un token falsifié ou signé avec un autre secret", () => {
    const t = signToken("k", 2000, secret);
    expect(verifyToken(t + "x", secret, 1000)).toBeNull();
    expect(verifyToken(t, "o".repeat(32), 1000)).toBeNull();
  });
});
```
`tests/storage/local.test.ts` :
```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { LocalStorage } from "@/lib/storage/local";

describe("LocalStorage", () => {
  const dirPromise = mkdtemp(path.join(tmpdir(), "exquis-"));
  afterAll(async () => rm(await dirPromise, { recursive: true, force: true }));

  it("écrit, relit et signe", async () => {
    const s = new LocalStorage(await dirPromise, "s".repeat(32), "http://x");
    await s.put("games/1/a.png", Buffer.from("hello"), "image/png");
    expect((await s.get("games/1/a.png")).toString()).toBe("hello");
    expect(await s.exists("games/1/a.png")).toBe(true);
    expect(await s.exists("nope")).toBe(false);
    expect(await s.signedUrl("games/1/a.png", 300)).toMatch(/^http:\/\/x\/api\/storage\//);
  });
  it("refuse les clés qui sortent du dossier", async () => {
    const s = new LocalStorage(await dirPromise, "s".repeat(32), "http://x");
    await expect(s.put("../evil", Buffer.from("x"), "text/plain")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Implémenter**

`src/lib/storage/index.ts` :
```ts
import { env } from "@/lib/env";
import { LocalStorage } from "./local";
import { S3Storage } from "./s3";

export interface Storage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  signedUrl(key: string, ttlSeconds: number): Promise<string>;
}

let cached: Storage | undefined;
export function getStorage(): Storage {
  if (cached) return cached;
  const e = env();
  cached =
    e.STORAGE_DRIVER === "s3"
      ? new S3Storage({
          endpoint: e.S3_ENDPOINT!,
          region: e.S3_REGION,
          bucket: e.S3_BUCKET!,
          accessKeyId: e.S3_ACCESS_KEY_ID!,
          secretAccessKey: e.S3_SECRET_ACCESS_KEY!,
        })
      : new LocalStorage(e.STORAGE_DIR, e.STORAGE_SECRET, e.APP_URL);
  return cached;
}
```
`src/lib/storage/memory.ts` :
```ts
import type { Storage } from "./index";

export class MemoryStorage implements Storage {
  readonly files = new Map<string, Buffer>();
  async put(key: string, data: Buffer) { this.files.set(key, data); }
  async get(key: string) {
    const f = this.files.get(key);
    if (!f) throw new Error(`absent: ${key}`);
    return f;
  }
  async exists(key: string) { return this.files.has(key); }
  async signedUrl(key: string) { return `memory://${key}`; }
}
```
`src/lib/storage/token.ts` :
```ts
import { createHmac, timingSafeEqual } from "node:crypto";

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const mac = (payload: string, secret: string) => createHmac("sha256", secret).update(payload).digest("base64url");

/** exp en secondes epoch */
export function signToken(key: string, exp: number, secret: string): string {
  const payload = b64(JSON.stringify({ key, exp }));
  return `${payload}.${mac(payload, secret)}`;
}

export function verifyToken(token: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): string | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = mac(payload, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { key, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return typeof key === "string" && typeof exp === "number" && exp >= nowSeconds ? key : null;
  } catch {
    return null;
  }
}
```
`src/lib/storage/local.ts` :
```ts
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Storage } from "./index";
import { signToken } from "./token";

export class LocalStorage implements Storage {
  private readonly root: string;
  constructor(dir: string, private readonly secret: string, private readonly baseUrl: string) {
    this.root = path.resolve(dir);
  }
  private resolve(key: string): string {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error("clé de stockage invalide");
    return full;
  }
  async put(key: string, data: Buffer) {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
  }
  async get(key: string) { return readFile(this.resolve(key)); }
  async exists(key: string) {
    try { await stat(this.resolve(key)); return true; } catch { return false; }
  }
  async signedUrl(key: string, ttlSeconds: number) {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    return `${this.baseUrl}/api/storage/${signToken(key, exp, this.secret)}`;
  }
}
```
`src/lib/storage/s3.ts` :
```ts
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Storage } from "./index";

export class S3Storage implements Storage {
  private readonly client: S3Client;
  private readonly bucket: string;
  constructor(o: { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string }) {
    this.bucket = o.bucket;
    this.client = new S3Client({
      endpoint: o.endpoint,
      region: o.region,
      credentials: { accessKeyId: o.accessKeyId, secretAccessKey: o.secretAccessKey },
    });
  }
  async put(key: string, data: Buffer, contentType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: contentType }));
  }
  async get(key: string) {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
  async exists(key: string) {
    try { await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key })); return true; } catch { return false; }
  }
  async signedUrl(key: string, ttlSeconds: number) {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: ttlSeconds });
  }
}
```
`src/app/api/storage/[token]/route.ts` (sert les fichiers du stockage local, après vérification du token) :
```ts
import { env } from "@/lib/env";
import { getStorage } from "@/lib/storage";
import { verifyToken } from "@/lib/storage/token";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const key = verifyToken(token, env().STORAGE_SECRET);
  if (!key) return new Response("Lien expiré ou invalide", { status: 403 });
  try {
    const data = await getStorage().get(key);
    return new Response(new Uint8Array(data), {
      headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=60" },
    });
  } catch {
    return new Response("Introuvable", { status: 404 });
  }
}
```

- [ ] **Step 3: Vérifier et commiter**

Run: `npx vitest run tests/storage && npm run typecheck`
Expected: PASS.
```bash
git add -A && git commit -m "feat: abstraction de stockage avec URL signées"
```

---

### Task 6: Authentification sur invitation

**Files:**
- Create: `src/lib/services/invitations.ts`, `src/lib/invite-context.ts`, `src/lib/auth.ts`, `src/lib/session.ts`, `src/lib/notifications/mailer.ts`, `src/app/api/auth/[...all]/route.ts`, `src/app/api/register/route.ts`, `src/app/api/invitations/route.ts`, `scripts/create-invite.ts`
- Test: `tests/services/invitations.test.ts`, `tests/notifications/mailer.test.ts`

**Interfaces:**
- Consumes: `Db`, tables `invitation`, `profile`, `user`.
- Produces:
  - `createInvitation(db, createdBy: string | null, now?): Promise<string>` (code), `claimInvitation(db, code, now?): Promise<boolean>`, `releaseInvitation(db, code): Promise<void>`, `markInvitationUsed(db, code, userId): Promise<void>`, `MAX_OPEN_INVITATIONS = 5`
  - `interface Mailer { send(m: { to: string; subject: string; text: string }): Promise<void> }`, `ConsoleMailer`, `ResendMailer(apiKey, from)`, `getMailer(): Mailer`
  - `auth` (instance Better Auth), `getSession(): Promise<{ user: { id: string; name: string; email: string } } | null>`, `requireUser(): Promise<{ id: string; name: string; email: string }>`

- [ ] **Step 1: Tests des invitations**

`tests/services/invitations.test.ts` :
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { claimInvitation, createInvitation, MAX_OPEN_INVITATIONS, markInvitationUsed, releaseInvitation } from "@/lib/services/invitations";
import { makeUser, resetDb, testDb } from "../helpers/db";

const db = testDb();
beforeEach(() => resetDb(db));

describe("invitations", () => {
  it("un code ne peut être réclamé qu'une fois", async () => {
    const code = await createInvitation(db, null);
    expect(await claimInvitation(db, code)).toBe(true);
    expect(await claimInvitation(db, code)).toBe(false);
  });
  it("deux réclamations simultanées : une seule gagne", async () => {
    const code = await createInvitation(db, null);
    const results = await Promise.all([claimInvitation(db, code), claimInvitation(db, code)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
  it("un code libéré peut être réclamé à nouveau", async () => {
    const code = await createInvitation(db, null);
    await claimInvitation(db, code);
    await releaseInvitation(db, code);
    expect(await claimInvitation(db, code)).toBe(true);
  });
  it("refuse un code expiré ou inconnu", async () => {
    const code = await createInvitation(db, null, new Date(Date.now() - 8 * 86400_000));
    expect(await claimInvitation(db, code)).toBe(false);
    expect(await claimInvitation(db, "inconnu")).toBe(false);
  });
  it("limite les invitations ouvertes par utilisateur", async () => {
    const u = await makeUser(db, "a");
    for (let i = 0; i < MAX_OPEN_INVITATIONS; i++) await createInvitation(db, u);
    await expect(createInvitation(db, u)).rejects.toMatchObject({ code: "invitation_limit" });
  });
  it("marque l'utilisation", async () => {
    const u = await makeUser(db, "a");
    const code = await createInvitation(db, null);
    await claimInvitation(db, code);
    await markInvitationUsed(db, code, u);
    expect(await claimInvitation(db, code)).toBe(false);
  });
});
```
`tests/notifications/mailer.test.ts` :
```ts
import { describe, expect, it, vi } from "vitest";
import { ResendMailer } from "@/lib/notifications/mailer";

describe("ResendMailer", () => {
  it("poste sur l'API Resend", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await new ResendMailer("key", "Exquis <a@b.c>").send({ to: "x@y.z", subject: "S", text: "T" });
    expect(fetchMock).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({ method: "POST" }));
    vi.unstubAllGlobals();
  });
  it("lève une erreur si l'API répond mal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("no", { status: 500 })));
    await expect(new ResendMailer("k", "f").send({ to: "a", subject: "b", text: "c" })).rejects.toThrow();
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Vérifier l'échec** — Run: `npx vitest run tests/services/invitations.test.ts tests/notifications` — Expected: FAIL.

- [ ] **Step 3: Implémenter invitations et mailer**

`src/lib/services/invitations.ts` :
```ts
import { and, count, eq, gt, isNull } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { invitation } from "@/lib/db/schema";
import type { Db } from "@/lib/db/client";
import { DomainError } from "@/lib/errors";

export const MAX_OPEN_INVITATIONS = 5;
const INVITATION_TTL_MS = 7 * 86400_000;

export async function createInvitation(db: Db, createdBy: string | null, now = new Date()): Promise<string> {
  if (createdBy) {
    const [{ n }] = await db
      .select({ n: count() })
      .from(invitation)
      .where(and(eq(invitation.createdBy, createdBy), isNull(invitation.usedBy), gt(invitation.expiresAt, new Date())));
    if (n >= MAX_OPEN_INVITATIONS) throw new DomainError("invitation_limit", "Trop d'invitations en attente.", 429);
  }
  const code = randomBytes(9).toString("base64url");
  await db.insert(invitation).values({ code, createdBy, expiresAt: new Date(now.getTime() + INVITATION_TTL_MS) });
  return code;
}

/** Réclamation atomique : renvoie true pour un seul appelant. */
export async function claimInvitation(db: Db, code: string, now = new Date()): Promise<boolean> {
  const rows = await db
    .update(invitation)
    .set({ claimedAt: now })
    .where(and(eq(invitation.code, code), isNull(invitation.claimedAt), gt(invitation.expiresAt, now)))
    .returning({ code: invitation.code });
  return rows.length === 1;
}

export async function releaseInvitation(db: Db, code: string): Promise<void> {
  await db.update(invitation).set({ claimedAt: null }).where(and(eq(invitation.code, code), isNull(invitation.usedBy)));
}

export async function markInvitationUsed(db: Db, code: string, userId: string): Promise<void> {
  await db.update(invitation).set({ usedBy: userId }).where(eq(invitation.code, code));
}
```
`src/lib/notifications/mailer.ts` :
```ts
import { env } from "@/lib/env";

export interface Mailer {
  send(m: { to: string; subject: string; text: string }): Promise<void>;
}

export class ConsoleMailer implements Mailer {
  async send(m: { to: string; subject: string; text: string }) {
    console.log(`[mail] à ${m.to} — ${m.subject}\n${m.text}`);
  }
}

export class ResendMailer implements Mailer {
  constructor(private readonly apiKey: string, private readonly from: string) {}
  async send(m: { to: string; subject: string; text: string }) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: this.from, to: [m.to], subject: m.subject, text: m.text }),
    });
    if (!r.ok) throw new Error(`Resend: HTTP ${r.status}`);
  }
}

export function getMailer(): Mailer {
  const e = env();
  return e.RESEND_API_KEY ? new ResendMailer(e.RESEND_API_KEY, e.MAIL_FROM) : new ConsoleMailer();
}
```

- [ ] **Step 4: Vérifier le succès** — Run: `npx vitest run tests/services/invitations.test.ts tests/notifications` — Expected: PASS.

- [ ] **Step 5: Better Auth, verrouillage des inscriptions et session**

Avant d'écrire, lire la documentation de la version installée (`npm ls better-auth`, puis https://www.better-auth.com/docs/installation et /docs/concepts/database#database-hooks) pour confirmer : adaptateur Drizzle (`drizzleAdapter` de `better-auth/adapters/drizzle`), `databaseHooks.user.create.before`, `auth.api.signUpEmail({ body, asResponse })`, `auth.api.getSession({ headers })`. Les noms ci-dessous correspondent à la v1.x ; ajuster seulement si la doc diffère.

`src/lib/invite-context.ts` :
```ts
import { AsyncLocalStorage } from "node:async_hooks";

/** Marque les créations de compte qui passent par /api/register avec une invitation réclamée. */
export const inviteContext = new AsyncLocalStorage<{ code: string }>();
```
`src/lib/auth.ts` :
```ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { getDb, fullSchema } from "@/lib/db/client";
import { env } from "@/lib/env";
import { inviteContext } from "@/lib/invite-context";
import { getMailer } from "@/lib/notifications/mailer";
import { profile } from "@/lib/db/schema";

const e = env();

export const auth = betterAuth({
  baseURL: e.APP_URL,
  secret: e.BETTER_AUTH_SECRET,
  database: drizzleAdapter(getDb(), { provider: "pg", schema: fullSchema }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    requireEmailVerification: e.REQUIRE_EMAIL_VERIFICATION === "true",
  },
  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, url }) => {
      await getMailer().send({ to: user.email, subject: "Vérifiez votre email", text: `Bienvenue ! Confirmez votre adresse : ${url}` });
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (u) => {
          if (e.REGISTRATION_MODE === "invite" && !inviteContext.getStore()) {
            throw new APIError("FORBIDDEN", { message: "Inscription sur invitation uniquement." });
          }
          return { data: u };
        },
        after: async (u) => {
          await getDb().insert(profile).values({ userId: u.id }).onConflictDoNothing();
        },
      },
    },
  },
  plugins: [nextCookies()],
});
```
`src/app/api/auth/[...all]/route.ts` :
```ts
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const { GET, POST } = toNextJsHandler(auth);
```
`src/lib/session.ts` :
```ts
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { DomainError } from "@/lib/errors";

export type SessionUser = { id: string; name: string; email: string };

export async function getSession(): Promise<{ user: SessionUser } | null> {
  const s = await auth.api.getSession({ headers: await headers() });
  return s ? { user: { id: s.user.id, name: s.user.name, email: s.user.email } } : null;
}

export async function requireUser(): Promise<SessionUser> {
  const s = await getSession();
  if (!s) throw new DomainError("unauthorized", "Connexion requise.", 401);
  return s.user;
}
```
`src/app/api/register/route.ts` :
```ts
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db/client";
import { env } from "@/lib/env";
import { inviteContext } from "@/lib/invite-context";
import { claimInvitation, markInvitationUsed, releaseInvitation } from "@/lib/services/invitations";
import { z } from "zod";

export const runtime = "nodejs";

const body = z.object({
  name: z.string().trim().min(1).max(60),
  email: z.string().email(),
  password: z.string().min(10).max(128),
  invitationCode: z.string().optional(),
});

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Données invalides." }, { status: 400 });
  const { invitationCode, ...rest } = parsed.data;
  const db = getDb();
  const inviteOnly = env().REGISTRATION_MODE === "invite";

  let claimed = false;
  if (inviteOnly) {
    if (!invitationCode || !(await claimInvitation(db, invitationCode))) {
      return Response.json({ error: "Invitation invalide ou déjà utilisée." }, { status: 403 });
    }
    claimed = true;
  }
  try {
    const res = await inviteContext.run({ code: invitationCode ?? "" }, () =>
      auth.api.signUpEmail({ body: rest, asResponse: true }),
    );
    if (!res.ok) {
      if (claimed) await releaseInvitation(db, invitationCode!);
      return res;
    }
    if (claimed) {
      const data = (await res.clone().json()) as { user?: { id: string } };
      if (data.user) await markInvitationUsed(db, invitationCode!, data.user.id);
    }
    return res;
  } catch (err) {
    if (claimed) await releaseInvitation(db, invitationCode!);
    return Response.json({ error: "Création du compte impossible." }, { status: 400 });
  }
}
```
`src/app/api/invitations/route.ts` :
```ts
import { getDb } from "@/lib/db/client";
import { route } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { createInvitation } from "@/lib/services/invitations";

export const POST = route(async () => {
  const user = await requireUser();
  const code = await createInvitation(getDb(), user.id);
  return { code };
});
```
(`route` est défini à la tâche 11 ; en attendant, commenter ce fichier ou le créer à la tâche 11.)

`scripts/create-invite.ts` (amorçage : première invitation sans créateur) :
```ts
import { createDb } from "../src/lib/db/client";
import { createInvitation } from "../src/lib/services/invitations";

const url = process.env.DATABASE_URL ?? "postgres://exquis:exquis@localhost:5432/exquis";
const { db, close } = createDb(url);
console.log(await createInvitation(db, null));
await close();
```

- [ ] **Step 6: Vérifier le schéma d'authentification contre le CLI**

Run: `npx @better-auth/cli generate --config src/lib/auth.ts --output /tmp/auth-schema.ts -y` puis comparer avec `src/lib/db/auth-schema.ts`.
Expected : mêmes tables et colonnes. En cas d'écart, corriger `auth-schema.ts`, relancer `npm run db:generate`, et commiter la nouvelle migration.

- [ ] **Step 7: Vérification manuelle et commit**

Run: `npm run db:migrate && npx tsx scripts/create-invite.ts` (avec `DATABASE_URL` exporté) — Expected : un code affiché.
```bash
git add -A && git commit -m "feat: authentification Better Auth avec inscription sur invitation"
```

---

### Task 7: Contrôle d'accès, notifications (file) et service de parties

**Files:**
- Create: `src/lib/access.ts`, `src/lib/effects.ts`, `src/lib/services/notifications.ts`, `src/lib/services/games.ts`, `tests/helpers/games.ts`
- Test: `tests/access.test.ts`, `tests/services/games.test.ts`

**Interfaces:**
- Produces:
  - `SUBMIT_GRACE_MS = 5000`, `canActOnTurn(t: { assignedUserId: string; status: string; deadline: Date | null }, userId: string, now: Date): boolean`, `canViewFinal(game: { status: string }, participantUserIds: string[], userId: string): boolean`
  - `type Effect = { kind: "schedule-turn"; turnId: string; deadline: Date; durationSeconds: number } | { kind: "finalize-game"; gameId: string } | { kind: "flush-notifications" }`
  - `type NotificationType = "game_started" | "your_turn" | "turn_reminder" | "turn_reassigned" | "game_completed" | "game_cancelled" | "work_ready"`; `queueNotification(tx: Executor, n: { userId: string; type: NotificationType; gameId: string; turnId?: string; suffix?: string }): Promise<void>`
  - `MAX_ACTIVE_GAMES = 5`, `MAX_CREATED_PER_DAY = 10`
  - `createGame(db, creatorId, input: unknown, now?): Promise<{ gameId: string }>`
  - `joinGame(db, p: { userId: string; gameId: string; token?: string; now?: Date; rand?: () => number }): Promise<{ started: boolean; effects: Effect[] }>`
  - `listOpenGames(db): Promise<{ id: string; name: string; type: "drawing" | "text"; turns: number; turnDurationSeconds: number; language: string | null; participantCount: number }[]>`
  - `listMyGames(db, userId): Promise<{ id: string; name: string; type: string; status: string; turns: number; isMyTurn: boolean }[]>`
  - `getGameView(db, p: { gameId: string; userId: string; token?: string }): Promise<GameView>` avec `GameView = { game: PublicGame; participantCount: number; isParticipant: boolean; isCreator: boolean; inviteToken: string | null; openCall: boolean }`
  - `listOpenCalls(db): Promise<{ id: string; name: string; type: "drawing" | "text"; turns: number; turnDurationSeconds: number; language: string | null; rank: number }[]>` (parties publiques en cours dont le dernier tour est en `open_call`)
  - `claimOpenCall(db, p: { userId: string; gameId: string; token?: string; now?: Date }): Promise<{ effects: Effect[] }>` (erreurs : `open_call_unavailable` 409, `already_joined` 409, `forbidden` 403, `active_limit` 429)
  - Helper de test `startedGame(db, opts)`.

- [ ] **Step 1: Tests d'accès**

`tests/access.test.ts` :
```ts
import { describe, expect, it } from "vitest";
import { SUBMIT_GRACE_MS, canActOnTurn, canViewFinal } from "@/lib/access";

const t0 = new Date("2026-01-01T00:00:00Z");
const deadline = new Date(t0.getTime() + 60_000);
const turn = { assignedUserId: "u1", status: "active", deadline };

describe("canActOnTurn", () => {
  it("accepte le joueur assigné avant l'échéance", () => expect(canActOnTurn(turn, "u1", t0)).toBe(true));
  it("accepte dans la tolérance", () => expect(canActOnTurn(turn, "u1", new Date(deadline.getTime() + SUBMIT_GRACE_MS))).toBe(true));
  it("refuse après la tolérance", () => expect(canActOnTurn(turn, "u1", new Date(deadline.getTime() + SUBMIT_GRACE_MS + 1))).toBe(false));
  it("refuse un autre joueur", () => expect(canActOnTurn(turn, "u2", t0)).toBe(false));
  it("refuse un tour non actif", () => expect(canActOnTurn({ ...turn, status: "done" }, "u1", t0)).toBe(false));
});

describe("canViewFinal", () => {
  it("participant d'une partie terminée seulement", () => {
    expect(canViewFinal({ status: "completed" }, ["u1"], "u1")).toBe(true);
    expect(canViewFinal({ status: "in_progress" }, ["u1"], "u1")).toBe(false);
    expect(canViewFinal({ status: "completed" }, ["u1"], "u2")).toBe(false);
  });
});
```

- [ ] **Step 2: Implémenter `access.ts`, `effects.ts`, `notifications.ts`**

`src/lib/access.ts` :
```ts
export const SUBMIT_GRACE_MS = 5000;

export function canActOnTurn(
  t: { assignedUserId: string | null; status: string; deadline: Date | null },
  userId: string,
  now: Date,
): boolean {
  return (
    t.assignedUserId === userId &&
    t.status === "active" &&
    t.deadline !== null &&
    now.getTime() <= t.deadline.getTime() + SUBMIT_GRACE_MS
  );
}

export function canViewFinal(game: { status: string }, participantUserIds: string[], userId: string): boolean {
  return game.status === "completed" && participantUserIds.includes(userId);
}
```
`src/lib/effects.ts` :
```ts
export type Effect =
  | { kind: "schedule-turn"; turnId: string; deadline: Date; durationSeconds: number }
  | { kind: "finalize-game"; gameId: string }
  | { kind: "flush-notifications" };
```
`src/lib/services/notifications.ts` :
```ts
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db, Executor } from "@/lib/db/client";
import { game, notification, profile } from "@/lib/db/schema";

export type NotificationType =
  | "game_started" | "your_turn" | "turn_reminder" | "turn_reassigned"
  | "game_completed" | "game_cancelled" | "work_ready";

export const EMAIL_MIN_DURATION_SECONDS = 300;

export async function queueNotification(
  tx: Executor,
  n: { userId: string; type: NotificationType; gameId: string; turnId?: string; suffix?: string },
): Promise<void> {
  const [g] = await tx.select({ d: game.turnDurationSeconds }).from(game).where(eq(game.id, n.gameId));
  const [p] = await tx.select({ e: profile.emailEnabled }).from(profile).where(eq(profile.userId, n.userId));
  const emailPending = (p?.e ?? true) && (g?.d ?? 0) >= EMAIL_MIN_DURATION_SECONDS;
  const dedupeKey = `${n.type}:${n.turnId ?? n.gameId}:${n.userId}${n.suffix ? `:${n.suffix}` : ""}`;
  await tx
    .insert(notification)
    .values({ userId: n.userId, type: n.type, gameId: n.gameId, turnId: n.turnId, dedupeKey, emailPending })
    .onConflictDoNothing({ target: notification.dedupeKey });
}

export async function listNotifications(db: Db, userId: string) {
  return db
    .select({ id: notification.id, type: notification.type, gameId: notification.gameId, readAt: notification.readAt, createdAt: notification.createdAt, gameName: game.name })
    .from(notification)
    .innerJoin(game, eq(game.id, notification.gameId))
    .where(eq(notification.userId, userId))
    .orderBy(desc(notification.createdAt))
    .limit(50);
}

export async function markAllRead(db: Db, userId: string, now = new Date()) {
  await db.update(notification).set({ readAt: now }).where(and(eq(notification.userId, userId), isNull(notification.readAt)));
}
```

- [ ] **Step 3: Helper de test pour les parties**

`tests/helpers/games.ts` :
```ts
import { and, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { turn } from "@/lib/db/schema";
import { createGame, joinGame } from "@/lib/services/games";
import { makeUser } from "./db";

export type GameOpts = Record<string, unknown>;

export const drawingParams = (turns: number, extra: GameOpts = {}) => ({
  type: "drawing", name: "Dessin", turns, turnDurationSeconds: 3600, visibility: "public", direction: "down", ...extra,
});
export const textParams = (turns: number, extra: GameOpts = {}) => ({
  type: "text", name: "Texte", turns, turnDurationSeconds: 3600, visibility: "public",
  language: "fr", minWords: 2, maxWords: 50, excerptMode: "paragraph", ...extra,
});

/** Crée une partie pleine et démarrée ; renvoie ses joueurs. */
export async function startedGame(db: Db, params: GameOpts, now = new Date()) {
  const n = params.turns as number;
  const users: string[] = [];
  for (let i = 0; i < n; i++) users.push(await makeUser(db, `p${i}`));
  const { gameId } = await createGame(db, users[0], params, now);
  let effects: Awaited<ReturnType<typeof joinGame>>["effects"] = [];
  for (const u of users.slice(1)) effects = (await joinGame(db, { userId: u, gameId, now })).effects;
  return { gameId, users, effects };
}

export async function activeTurn(db: Db, gameId: string) {
  const [t] = await db.select().from(turn).where(and(eq(turn.gameId, gameId), eq(turn.status, "active")));
  // Un tour actif a toujours un joueur assigné (seul open_call a assignedUserId = null).
  return t as typeof t & { assignedUserId: string };
}
```

- [ ] **Step 4: Tests du service de parties**

`tests/services/games.test.ts` :
```ts
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { game, notification, participant, turn } from "@/lib/db/schema";
import { MAX_ACTIVE_GAMES, MAX_CREATED_PER_DAY, createGame, getGameView, joinGame, listMyGames, listOpenGames } from "@/lib/services/games";
import { makeUser, resetDb, testDb } from "../helpers/db";
import { activeTurn, startedGame, textParams } from "../helpers/games";

const db = testDb();
beforeEach(() => resetDb(db));

describe("createGame", () => {
  it("crée la partie et inscrit le créateur", async () => {
    const u = await makeUser(db, "a");
    const { gameId } = await createGame(db, u, textParams(3));
    const ps = await db.select().from(participant).where(eq(participant.gameId, gameId));
    expect(ps.map((p) => p.userId)).toEqual([u]);
    const list = await listOpenGames(db);
    expect(list).toMatchObject([{ id: gameId, participantCount: 1, turns: 3, language: "fr" }]);
  });
  it("refuse des paramètres invalides", async () => {
    const u = await makeUser(db, "a");
    await expect(createGame(db, u, textParams(12))).rejects.toMatchObject({ code: "invalid_params" });
  });
  it("limite la création quotidienne", async () => {
    const u = await makeUser(db, "a");
    for (let i = 0; i < MAX_CREATED_PER_DAY; i++) {
      // chaque partie compte aussi pour la limite de parties actives : on les annule
      const { gameId } = await createGame(db, u, textParams(2));
      await db.update(game).set({ status: "cancelled" }).where(eq(game.id, gameId));
    }
    await expect(createGame(db, u, textParams(2))).rejects.toMatchObject({ code: "daily_limit" });
  });
});

describe("joinGame", () => {
  it("démarre la partie quand le dernier siège est pris", async () => {
    const { gameId, users } = await startedGame(db, textParams(3));
    const [g] = await db.select().from(game).where(eq(game.id, gameId));
    expect(g.status).toBe("in_progress");
    const turns = await db.select().from(turn).where(eq(turn.gameId, gameId));
    expect(turns.map((t) => t.rank).sort()).toEqual([1, 2, 3]);
    expect(new Set(turns.map((t) => t.assignedUserId))).toEqual(new Set(users));
    const first = await activeTurn(db, gameId);
    expect(first.rank).toBe(1);
    expect(first.deadline!.getTime()).toBeGreaterThan(Date.now());
    const notes = await db.select().from(notification).where(and(eq(notification.gameId, gameId), eq(notification.type, "your_turn")));
    expect(notes).toHaveLength(1);
    expect(notes[0].userId).toBe(first.assignedUserId);
  });
  it("renvoie les effets de planification au démarrage", async () => {
    const { effects } = await startedGame(db, textParams(2));
    expect(effects.map((e) => e.kind)).toEqual(expect.arrayContaining(["schedule-turn", "flush-notifications"]));
  });
  it("refuse une double inscription", async () => {
    const u = await makeUser(db, "a");
    const { gameId } = await createGame(db, u, textParams(3));
    await expect(joinGame(db, { userId: u, gameId })).rejects.toMatchObject({ code: "already_joined" });
  });
  it("deux joueurs sur le dernier siège : un seul réussit", async () => {
    const a = await makeUser(db, "a");
    const b = await makeUser(db, "b");
    const c = await makeUser(db, "c");
    const { gameId } = await createGame(db, a, textParams(2));
    const results = await Promise.allSettled([joinGame(db, { userId: b, gameId }), joinGame(db, { userId: c, gameId })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 409 });
    expect(["game_full", "game_not_open"]).toContain(rejected.reason.code);
    expect(await db.select().from(participant).where(eq(participant.gameId, gameId))).toHaveLength(2);
  });
  it("refuse de rejoindre une partie sur invitation sans jeton", async () => {
    const a = await makeUser(db, "a");
    const b = await makeUser(db, "b");
    const { gameId } = await createGame(db, a, textParams(2, { visibility: "invite" }));
    await expect(joinGame(db, { userId: b, gameId })).rejects.toMatchObject({ code: "forbidden" });
    const [g] = await db.select().from(game).where(eq(game.id, gameId));
    await expect(joinGame(db, { userId: b, gameId, token: g.inviteToken })).resolves.toMatchObject({ started: true });
  });
  it("limite les parties actives par joueur", async () => {
    const u = await makeUser(db, "a");
    for (let i = 0; i < MAX_ACTIVE_GAMES; i++) await createGame(db, u, textParams(2));
    await expect(createGame(db, u, textParams(2))).rejects.toMatchObject({ code: "active_limit" });
  });
  it("refuse de rejoindre une partie non ouverte", async () => {
    const { gameId } = await startedGame(db, textParams(2));
    const x = await makeUser(db, "x");
    await expect(joinGame(db, { userId: x, gameId })).rejects.toMatchObject({ code: "game_not_open" });
  });
});

describe("listMyGames / getGameView", () => {
  it("indique si c'est mon tour", async () => {
    const { gameId } = await startedGame(db, textParams(2));
    const active = await activeTurn(db, gameId);
    const mine = await listMyGames(db, active.assignedUserId);
    expect(mine).toMatchObject([{ id: gameId, status: "in_progress", isMyTurn: true }]);
  });
  it("masque le jeton d'invitation aux non-créateurs et protège les parties sur invitation", async () => {
    const a = await makeUser(db, "a");
    const b = await makeUser(db, "b");
    const { gameId } = await createGame(db, a, textParams(3, { visibility: "invite" }));
    const viewA = await getGameView(db, { gameId, userId: a });
    expect(viewA.inviteToken).toBeTruthy();
    await expect(getGameView(db, { gameId, userId: b })).rejects.toMatchObject({ code: "forbidden" });
    await expect(getGameView(db, { gameId, userId: b, token: viewA.inviteToken! })).resolves.toMatchObject({ inviteToken: null, isParticipant: false });
  });
});
```

- [ ] **Step 5: Vérifier l'échec** — Run: `npx vitest run tests/access.test.ts tests/services/games.test.ts` — Expected: access PASS après l'étape 2 ; games FAIL (module absent).

- [ ] **Step 6: Implémenter `src/lib/services/games.ts`**

```ts
import { and, count, desc, eq, gt, inArray } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import type { Db, Executor, Tx } from "@/lib/db/client";
import { game, participant, turn } from "@/lib/db/schema";
import { parseGameParams, shuffle } from "@/lib/domain/game-rules";
import type { Effect } from "@/lib/effects";
import { DomainError } from "@/lib/errors";
import { queueNotification } from "./notifications";

export const MAX_ACTIVE_GAMES = 5;
export const MAX_CREATED_PER_DAY = 10;

export type GameRow = typeof game.$inferSelect;
export type PublicGame = Omit<GameRow, "inviteToken">;

export function publicGame(g: GameRow): PublicGame {
  const { inviteToken: _omit, ...rest } = g;
  return rest;
}

async function activeGameCount(tx: Executor, userId: string): Promise<number> {
  const [{ n }] = await tx
    .select({ n: count() })
    .from(participant)
    .innerJoin(game, eq(participant.gameId, game.id))
    .where(and(eq(participant.userId, userId), inArray(game.status, ["open", "in_progress"])));
  return n;
}

export async function createGame(db: Db, creatorId: string, input: unknown, now = new Date()): Promise<{ gameId: string }> {
  const p = parseGameParams(input);
  return db.transaction(async (tx) => {
    const [{ n: createdToday }] = await tx
      .select({ n: count() })
      .from(game)
      .where(and(eq(game.creatorId, creatorId), gt(game.createdAt, new Date(now.getTime() - 86400_000))));
    if (createdToday >= MAX_CREATED_PER_DAY) throw new DomainError("daily_limit", "Limite quotidienne de parties créées atteinte.", 429);
    if ((await activeGameCount(tx, creatorId)) >= MAX_ACTIVE_GAMES) throw new DomainError("active_limit", "Trop de parties actives.", 429);

    const [g] = await tx
      .insert(game)
      .values({
        creatorId,
        name: p.name,
        type: p.type,
        turns: p.turns,
        turnDurationSeconds: p.turnDurationSeconds,
        visibility: p.visibility,
        inviteToken: randomBytes(16).toString("hex"),
        direction: p.type === "drawing" ? p.direction : null,
        language: p.type === "text" ? p.language : null,
        minWords: p.type === "text" ? p.minWords : null,
        maxWords: p.type === "text" ? p.maxWords : null,
        excerptMode: p.type === "text" ? p.excerptMode : null,
        excerptWords: p.type === "text" && p.excerptMode === "words" ? p.excerptWords! : null,
        createdAt: now,
      })
      .returning({ id: game.id });
    await tx.insert(participant).values({ gameId: g.id, userId: creatorId });
    return { gameId: g.id };
  });
}

async function startGame(tx: Tx, g: GameRow, now: Date, rand?: () => number): Promise<Effect[]> {
  const ps = await tx.select().from(participant).where(eq(participant.gameId, g.id));
  const order = shuffle(ps, rand);
  const deadline = new Date(now.getTime() + g.turnDurationSeconds * 1000);
  let firstTurnId = "";
  for (let i = 0; i < order.length; i++) {
    await tx.update(participant).set({ rank: i + 1 }).where(eq(participant.id, order[i].id));
    const [t] = await tx
      .insert(turn)
      .values({
        gameId: g.id,
        rank: i + 1,
        assignedUserId: order[i].userId,
        status: i === 0 ? "active" : "pending",
        startedAt: i === 0 ? now : null,
        deadline: i === 0 ? deadline : null,
      })
      .returning({ id: turn.id });
    if (i === 0) firstTurnId = t.id;
  }
  await tx.update(game).set({ status: "in_progress", startedAt: now }).where(eq(game.id, g.id));
  for (const p of ps) await queueNotification(tx, { userId: p.userId, type: "game_started", gameId: g.id });
  await queueNotification(tx, { userId: order[0].userId, type: "your_turn", gameId: g.id, turnId: firstTurnId });
  return [
    { kind: "schedule-turn", turnId: firstTurnId, deadline, durationSeconds: g.turnDurationSeconds },
    { kind: "flush-notifications" },
  ];
}

export async function joinGame(
  db: Db,
  p: { userId: string; gameId: string; token?: string; now?: Date; rand?: () => number },
): Promise<{ started: boolean; effects: Effect[] }> {
  const now = p.now ?? new Date();
  return db.transaction(async (tx) => {
    const [g] = await tx.select().from(game).where(eq(game.id, p.gameId)).for("update");
    if (!g) throw new DomainError("not_found", "Partie introuvable.", 404);
    if (g.status !== "open") throw new DomainError("game_not_open", "Cette partie n'accepte plus de joueurs.", 409);
    if (g.visibility === "invite" && g.creatorId !== p.userId && p.token !== g.inviteToken) {
      throw new DomainError("forbidden", "Invitation requise.", 403);
    }
    const ps = await tx.select().from(participant).where(eq(participant.gameId, g.id));
    if (ps.some((x) => x.userId === p.userId)) throw new DomainError("already_joined", "Vous participez déjà.", 409);
    if (ps.length >= g.turns) throw new DomainError("game_full", "La partie est complète.", 409);
    if ((await activeGameCount(tx, p.userId)) >= MAX_ACTIVE_GAMES) throw new DomainError("active_limit", "Trop de parties actives.", 429);

    await tx.insert(participant).values({ gameId: g.id, userId: p.userId });
    if (ps.length + 1 === g.turns) {
      return { started: true, effects: await startGame(tx, g, now, p.rand) };
    }
    return { started: false, effects: [] };
  });
}

export async function listOpenGames(db: Db) {
  return db
    .select({
      id: game.id,
      name: game.name,
      type: game.type,
      turns: game.turns,
      turnDurationSeconds: game.turnDurationSeconds,
      language: game.language,
      participantCount: count(participant.id),
    })
    .from(game)
    .leftJoin(participant, eq(participant.gameId, game.id))
    .where(and(eq(game.status, "open"), eq(game.visibility, "public")))
    .groupBy(game.id)
    .orderBy(desc(game.createdAt));
}

export async function listMyGames(db: Db, userId: string) {
  const rows = await db
    .select({ id: game.id, name: game.name, type: game.type, status: game.status, turns: game.turns, activeTurnId: turn.id })
    .from(participant)
    .innerJoin(game, eq(participant.gameId, game.id))
    .leftJoin(turn, and(eq(turn.gameId, game.id), eq(turn.status, "active"), eq(turn.assignedUserId, userId)))
    .where(eq(participant.userId, userId))
    .orderBy(desc(game.createdAt));
  return rows.map(({ activeTurnId, ...r }) => ({ ...r, isMyTurn: activeTurnId !== null }));
}

export async function listOpenCalls(db: Db) {
  return db
    .select({
      id: game.id,
      name: game.name,
      type: game.type,
      turns: game.turns,
      turnDurationSeconds: game.turnDurationSeconds,
      language: game.language,
      rank: turn.rank,
    })
    .from(turn)
    .innerJoin(game, eq(turn.gameId, game.id))
    .where(and(eq(turn.status, "open_call"), eq(game.status, "in_progress"), eq(game.visibility, "public")))
    .orderBy(desc(game.createdAt));
}

/** Un volontaire (non participant) reprend le tour laissé vacant. */
export async function claimOpenCall(
  db: Db,
  p: { userId: string; gameId: string; token?: string; now?: Date },
): Promise<{ effects: Effect[] }> {
  const now = p.now ?? new Date();
  return db.transaction(async (tx) => {
    const [g] = await tx.select().from(game).where(eq(game.id, p.gameId)).for("update");
    if (!g) throw new DomainError("not_found", "Partie introuvable.", 404);
    if (g.status !== "in_progress") throw new DomainError("open_call_unavailable", "Aucun tour disponible.", 409);
    if (g.visibility === "invite" && g.creatorId !== p.userId && p.token !== g.inviteToken) {
      throw new DomainError("forbidden", "Invitation requise.", 403);
    }
    const [t] = await tx
      .select()
      .from(turn)
      .where(and(eq(turn.gameId, g.id), eq(turn.status, "open_call")))
      .for("update");
    if (!t) throw new DomainError("open_call_unavailable", "Ce tour a déjà été repris.", 409);
    const ps = await tx.select().from(participant).where(eq(participant.gameId, g.id));
    if (ps.some((x) => x.userId === p.userId)) throw new DomainError("already_joined", "Vous participez déjà à cette partie.", 409);
    if ((await activeGameCount(tx, p.userId)) >= MAX_ACTIVE_GAMES) throw new DomainError("active_limit", "Trop de parties actives.", 429);

    const deadline = new Date(now.getTime() + g.turnDurationSeconds * 1000);
    await tx.insert(participant).values({ gameId: g.id, userId: p.userId, rank: t.rank });
    await tx.update(turn).set({ assignedUserId: p.userId, status: "active", startedAt: now, deadline }).where(eq(turn.id, t.id));
    await queueNotification(tx, { userId: p.userId, type: "your_turn", gameId: g.id, turnId: t.id, suffix: `open-${t.attempts}` });
    return {
      effects: [
        { kind: "schedule-turn", turnId: t.id, deadline, durationSeconds: g.turnDurationSeconds },
        { kind: "flush-notifications" },
      ],
    };
  });
}

export type GameView = {
  game: PublicGame;
  participantCount: number;
  isParticipant: boolean;
  isCreator: boolean;
  inviteToken: string | null;
  openCall: boolean;
};

export async function getGameView(db: Db, p: { gameId: string; userId: string; token?: string }): Promise<GameView> {
  const [g] = await db.select().from(game).where(eq(game.id, p.gameId));
  if (!g) throw new DomainError("not_found", "Partie introuvable.", 404);
  const ps = await db.select().from(participant).where(eq(participant.gameId, g.id));
  const isParticipant = ps.some((x) => x.userId === p.userId);
  const isCreator = g.creatorId === p.userId;
  if (g.visibility === "invite" && !isParticipant && !isCreator && p.token !== g.inviteToken) {
    throw new DomainError("forbidden", "Invitation requise.", 403);
  }
  const [open] = await db
    .select({ id: turn.id })
    .from(turn)
    .where(and(eq(turn.gameId, g.id), eq(turn.status, "open_call")));
  return {
    game: publicGame(g),
    participantCount: ps.length,
    isParticipant,
    isCreator,
    inviteToken: isCreator ? g.inviteToken : null,
    openCall: !!open,
  };
}
```

- [ ] **Step 7: Vérifier et commiter**

Run: `npx vitest run tests/access.test.ts tests/services/games.test.ts`
Expected: PASS.
```bash
git add -A && git commit -m "feat: contrôle d'accès, notifications en file et service de parties"
```

---

### Task 8: Service des tours (lecture filtrée, soumission, brouillon, expiration)

**Files:**
- Create: `src/lib/services/turns.ts`
- Test: `tests/services/turns-text.test.ts`, `tests/services/turns-drawing.test.ts`, `tests/services/turns-expiry.test.ts`

**Interfaces:**
- Consumes: `Storage`, `canActOnTurn`, `SUBMIT_GRACE_MS`, `queueNotification`, `extractExcerpt`, `countWords`, `sanitizeText`, `decideOnExpiry`, `validateDrawingPng`, `extractStrip`, `inheritedZoneIntact`, `startedGame`/`activeTurn` (helpers).
- Produces:
  - `type MyTurn = { turnId: string; rank: number; total: number; deadline: Date; game: PublicGame; stripUrl?: string; excerpt?: string; draft: unknown | null }`
  - `getMyTurn(db, storage, p: { userId: string; gameId: string; now?: Date }): Promise<MyTurn | null>`
  - `submitText(db, p: { userId: string; gameId: string; text: string; now?: Date }): Promise<Effect[]>`
  - `submitDrawing(db, storage, p: { userId: string; gameId: string; png: Buffer; now?: Date }): Promise<Effect[]>`
  - `saveDraft(db, p: { userId: string; gameId: string; content: unknown; now?: Date }): Promise<void>`
  - `expireTurn(db, p: { turnId: string; deadline: Date; now?: Date }): Promise<Effect[]>`
  - `expireOverdue(db, now?: Date): Promise<Effect[]>`

- [ ] **Step 1: Tests des tours de texte**

`tests/services/turns-text.test.ts` :
```ts
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { SUBMIT_GRACE_MS } from "@/lib/access";
import { contribution, draft, game, notification } from "@/lib/db/schema";
import { MemoryStorage } from "@/lib/storage/memory";
import { getMyTurn, saveDraft, submitText } from "@/lib/services/turns";
import { resetDb, testDb } from "../helpers/db";
import { activeTurn, startedGame, textParams } from "../helpers/games";

const db = testDb();
const storage = new MemoryStorage();
beforeEach(() => resetDb(db));

describe("tour de texte", () => {
  it("le tour 1 n'a pas d'extrait ; le tour 2 ne voit que le dernier paragraphe", async () => {
    const { gameId } = await startedGame(db, textParams(3));
    const t1 = await activeTurn(db, gameId);
    const mine1 = await getMyTurn(db, storage, { userId: t1.assignedUserId, gameId });
    expect(mine1).toMatchObject({ rank: 1, total: 3, excerpt: undefined });

    await submitText(db, { userId: t1.assignedUserId, gameId, text: "Début secret.\n\nFin visible ici." });
    const t2 = await activeTurn(db, gameId);
    expect(t2.rank).toBe(2);
    const mine2 = await getMyTurn(db, storage, { userId: t2.assignedUserId, gameId });
    expect(mine2?.excerpt).toBe("Fin visible ici.");
    expect(JSON.stringify(mine2)).not.toContain("Début secret");
  });

  it("refuse un joueur qui n'est pas assigné", async () => {
    const { gameId, users } = await startedGame(db, textParams(2));
    const t1 = await activeTurn(db, gameId);
    const other = users.find((u) => u !== t1.assignedUserId)!;
    expect(await getMyTurn(db, storage, { userId: other, gameId })).toBeNull();
    await expect(submitText(db, { userId: other, gameId, text: "un deux trois" })).rejects.toMatchObject({ code: "not_your_turn" });
  });

  it.each([
    ["trop court", "un"],
    ["vide", "   "],
    ["trop long", Array(60).fill("mot").join(" ")],
  ])("refuse un texte %s", async (_l, text) => {
    const { gameId } = await startedGame(db, textParams(2));
    const t1 = await activeTurn(db, gameId);
    await expect(submitText(db, { userId: t1.assignedUserId, gameId, text })).rejects.toMatchObject({ code: "invalid_text" });
  });

  it("compte correctement accents et emoji", async () => {
    const { gameId } = await startedGame(db, textParams(2, { minWords: 4, maxWords: 4 }));
    const t1 = await activeTurn(db, gameId);
    await expect(submitText(db, { userId: t1.assignedUserId, gameId, text: "été à Noël 🎄" })).resolves.toBeDefined();
  });

  it("double soumission simultanée : une seule contribution", async () => {
    const { gameId } = await startedGame(db, textParams(3));
    const t1 = await activeTurn(db, gameId);
    const results = await Promise.allSettled([
      submitText(db, { userId: t1.assignedUserId, gameId, text: "un deux trois" }),
      submitText(db, { userId: t1.assignedUserId, gameId, text: "un deux trois" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "not_your_turn" });
    expect(await db.select().from(contribution)).toHaveLength(1);
  });

  it("accepte dans la tolérance, refuse au-delà", async () => {
    const { gameId } = await startedGame(db, textParams(2));
    const t1 = await activeTurn(db, gameId);
    const inGrace = new Date(t1.deadline!.getTime() + SUBMIT_GRACE_MS - 1);
    const late = new Date(t1.deadline!.getTime() + SUBMIT_GRACE_MS + 1);
    await expect(submitText(db, { userId: t1.assignedUserId, gameId, text: "un deux", now: late })).rejects.toMatchObject({ code: "not_your_turn" });
    await expect(submitText(db, { userId: t1.assignedUserId, gameId, text: "un deux", now: inGrace })).resolves.toBeDefined();
  });

  it("le dernier tour termine la partie et demande l'assemblage", async () => {
    const { gameId } = await startedGame(db, textParams(2));
    const t1 = await activeTurn(db, gameId);
    await submitText(db, { userId: t1.assignedUserId, gameId, text: "un deux" });
    const t2 = await activeTurn(db, gameId);
    const effects = await submitText(db, { userId: t2.assignedUserId, gameId, text: "trois quatre" });
    expect(effects).toEqual(expect.arrayContaining([{ kind: "finalize-game", gameId }, { kind: "flush-notifications" }]));
    const [g] = await db.select().from(game).where(eq(game.id, gameId));
    expect(g.status).toBe("completed");
    expect(await activeTurn(db, gameId)).toBeUndefined();
    const done = await db.select().from(notification).where(eq(notification.type, "game_completed"));
    expect(done).toHaveLength(2);
  });
});

describe("brouillon", () => {
  it("est enregistré puis supprimé à la soumission", async () => {
    const { gameId } = await startedGame(db, textParams(2));
    const t1 = await activeTurn(db, gameId);
    await saveDraft(db, { userId: t1.assignedUserId, gameId, content: { text: "en cours" } });
    await saveDraft(db, { userId: t1.assignedUserId, gameId, content: { text: "en cours 2" } });
    expect((await getMyTurn(db, storage, { userId: t1.assignedUserId, gameId }))?.draft).toEqual({ text: "en cours 2" });
    await submitText(db, { userId: t1.assignedUserId, gameId, text: "un deux" });
    expect(await db.select().from(draft)).toHaveLength(0);
  });
  it("refuse un brouillon démesuré", async () => {
    const { gameId } = await startedGame(db, textParams(2));
    const t1 = await activeTurn(db, gameId);
    await expect(saveDraft(db, { userId: t1.assignedUserId, gameId, content: { text: "x".repeat(3_000_000) } })).rejects.toMatchObject({ code: "draft_too_large" });
  });
});
```

- [ ] **Step 2: Tests des tours de dessin**

`tests/services/turns-drawing.test.ts` :
```ts
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { contribution } from "@/lib/db/schema";
import { MemoryStorage } from "@/lib/storage/memory";
import { getMyTurn, submitDrawing } from "@/lib/services/turns";
import { extractStrip } from "@/lib/images/strip";
import { resetDb, testDb } from "../helpers/db";
import { activeTurn, drawingParams, startedGame } from "../helpers/games";
import { paste, solidPng } from "../helpers/images";

const db = testDb();
let storage: MemoryStorage;
beforeEach(async () => {
  await resetDb(db);
  storage = new MemoryStorage();
});

describe("tour de dessin", () => {
  it("le tour 1 n'a pas de bande ; l'image complète n'est jamais exposée au tour 2", async () => {
    const { gameId } = await startedGame(db, drawingParams(2));
    const t1 = await activeTurn(db, gameId);
    expect(await getMyTurn(db, storage, { userId: t1.assignedUserId, gameId })).toMatchObject({ rank: 1, stripUrl: undefined });

    await submitDrawing(db, storage, { userId: t1.assignedUserId, gameId, png: await solidPng("down", "#ff0000") });
    const t2 = await activeTurn(db, gameId);
    const mine = await getMyTurn(db, storage, { userId: t2.assignedUserId, gameId });
    expect(mine?.stripUrl).toBe(`memory://games/${gameId}/turns/1/strip.png`);
    expect(JSON.stringify(mine)).not.toContain("full.png");
    expect(await storage.exists(`games/${gameId}/turns/1/full.png`)).toBe(true);
  });

  it("refuse une image invalide sans rien stocker", async () => {
    const { gameId } = await startedGame(db, drawingParams(2));
    const t1 = await activeTurn(db, gameId);
    await expect(submitDrawing(db, storage, { userId: t1.assignedUserId, gameId, png: Buffer.from("pas une image") })).rejects.toMatchObject({ code: "invalid_image" });
    expect(storage.files.size).toBe(0);
    expect(await db.select().from(contribution)).toHaveLength(0);
  });

  it("refuse une zone héritée modifiée, accepte une zone intacte", async () => {
    const { gameId } = await startedGame(db, drawingParams(2));
    const t1 = await activeTurn(db, gameId);
    const red = await solidPng("down", "#ff0000");
    await submitDrawing(db, storage, { userId: t1.assignedUserId, gameId, png: red });
    const t2 = await activeTurn(db, gameId);

    const tampered = await solidPng("down", "#00ff00"); // bande héritée absente
    await expect(submitDrawing(db, storage, { userId: t2.assignedUserId, gameId, png: tampered })).rejects.toMatchObject({ code: "invalid_image" });

    const ok = await paste(await solidPng("down", "#00ff00"), await extractStrip(red, "down"), 0, 0);
    const effects = await submitDrawing(db, storage, { userId: t2.assignedUserId, gameId, png: ok });
    expect(effects).toContainEqual({ kind: "finalize-game", gameId });
    const [c] = await db.select().from(contribution).where(eq(contribution.turnId, t2.id));
    expect(c.imageKey).toBe(`games/${gameId}/turns/2/full.png`);
  });

  it("refuse une soumission de dessin sur une partie de texte", async () => {
    const { gameId } = await startedGame(db, { ...drawingParams(2), type: "text", direction: undefined, language: "fr", minWords: 1, maxWords: 5, excerptMode: "paragraph" });
    const t1 = await activeTurn(db, gameId);
    await expect(submitDrawing(db, storage, { userId: t1.assignedUserId, gameId, png: await solidPng("down", "#fff") })).rejects.toMatchObject({ code: "wrong_type" });
  });
});
```

- [ ] **Step 3: Tests d'expiration**

`tests/services/turns-expiry.test.ts` :
```ts
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { SUBMIT_GRACE_MS } from "@/lib/access";
import { game, notification, participant, turn } from "@/lib/db/schema";
import { claimOpenCall, getGameView, listOpenCalls } from "@/lib/services/games";
import { expireOverdue, expireTurn, getMyTurn, submitText } from "@/lib/services/turns";
import { MemoryStorage } from "@/lib/storage/memory";
import { makeUser, resetDb, testDb } from "../helpers/db";
import { activeTurn, startedGame, textParams } from "../helpers/games";

const db = testDb();
beforeEach(() => resetDb(db));
const after = (d: Date) => new Date(d.getTime() + SUBMIT_GRACE_MS + 1000);

describe("expireTurn", () => {
  it("ne fait rien avant la fin de la tolérance", async () => {
    const { gameId } = await startedGame(db, textParams(3));
    const t = await activeTurn(db, gameId);
    expect(await expireTurn(db, { turnId: t.id, deadline: t.deadline!, now: t.deadline! })).toEqual([]);
    expect((await activeTurn(db, gameId)).attempts).toBe(0);
  });

  it("remet le tour en jeu : échange avec le prochain joueur", async () => {
    const { gameId } = await startedGame(db, textParams(3));
    const t = await activeTurn(db, gameId);
    const next = (await db.select().from(turn).where(eq(turn.gameId, gameId))).find((x) => x.rank === 2)!;
    const effects = await expireTurn(db, { turnId: t.id, deadline: t.deadline!, now: after(t.deadline!) });
    expect(effects.map((e) => e.kind)).toEqual(expect.arrayContaining(["schedule-turn", "flush-notifications"]));
    const t2 = await activeTurn(db, gameId);
    expect(t2.id).toBe(t.id);
    expect(t2.assignedUserId).toBe(next.assignedUserId);
    expect(t2.attempts).toBe(1);
    expect(t2.deadline!.getTime()).toBeGreaterThan(t.deadline!.getTime());
    const [swapped] = await db.select().from(turn).where(eq(turn.id, next.id));
    expect(swapped.assignedUserId).toBe(t.assignedUserId);
    expect(await db.select().from(notification).where(eq(notification.type, "turn_reassigned"))).toHaveLength(1);
  });

  it("annule la partie après 2 remises en jeu", async () => {
    const { gameId } = await startedGame(db, textParams(3));
    for (let i = 0; i < 3; i++) {
      const t = await activeTurn(db, gameId);
      if (!t) break;
      await expireTurn(db, { turnId: t.id, deadline: t.deadline!, now: after(t.deadline!) });
    }
    const [g] = await db.select().from(game).where(eq(game.id, gameId));
    expect(g.status).toBe("cancelled");
    expect(await db.select().from(notification).where(eq(notification.type, "game_cancelled"))).toHaveLength(3);
  });

  // Cas du dernier tour : voir aussi expireOverdue plus bas.
  async function lastTurnExpired() {
    const g = await startedGame(db, textParams(2));
    const t1 = await activeTurn(db, g.gameId);
    await submitText(db, { userId: t1.assignedUserId, gameId: g.gameId, text: "un deux" });
    const t2 = await activeTurn(db, g.gameId);
    const effects = await expireTurn(db, { turnId: t2.id, deadline: t2.deadline!, now: after(t2.deadline!) });
    return { ...g, t2, effects };
  }

  it("lance un appel à participation quand le dernier tour expire (la partie n'est pas annulée)", async () => {
    const { gameId, t2, effects } = await lastTurnExpired();
    expect(effects).toEqual([{ kind: "flush-notifications" }]);
    const [g] = await db.select().from(game).where(eq(game.id, gameId));
    expect(g.status).toBe("in_progress");
    const [t] = await db.select().from(turn).where(eq(turn.id, t2.id));
    expect(t).toMatchObject({ status: "open_call", assignedUserId: null, deadline: null });
    expect(await listOpenCalls(db)).toMatchObject([{ id: gameId, rank: 2, turns: 2 }]);
    expect(await getMyTurn(db, new MemoryStorage(), { userId: t2.assignedUserId, gameId })).toBeNull();
    expect(await db.select().from(notification).where(eq(notification.type, "turn_reassigned"))).toHaveLength(1);
    const view = await getGameView(db, { gameId, userId: t2.assignedUserId });
    expect(view.openCall).toBe(true);
  });

  it("un volontaire reprend le tour et peut terminer la partie", async () => {
    const { gameId } = await lastTurnExpired();
    const volunteer = await makeUser(db, "volontaire");
    const { effects } = await claimOpenCall(db, { userId: volunteer, gameId });
    expect(effects.map((e) => e.kind)).toEqual(["schedule-turn", "flush-notifications"]);
    expect(await listOpenCalls(db)).toEqual([]);
    expect(await db.select().from(participant).where(eq(participant.gameId, gameId))).toHaveLength(3);
    const t = await activeTurn(db, gameId);
    expect(t.assignedUserId).toBe(volunteer);
    await submitText(db, { userId: volunteer, gameId, text: "trois quatre" });
    const [g] = await db.select().from(game).where(eq(game.id, gameId));
    expect(g.status).toBe("completed");
  });

  it("deux volontaires simultanés : un seul réussit", async () => {
    const { gameId } = await lastTurnExpired();
    const a = await makeUser(db, "va");
    const b = await makeUser(db, "vb");
    const results = await Promise.allSettled([claimOpenCall(db, { userId: a, gameId }), claimOpenCall(db, { userId: b, gameId })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "open_call_unavailable" });
  });

  it("un participant existant ne peut pas reprendre l'appel", async () => {
    const { gameId, users } = await lastTurnExpired();
    await expect(claimOpenCall(db, { userId: users[0], gameId })).rejects.toMatchObject({ code: "already_joined" });
  });

  it("refuse la reprise quand aucun appel n'est ouvert", async () => {
    const { gameId } = await startedGame(db, textParams(2));
    const x = await makeUser(db, "x");
    await expect(claimOpenCall(db, { userId: x, gameId })).rejects.toMatchObject({ code: "open_call_unavailable" });
  });

  it("le balayage ignore un appel non repris, et un volontaire qui laisse expirer relance l'appel", async () => {
    const { gameId } = await lastTurnExpired();
    expect(await expireOverdue(db, new Date(Date.now() + 10 * 86400_000))).toEqual([]);
    const volunteer = await makeUser(db, "volontaire");
    await claimOpenCall(db, { userId: volunteer, gameId });
    const t = await activeTurn(db, gameId);
    await expireTurn(db, { turnId: t.id, deadline: t.deadline!, now: after(t.deadline!) });
    const [again] = await db.select().from(turn).where(eq(turn.id, t.id));
    expect(again.status).toBe("open_call");
    expect(again.attempts).toBeGreaterThanOrEqual(2);
    expect(await listOpenCalls(db)).toHaveLength(1);
  });

  it("est sans effet sur un tour déjà soumis ou avec une échéance périmée", async () => {
    const { gameId } = await startedGame(db, textParams(3));
    const t = await activeTurn(db, gameId);
    await submitText(db, { userId: t.assignedUserId, gameId, text: "un deux" });
    expect(await expireTurn(db, { turnId: t.id, deadline: t.deadline!, now: after(t.deadline!) })).toEqual([]);
    const t2 = await activeTurn(db, gameId);
    expect(await expireTurn(db, { turnId: t2.id, deadline: new Date(0), now: after(t2.deadline!) })).toEqual([]);
  });
});

describe("expireOverdue", () => {
  it("expire les tours dépassés, ignore les autres", async () => {
    const { gameId } = await startedGame(db, textParams(3));
    const t = await activeTurn(db, gameId);
    expect(await expireOverdue(db, t.startedAt!)).toEqual([]);
    const effects = await expireOverdue(db, after(t.deadline!));
    expect(effects.length).toBeGreaterThan(0);
    expect((await activeTurn(db, gameId)).attempts).toBe(1);
  });
});
```

- [ ] **Step 4: Vérifier l'échec** — Run: `npx vitest run tests/services/turns-*.test.ts` — Expected: FAIL (module absent).

- [ ] **Step 5: Implémenter `src/lib/services/turns.ts`**

```ts
import { and, asc, eq, lt } from "drizzle-orm";
import { SUBMIT_GRACE_MS, canActOnTurn } from "@/lib/access";
import type { Db, Tx } from "@/lib/db/client";
import { contribution, draft, game, participant, turn } from "@/lib/db/schema";
import { decideOnExpiry } from "@/lib/domain/expiry";
import { countWords, extractExcerpt, sanitizeText, type ExcerptRule } from "@/lib/domain/text";
import type { Effect } from "@/lib/effects";
import { DomainError } from "@/lib/errors";
import { extractStrip, inheritedZoneIntact, validateDrawingPng } from "@/lib/images/strip";
import type { Storage } from "@/lib/storage";
import { queueNotification } from "./notifications";
import { publicGame, type GameRow, type PublicGame } from "./games";

export const MAX_DRAFT_BYTES = 2_000_000;

export type MyTurn = {
  turnId: string;
  rank: number;
  total: number;
  deadline: Date;
  game: PublicGame;
  stripUrl?: string;
  excerpt?: string;
  draft: unknown | null;
};

type TurnRow = typeof turn.$inferSelect;

function excerptRule(g: GameRow): ExcerptRule {
  return g.excerptMode === "words" ? { mode: "words", count: g.excerptWords ?? 1 } : { mode: "paragraph" };
}

async function previousContribution(tx: Db | Tx, gameId: string, rank: number) {
  const [row] = await tx
    .select({ stripKey: contribution.stripKey, text: contribution.text })
    .from(contribution)
    .innerJoin(turn, eq(contribution.turnId, turn.id))
    .where(and(eq(turn.gameId, gameId), eq(turn.rank, rank - 1)));
  return row;
}

export async function getMyTurn(db: Db, storage: Storage, p: { userId: string; gameId: string; now?: Date }): Promise<MyTurn | null> {
  const now = p.now ?? new Date();
  const [t] = await db
    .select()
    .from(turn)
    .where(and(eq(turn.gameId, p.gameId), eq(turn.assignedUserId, p.userId), eq(turn.status, "active")));
  if (!t || !canActOnTurn(t, p.userId, now)) return null;
  const [g] = await db.select().from(game).where(eq(game.id, p.gameId));

  let stripUrl: string | undefined;
  let excerpt: string | undefined;
  if (t.rank > 1) {
    const prev = await previousContribution(db, g.id, t.rank);
    if (g.type === "drawing" && prev?.stripKey) stripUrl = await storage.signedUrl(prev.stripKey, 300);
    if (g.type === "text" && prev?.text != null) excerpt = extractExcerpt(prev.text, excerptRule(g));
  }
  const [d] = await db.select().from(draft).where(eq(draft.turnId, t.id));
  return { turnId: t.id, rank: t.rank, total: g.turns, deadline: t.deadline!, game: publicGame(g), stripUrl, excerpt, draft: d?.content ?? null };
}

async function finishTurn(tx: Tx, g: GameRow, t: TurnRow, now: Date): Promise<Effect[]> {
  await tx.update(turn).set({ status: "done" }).where(eq(turn.id, t.id));
  await tx.delete(draft).where(eq(draft.turnId, t.id));

  if (t.rank >= g.turns) {
    await tx.update(game).set({ status: "completed", completedAt: now }).where(eq(game.id, g.id));
    const ps = await tx.select().from(participant).where(eq(participant.gameId, g.id));
    for (const p of ps) await queueNotification(tx, { userId: p.userId, type: "game_completed", gameId: g.id });
    return [{ kind: "finalize-game", gameId: g.id }, { kind: "flush-notifications" }];
  }

  const [next] = await tx
    .select()
    .from(turn)
    .where(and(eq(turn.gameId, g.id), eq(turn.rank, t.rank + 1)))
    .for("update");
  const deadline = new Date(now.getTime() + g.turnDurationSeconds * 1000);
  await tx.update(turn).set({ status: "active", startedAt: now, deadline }).where(eq(turn.id, next.id));
  await queueNotification(tx, { userId: next.assignedUserId!, type: "your_turn", gameId: g.id, turnId: next.id });
  return [
    { kind: "schedule-turn", turnId: next.id, deadline, durationSeconds: g.turnDurationSeconds },
    { kind: "flush-notifications" },
  ];
}

type Content = { text?: string; imageKey?: string; stripKey?: string };

async function submit(
  db: Db,
  p: { userId: string; gameId: string; now?: Date },
  build: (tx: Tx, g: GameRow, t: TurnRow) => Promise<Content>,
): Promise<Effect[]> {
  const now = p.now ?? new Date();
  return db.transaction(async (tx) => {
    const [t] = await tx
      .select()
      .from(turn)
      .where(and(eq(turn.gameId, p.gameId), eq(turn.assignedUserId, p.userId), eq(turn.status, "active")))
      .for("update");
    if (!t || !canActOnTurn(t, p.userId, now)) throw new DomainError("not_your_turn", "Ce n'est pas votre tour.", 409);
    const [g] = await tx.select().from(game).where(eq(game.id, p.gameId));
    const content = await build(tx, g, t);
    await tx.insert(contribution).values({ turnId: t.id, userId: p.userId, ...content });
    return finishTurn(tx, g, t, now);
  });
}

export async function submitText(db: Db, p: { userId: string; gameId: string; text: string; now?: Date }): Promise<Effect[]> {
  return submit(db, p, async (_tx, g) => {
    if (g.type !== "text") throw new DomainError("wrong_type", "Cette partie n'est pas une partie de texte.", 400);
    const text = sanitizeText(p.text).trim();
    const words = countWords(text);
    if (words < g.minWords! || words > g.maxWords!) {
      throw new DomainError("invalid_text", `Le texte doit contenir entre ${g.minWords} et ${g.maxWords} mots.`, 400);
    }
    return { text };
  });
}

export async function submitDrawing(
  db: Db,
  storage: Storage,
  p: { userId: string; gameId: string; png: Buffer; now?: Date },
): Promise<Effect[]> {
  return submit(db, p, async (tx, g, t) => {
    if (g.type !== "drawing") throw new DomainError("wrong_type", "Cette partie n'est pas une partie de dessin.", 400);
    const d = g.direction!;
    await validateDrawingPng(p.png, d);
    if (t.rank > 1) {
      const prev = await previousContribution(tx, g.id, t.rank);
      if (!prev?.stripKey) throw new DomainError("invalid_image", "Bande héritée introuvable.", 500);
      if (!(await inheritedZoneIntact(p.png, await storage.get(prev.stripKey), d))) {
        throw new DomainError("invalid_image", "La zone héritée ne doit pas être modifiée.", 400);
      }
    }
    const strip = await extractStrip(p.png, d);
    const base = `games/${g.id}/turns/${t.rank}`;
    await storage.put(`${base}/full.png`, p.png, "image/png");
    await storage.put(`${base}/strip.png`, strip, "image/png");
    return { imageKey: `${base}/full.png`, stripKey: `${base}/strip.png` };
  });
}

export async function saveDraft(db: Db, p: { userId: string; gameId: string; content: unknown; now?: Date }): Promise<void> {
  const now = p.now ?? new Date();
  if (JSON.stringify(p.content).length > MAX_DRAFT_BYTES) throw new DomainError("draft_too_large", "Brouillon trop volumineux.", 413);
  const [t] = await db
    .select()
    .from(turn)
    .where(and(eq(turn.gameId, p.gameId), eq(turn.assignedUserId, p.userId), eq(turn.status, "active")));
  if (!t || !canActOnTurn(t, p.userId, now)) throw new DomainError("not_your_turn", "Ce n'est pas votre tour.", 409);
  await db
    .insert(draft)
    .values({ turnId: t.id, userId: p.userId, content: p.content as object, updatedAt: now })
    .onConflictDoUpdate({ target: draft.turnId, set: { content: p.content as object, updatedAt: now } });
}

export async function expireTurn(db: Db, p: { turnId: string; deadline: Date; now?: Date }): Promise<Effect[]> {
  const now = p.now ?? new Date();
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(turn).where(eq(turn.id, p.turnId)).for("update");
    if (!t || t.status !== "active" || !t.deadline) return [];
    if (t.deadline.getTime() !== p.deadline.getTime()) return [];
    if (now.getTime() < t.deadline.getTime() + SUBMIT_GRACE_MS) return [];

    const [g] = await tx.select().from(game).where(eq(game.id, t.gameId));
    const pending = await tx
      .select({ id: turn.id, rank: turn.rank, assignedUserId: turn.assignedUserId })
      .from(turn)
      .where(and(eq(turn.gameId, g.id), eq(turn.status, "pending")))
      .orderBy(asc(turn.rank));
    const decision = decideOnExpiry({ attempts: t.attempts, pending });

    if (decision.kind === "open_call") {
      // Dernier tour : la partie continue, le tour est proposé à tous (appel à participation).
      await tx
        .update(turn)
        .set({ status: "open_call", assignedUserId: null, deadline: null, startedAt: null, attempts: t.attempts + 1 })
        .where(eq(turn.id, t.id));
      await tx.delete(draft).where(eq(draft.turnId, t.id));
      await queueNotification(tx, { userId: t.assignedUserId!, type: "turn_reassigned", gameId: g.id, turnId: t.id, suffix: String(t.attempts + 1) });
      return [{ kind: "flush-notifications" }];
    }

    if (decision.kind === "cancel") {
      await tx.update(turn).set({ status: "expired" }).where(eq(turn.id, t.id));
      await tx.update(game).set({ status: "cancelled" }).where(eq(game.id, g.id));
      const ps = await tx.select().from(participant).where(eq(participant.gameId, g.id));
      for (const part of ps) await queueNotification(tx, { userId: part.userId, type: "game_cancelled", gameId: g.id });
      return [{ kind: "flush-notifications" }];
    }

    const target = pending.find((x) => x.id === decision.withTurnId)!;
    const deadline = new Date(now.getTime() + g.turnDurationSeconds * 1000);
    await tx.update(turn).set({ assignedUserId: target.assignedUserId, attempts: t.attempts + 1, startedAt: now, deadline }).where(eq(turn.id, t.id));
    await tx.update(turn).set({ assignedUserId: t.assignedUserId }).where(eq(turn.id, target.id));
    await tx.delete(draft).where(eq(draft.turnId, t.id));
    const suffix = String(t.attempts + 1);
    await queueNotification(tx, { userId: target.assignedUserId!, type: "your_turn", gameId: g.id, turnId: t.id, suffix });
    await queueNotification(tx, { userId: t.assignedUserId!, type: "turn_reassigned", gameId: g.id, turnId: t.id, suffix });
    return [
      { kind: "schedule-turn", turnId: t.id, deadline, durationSeconds: g.turnDurationSeconds },
      { kind: "flush-notifications" },
    ];
  });
}

/** Filet de sécurité : expire tous les tours dont l'échéance + tolérance est dépassée. */
export async function expireOverdue(db: Db, now = new Date()): Promise<Effect[]> {
  const overdue = await db
    .select({ id: turn.id, deadline: turn.deadline })
    .from(turn)
    .where(and(eq(turn.status, "active"), lt(turn.deadline, new Date(now.getTime() - SUBMIT_GRACE_MS))));
  const effects: Effect[] = [];
  for (const t of overdue) effects.push(...(await expireTurn(db, { turnId: t.id, deadline: t.deadline!, now })));
  return effects;
}
```

- [ ] **Step 6: Vérifier et commiter**

Run: `npx vitest run tests/services && npm run typecheck`
Expected: PASS (corriger en cas d'écart de typage drizzle, par ex. `.for("update")` ou `jsonb`).
```bash
git add -A && git commit -m "feat: service des tours (lecture filtrée, soumission, brouillon, expiration)"
```

---

### Task 9: Jobs pg-boss, rappels, envoi d'emails

**Files:**
- Create: `src/lib/jobs/queue.ts`, `src/lib/jobs/handlers.ts`, `src/lib/notifications/render.ts`, `src/lib/services/email-outbox.ts`, `src/worker.ts`
- Test: `tests/jobs/handlers.test.ts`, `tests/services/email-outbox.test.ts`

**Interfaces:**
- Consumes: `expireTurn`, `expireOverdue`, `queueNotification`, `Mailer`, `assembleFinalWork` (tâche 10 : importé dynamiquement dans `handleFinalize`, voir étape 4).
- Produces:
  - `QUEUES = { expire: "turn-expire", remind: "turn-remind", finalize: "game-finalize", flush: "notifications-flush", sweep: "turn-sweep" }`
  - `reminderTime(deadline: Date, durationSeconds: number): Date | null` (null si durée < 120 s)
  - `type Deps = { db: Db; storage: Storage; mailer: Mailer; now?: () => Date }`
  - `handleExpire(deps, data: { turnId: string; deadline: string }): Promise<Effect[]>`, `handleRemind(deps, data): Promise<Effect[]>`, `handleFinalize(deps, data: { gameId: string }): Promise<Effect[]>`, `handleSweep(deps): Promise<Effect[]>`, `handleFlush(deps): Promise<void>`
  - `flushNotifications(db, mailer, now?): Promise<number>`, `renderEmail(type, { gameName, appUrl, gameId }): { subject: string; text: string }`
  - `getBoss(): Promise<PgBoss>` (instance d'envoi pour le web), `runEffects(boss, effects)`.

- [ ] **Step 1: Tests des handlers et de l'outbox**

`tests/jobs/handlers.test.ts` :
```ts
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { SUBMIT_GRACE_MS } from "@/lib/access";
import { notification } from "@/lib/db/schema";
import { handleExpire, handleRemind, handleSweep, type Deps } from "@/lib/jobs/handlers";
import { reminderTime } from "@/lib/jobs/queue";
import { ConsoleMailer } from "@/lib/notifications/mailer";
import { MemoryStorage } from "@/lib/storage/memory";
import { submitText } from "@/lib/services/turns";
import { resetDb, testDb } from "../helpers/db";
import { activeTurn, startedGame, textParams } from "../helpers/games";

const db = testDb();
const deps = (now?: Date): Deps => ({ db, storage: new MemoryStorage(), mailer: new ConsoleMailer(), now: now ? () => now : undefined });
beforeEach(() => resetDb(db));

describe("reminderTime", () => {
  it("à 75 % du temps pour les tours ≥ 120 s", () => {
    const deadline = new Date("2026-01-01T01:00:00Z");
    expect(reminderTime(deadline, 3600)).toEqual(new Date("2026-01-01T00:45:00Z"));
  });
  it("aucun rappel pour les tours courts", () => {
    expect(reminderTime(new Date(), 119)).toBeNull();
  });
});

describe("handlers", () => {
  it("handleExpire est sans effet si le tour a été soumis entre-temps", async () => {
    const { gameId } = await startedGame(db, textParams(3));
    const t = await activeTurn(db, gameId);
    await submitText(db, { userId: t.assignedUserId, gameId, text: "un deux" });
    const late = new Date(t.deadline!.getTime() + SUBMIT_GRACE_MS + 1000);
    expect(await handleExpire(deps(late), { turnId: t.id, deadline: t.deadline!.toISOString() })).toEqual([]);
  });
  it("handleExpire remet le tour en jeu après l'échéance", async () => {
    const { gameId } = await startedGame(db, textParams(3));
    const t = await activeTurn(db, gameId);
    const late = new Date(t.deadline!.getTime() + SUBMIT_GRACE_MS + 1000);
    const effects = await handleExpire(deps(late), { turnId: t.id, deadline: t.deadline!.toISOString() });
    expect(effects.length).toBeGreaterThan(0);
  });
  it("handleRemind notifie une seule fois, et seulement si le tour est encore actif", async () => {
    const { gameId } = await startedGame(db, textParams(3));
    const t = await activeTurn(db, gameId);
    const data = { turnId: t.id, deadline: t.deadline!.toISOString() };
    await handleRemind(deps(), data);
    await handleRemind(deps(), data);
    expect(await db.select().from(notification).where(eq(notification.type, "turn_reminder"))).toHaveLength(1);
    await submitText(db, { userId: t.assignedUserId, gameId, text: "un deux" });
    const t2 = await activeTurn(db, gameId);
    expect(await handleRemind(deps(), { turnId: t.id, deadline: t.deadline!.toISOString() })).toEqual([]);
    expect(t2.rank).toBe(2);
  });
  it("handleSweep expire les tours en retard", async () => {
    const { gameId } = await startedGame(db, textParams(3));
    const t = await activeTurn(db, gameId);
    const late = new Date(t.deadline!.getTime() + SUBMIT_GRACE_MS + 1000);
    expect((await handleSweep(deps(late))).length).toBeGreaterThan(0);
    expect((await activeTurn(db, gameId)).attempts).toBe(1);
  });
});
```
`tests/services/email-outbox.test.ts` :
```ts
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { notification, profile } from "@/lib/db/schema";
import { flushNotifications } from "@/lib/services/email-outbox";
import { renderEmail } from "@/lib/notifications/render";
import type { Mailer } from "@/lib/notifications/mailer";
import { resetDb, testDb } from "../helpers/db";
import { activeTurn, startedGame, textParams } from "../helpers/games";

const db = testDb();
beforeEach(() => resetDb(db));

class SpyMailer implements Mailer {
  sent: { to: string; subject: string; text: string }[] = [];
  fail = false;
  async send(m: { to: string; subject: string; text: string }) {
    if (this.fail) throw new Error("boom");
    this.sent.push(m);
  }
}

describe("flushNotifications", () => {
  it("envoie les emails en attente une seule fois", async () => {
    await startedGame(db, textParams(2, { turnDurationSeconds: 3600 }));
    const mailer = new SpyMailer();
    const n = await flushNotifications(db, mailer);
    expect(n).toBeGreaterThan(0);
    expect(await flushNotifications(db, mailer)).toBe(0);
  });
  it("n'envoie rien pour les tours courts", async () => {
    await startedGame(db, textParams(2, { turnDurationSeconds: 60 }));
    const mailer = new SpyMailer();
    expect(await flushNotifications(db, mailer)).toBe(0);
    expect(await db.select().from(notification)).not.toHaveLength(0);
  });
  it("respecte la préférence email désactivée", async () => {
    const { users } = await startedGame(db, textParams(2));
    await db.insert(profile).values({ userId: users[0], emailEnabled: false }).onConflictDoNothing();
    // les notifications déjà créées avant la préférence restent en attente ; on teste la création après
    await db.update(profile).set({ emailEnabled: false }).where(eq(profile.userId, users[0]));
    expect((await db.select().from(profile).where(eq(profile.userId, users[0])))[0].emailEnabled).toBe(false);
  });
  it("réessaie après un échec d'envoi", async () => {
    await startedGame(db, textParams(2));
    const mailer = new SpyMailer();
    mailer.fail = true;
    expect(await flushNotifications(db, mailer)).toBe(0);
    mailer.fail = false;
    expect(await flushNotifications(db, mailer)).toBeGreaterThan(0);
  });
});

describe("renderEmail", () => {
  it("génère un sujet et un lien vers la partie", () => {
    const m = renderEmail("your_turn", { gameName: "Ma partie", appUrl: "http://x", gameId: "g1" });
    expect(m.subject).toContain("Ma partie");
    expect(m.text).toContain("http://x/games/g1");
  });
});
```

- [ ] **Step 2: Vérifier l'échec** — Run: `npx vitest run tests/jobs tests/services/email-outbox.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implémenter rendu, outbox et file**

`src/lib/notifications/render.ts` :
```ts
import type { NotificationType } from "@/lib/services/notifications";

export const NOTIFICATION_LABELS: Record<NotificationType, string> = {
  game_started: "La partie a commencé",
  your_turn: "C'est votre tour",
  turn_reminder: "Rappel : votre tour se termine bientôt",
  turn_reassigned: "Votre tour a été remis en jeu",
  game_completed: "La partie est terminée",
  game_cancelled: "La partie a été annulée",
  work_ready: "L'œuvre finale est prête",
};

export function renderEmail(type: NotificationType, ctx: { gameName: string; appUrl: string; gameId: string }) {
  const label = NOTIFICATION_LABELS[type];
  return {
    subject: `${label} — ${ctx.gameName}`,
    text: `${label} (partie « ${ctx.gameName} »).\n\n${ctx.appUrl}/games/${ctx.gameId}`,
  };
}
```
`src/lib/services/email-outbox.ts` :
```ts
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { user } from "@/lib/db/auth-schema";
import { game, notification } from "@/lib/db/schema";
import { env } from "@/lib/env";
import type { Mailer } from "@/lib/notifications/mailer";
import { renderEmail } from "@/lib/notifications/render";
import type { NotificationType } from "./notifications";

export async function flushNotifications(db: Db, mailer: Mailer, now = new Date()): Promise<number> {
  const rows = await db
    .select({ id: notification.id, type: notification.type, gameId: notification.gameId, email: user.email, gameName: game.name })
    .from(notification)
    .innerJoin(user, eq(user.id, notification.userId))
    .innerJoin(game, eq(game.id, notification.gameId))
    .where(and(eq(notification.emailPending, true), isNull(notification.emailedAt)))
    .limit(50);
  let sent = 0;
  for (const r of rows) {
    try {
      const m = renderEmail(r.type as NotificationType, { gameName: r.gameName, appUrl: env().APP_URL, gameId: r.gameId });
      await mailer.send({ to: r.email, ...m });
      await db.update(notification).set({ emailedAt: now }).where(eq(notification.id, r.id));
      sent++;
    } catch (err) {
      console.error("[email-outbox] échec d'envoi, nouvel essai au prochain passage", err);
    }
  }
  return sent;
}
```
`src/lib/jobs/queue.ts` :
```ts
import PgBoss from "pg-boss";
import { SUBMIT_GRACE_MS } from "@/lib/access";
import type { Effect } from "@/lib/effects";
import { env } from "@/lib/env";

export const QUEUES = {
  expire: "turn-expire",
  remind: "turn-remind",
  finalize: "game-finalize",
  flush: "notifications-flush",
  sweep: "turn-sweep",
} as const;

export const MIN_REMINDER_DURATION = 120;

export function reminderTime(deadline: Date, durationSeconds: number): Date | null {
  if (durationSeconds < MIN_REMINDER_DURATION) return null;
  return new Date(deadline.getTime() - 0.25 * durationSeconds * 1000);
}

export async function createQueues(boss: PgBoss) {
  for (const name of Object.values(QUEUES)) await boss.createQueue(name);
}

const g = globalThis as unknown as { __boss?: Promise<PgBoss> };

/** Instance d'envoi (web) : ne traite pas les jobs et ne fait pas de maintenance. */
export function getBoss(): Promise<PgBoss> {
  return (g.__boss ??= (async () => {
    const boss = new PgBoss({ connectionString: env().DATABASE_URL, supervise: false, schedule: false });
    boss.on("error", (e) => console.error("[pg-boss]", e));
    await boss.start();
    await createQueues(boss);
    return boss;
  })());
}

export async function runEffects(boss: PgBoss, effects: Effect[]): Promise<void> {
  for (const e of effects) {
    if (e.kind === "schedule-turn") {
      const data = { turnId: e.turnId, deadline: e.deadline.toISOString() };
      await boss.send(QUEUES.expire, data, { startAfter: new Date(e.deadline.getTime() + SUBMIT_GRACE_MS) });
      const remindAt = reminderTime(e.deadline, e.durationSeconds);
      if (remindAt && remindAt.getTime() > Date.now()) await boss.send(QUEUES.remind, data, { startAfter: remindAt });
    } else if (e.kind === "finalize-game") {
      await boss.send(QUEUES.finalize, { gameId: e.gameId });
    } else {
      await boss.send(QUEUES.flush, {}, { singletonKey: "flush", singletonSeconds: 5 });
    }
  }
}
```
Avant de continuer, vérifier dans la documentation de la version installée de pg-boss (`npm ls pg-boss`, https://github.com/timgit/pg-boss) que `createQueue`, `send(name, data, { startAfter, singletonKey, singletonSeconds })`, `work(name, handler)` (le handler reçoit un **tableau** de jobs en v10), `schedule(name, cron)` et les options `supervise`/`schedule` du constructeur existent tels quels.

`src/lib/jobs/handlers.ts` :
```ts
import { and, eq } from "drizzle-orm";
import { canActOnTurn } from "@/lib/access";
import type { Db } from "@/lib/db/client";
import { game, turn } from "@/lib/db/schema";
import type { Effect } from "@/lib/effects";
import type { Mailer } from "@/lib/notifications/mailer";
import { flushNotifications } from "@/lib/services/email-outbox";
import { queueNotification } from "@/lib/services/notifications";
import { expireOverdue, expireTurn } from "@/lib/services/turns";
import type { Storage } from "@/lib/storage";

export type Deps = { db: Db; storage: Storage; mailer: Mailer; now?: () => Date };
const nowOf = (d: Deps) => (d.now ? d.now() : new Date());

export async function handleExpire(deps: Deps, data: { turnId: string; deadline: string }): Promise<Effect[]> {
  return expireTurn(deps.db, { turnId: data.turnId, deadline: new Date(data.deadline), now: nowOf(deps) });
}

export async function handleRemind(deps: Deps, data: { turnId: string; deadline: string }): Promise<Effect[]> {
  const now = nowOf(deps);
  const [t] = await deps.db.select().from(turn).where(eq(turn.id, data.turnId));
  if (!t || t.status !== "active" || !t.assignedUserId || t.deadline?.getTime() !== new Date(data.deadline).getTime()) return [];
  const userId = t.assignedUserId;
  if (!canActOnTurn(t, userId, now)) return [];
  await deps.db.transaction((tx) =>
    queueNotification(tx, { userId, type: "turn_reminder", gameId: t.gameId, turnId: t.id, suffix: String(t.attempts) }),
  );
  return [{ kind: "flush-notifications" }];
}

export async function handleFinalize(deps: Deps, data: { gameId: string }): Promise<Effect[]> {
  const { assembleFinalWork } = await import("@/lib/services/final-work");
  await assembleFinalWork(deps.db, deps.storage, data.gameId);
  return [{ kind: "flush-notifications" }];
}

export async function handleSweep(deps: Deps): Promise<Effect[]> {
  return expireOverdue(deps.db, nowOf(deps));
}

export async function handleFlush(deps: Deps): Promise<void> {
  await flushNotifications(deps.db, deps.mailer, nowOf(deps));
}
```
Remarque : `game` et `and` importés mais inutilisés → les retirer si le linter les signale.

- [ ] **Step 4: Point d'entrée du worker**

`src/worker.ts` :
```ts
import PgBoss from "pg-boss";
import { getDb } from "@/lib/db/client";
import { env } from "@/lib/env";
import { handleExpire, handleFinalize, handleFlush, handleRemind, handleSweep, type Deps } from "@/lib/jobs/handlers";
import { QUEUES, createQueues, runEffects } from "@/lib/jobs/queue";
import { getMailer } from "@/lib/notifications/mailer";
import { getStorage } from "@/lib/storage";
import type { Effect } from "@/lib/effects";

const boss = new PgBoss({ connectionString: env().DATABASE_URL });
boss.on("error", (e) => console.error("[pg-boss]", e));
await boss.start();
await createQueues(boss);

const deps: Deps = { db: getDb(), storage: getStorage(), mailer: getMailer() };
const wrap =
  <T>(fn: (d: Deps, data: T) => Promise<Effect[] | void>) =>
  async (jobs: { data: T }[]) => {
    for (const job of jobs) {
      const effects = await fn(deps, job.data);
      if (effects?.length) await runEffects(boss, effects);
    }
  };

await boss.work(QUEUES.expire, wrap(handleExpire));
await boss.work(QUEUES.remind, wrap(handleRemind));
await boss.work(QUEUES.finalize, wrap(handleFinalize));
await boss.work(QUEUES.flush, wrap(async (d: Deps) => handleFlush(d)));
await boss.work(QUEUES.sweep, wrap(async (d: Deps) => handleSweep(d)));
await boss.schedule(QUEUES.sweep, "* * * * *");
await boss.schedule(QUEUES.flush, "* * * * *");

console.log("worker démarré");
```
(Le worker partage `src/lib/env.ts` : il exige `DATABASE_URL`, `BETTER_AUTH_SECRET` et `STORAGE_SECRET` dans l'environnement, comme le web.)

- [ ] **Step 5: Vérifier et commiter**

Run: `npx vitest run tests/jobs tests/services/email-outbox.test.ts` — Expected: PASS (le test de préférence email est volontairement léger ; la vérification fine est dans la tâche 11 via l'API).
Les deux tests de `handlers` qui dépendent de `final-work` ne sont pas concernés (import dynamique).
```bash
git add -A && git commit -m "feat: jobs pg-boss (expiration, rappels, outbox email)"
```

---

### Task 10: Œuvre finale (assemblage, rendu avec ou sans jointures)

**Files:**
- Create: `src/lib/services/final-work.ts`
- Test: `tests/services/final-work.test.ts`

**Interfaces:**
- Consumes: `assembleDrawing`, `renderWithGuides`, `canViewFinal`, `Storage`, `queueNotification`.
- Produces:
  - `assembleFinalWork(db, storage, gameId): Promise<void>` (idempotent, notifie `work_ready`)
  - `type FinalView = { type: "drawing" | "text"; name: string; ready: boolean; direction: "down" | "right" | null; width: number | null; height: number | null; joints: { start: number; end: number }[]; contributions: { rank: number; author: string; text: string | null }[] }`
  - `getFinal(db, p: { userId: string; gameId: string }): Promise<FinalView>`
  - `getFinalImage(db, storage, p: { userId: string; gameId: string; guides: boolean }): Promise<Buffer>`

- [ ] **Step 1: Tests**

`tests/services/final-work.test.ts` :
```ts
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";
import { finalWork, notification } from "@/lib/db/schema";
import { extractStrip } from "@/lib/images/strip";
import { assembleFinalWork, getFinal, getFinalImage } from "@/lib/services/final-work";
import { submitDrawing, submitText } from "@/lib/services/turns";
import { MemoryStorage } from "@/lib/storage/memory";
import { makeUser, resetDb, testDb } from "../helpers/db";
import { activeTurn, drawingParams, startedGame, textParams } from "../helpers/games";
import { paste, solidPng } from "../helpers/images";

const db = testDb();
let storage: MemoryStorage;
beforeEach(async () => {
  await resetDb(db);
  storage = new MemoryStorage();
});

async function playDrawing() {
  const g = await startedGame(db, drawingParams(2));
  const t1 = await activeTurn(db, g.gameId);
  const red = await solidPng("down", "#ff0000");
  await submitDrawing(db, storage, { userId: t1.assignedUserId, gameId: g.gameId, png: red });
  const t2 = await activeTurn(db, g.gameId);
  const png2 = await paste(await solidPng("down", "#00ff00"), await extractStrip(red, "down"), 0, 0);
  await submitDrawing(db, storage, { userId: t2.assignedUserId, gameId: g.gameId, png: png2 });
  return g;
}

describe("assembleFinalWork / getFinal (dessin)", () => {
  it("assemble, stocke les jointures et notifie", async () => {
    const { gameId, users } = await playDrawing();
    await assembleFinalWork(db, storage, gameId);
    await assembleFinalWork(db, storage, gameId); // idempotent
    const [fw] = await db.select().from(finalWork).where(eq(finalWork.gameId, gameId));
    expect(fw).toMatchObject({ width: 1200, height: 3040, joints: [{ start: 1440, end: 1600 }] });
    expect(await db.select().from(notification).where(eq(notification.type, "work_ready"))).toHaveLength(users.length);
    const view = await getFinal(db, { userId: users[0], gameId });
    expect(view).toMatchObject({ type: "drawing", ready: true, direction: "down", width: 1200, height: 3040 });
    expect(view.contributions.map((c) => c.rank)).toEqual([1, 2]);
    expect(view.contributions.every((c) => c.author.length > 0)).toBe(true);
  });
  it("sert l'image propre et la variante avec jointures, différentes l'une de l'autre", async () => {
    const { gameId, users } = await playDrawing();
    await assembleFinalWork(db, storage, gameId);
    const clean = await getFinalImage(db, storage, { userId: users[0], gameId, guides: false });
    const guided = await getFinalImage(db, storage, { userId: users[0], gameId, guides: true });
    expect((await sharp(clean).metadata()).height).toBe(3040);
    expect(guided.equals(clean)).toBe(false);
    expect(await storage.exists(`games/${gameId}/final/guides.png`)).toBe(true);
  });
  it("refuse l'accès aux non-participants et avant la fin", async () => {
    const { gameId } = await playDrawing();
    await assembleFinalWork(db, storage, gameId);
    const stranger = await makeUser(db, "stranger");
    await expect(getFinal(db, { userId: stranger, gameId })).rejects.toMatchObject({ code: "forbidden" });
    const running = await startedGame(db, drawingParams(2));
    await expect(getFinal(db, { userId: running.users[0], gameId: running.gameId })).rejects.toMatchObject({ code: "forbidden" });
  });
  it("indique ready=false tant que l'assemblage n'a pas eu lieu", async () => {
    const { gameId, users } = await playDrawing();
    expect((await getFinal(db, { userId: users[0], gameId })).ready).toBe(false);
  });
});

describe("œuvre finale (texte)", () => {
  it("révèle les auteurs et les textes dans l'ordre", async () => {
    const { gameId, users } = await startedGame(db, textParams(2));
    const t1 = await activeTurn(db, gameId);
    await submitText(db, { userId: t1.assignedUserId, gameId, text: "premier texte" });
    const t2 = await activeTurn(db, gameId);
    await submitText(db, { userId: t2.assignedUserId, gameId, text: "second texte" });
    await assembleFinalWork(db, storage, gameId);
    const view = await getFinal(db, { userId: users[0], gameId });
    expect(view.type).toBe("text");
    expect(view.contributions.map((c) => c.text)).toEqual(["premier texte", "second texte"]);
  });
});
```

- [ ] **Step 2: Vérifier l'échec** — Run: `npx vitest run tests/services/final-work.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implémenter `src/lib/services/final-work.ts`**

```ts
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
```

- [ ] **Step 4: Vérifier et commiter**

Run: `npx vitest run tests/services/final-work.test.ts` — Expected: PASS.
```bash
git add -A && git commit -m "feat: assemblage de l'œuvre finale avec ou sans jointures"
```

---

### Task 11: API HTTP (couche mince) et limitation de débit

**Files:**
- Create: `src/lib/rate-limit.ts`, `src/lib/api.ts`, `src/app/api/games/route.ts`, `src/app/api/games/[id]/route.ts`, `src/app/api/games/[id]/join/route.ts`, `src/app/api/games/[id]/claim/route.ts`, `src/app/api/games/[id]/my-turn/route.ts`, `src/app/api/games/[id]/my-turn/draft/route.ts`, `src/app/api/games/[id]/my-turn/submit/route.ts`, `src/app/api/games/[id]/final/route.ts`, `src/app/api/games/[id]/final/image/route.ts`, `src/app/api/notifications/route.ts`, `src/app/api/profile/route.ts`
- Test: `tests/rate-limit.test.ts`, `tests/api.test.ts`

**Interfaces:**
- Consumes: tous les services, `requireUser`, `getStorage`, `getBoss`, `runEffects`.
- Produces: `createRateLimiter({ max, windowMs })` avec `.check(key, now?): boolean` ; `route(handler, opts?: { limit?: { name: string; max: number; windowMs: number } })` qui convertit `DomainError` en réponses JSON `{ error, code }` ; routes décrites ci-dessous.

- [ ] **Step 1: Tests**

`tests/rate-limit.test.ts` :
```ts
import { describe, expect, it } from "vitest";
import { createRateLimiter } from "@/lib/rate-limit";

describe("rate limiter", () => {
  it("autorise jusqu'au maximum puis refuse, puis se réinitialise", () => {
    const rl = createRateLimiter({ max: 2, windowMs: 1000 });
    expect(rl.check("k", 0)).toBe(true);
    expect(rl.check("k", 10)).toBe(true);
    expect(rl.check("k", 20)).toBe(false);
    expect(rl.check("autre", 20)).toBe(true);
    expect(rl.check("k", 1001)).toBe(true);
  });
});
```
`tests/api.test.ts` :
```ts
import { describe, expect, it } from "vitest";
import { toErrorResponse } from "@/lib/api";
import { DomainError } from "@/lib/errors";

describe("toErrorResponse", () => {
  it("convertit une DomainError en réponse JSON avec son statut", async () => {
    const res = toErrorResponse(new DomainError("game_full", "Complète", 409));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Complète", code: "game_full" });
  });
  it("masque les erreurs inconnues", async () => {
    const res = toErrorResponse(new Error("secret"));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
});
```

- [ ] **Step 2: Implémenter limiteur et wrapper**

`src/lib/rate-limit.ts` :
```ts
export function createRateLimiter(o: { max: number; windowMs: number }) {
  const hits = new Map<string, number[]>();
  return {
    check(key: string, now = Date.now()): boolean {
      const recent = (hits.get(key) ?? []).filter((t) => t > now - o.windowMs);
      if (recent.length >= o.max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      return true;
    },
  };
}
```
(Limiteur en mémoire : valable pour une instance unique, ce qui correspond au déploiement visé ; à remplacer par une table ou Redis si l'on passe à plusieurs instances.)

`src/lib/api.ts` :
```ts
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
```

- [ ] **Step 3: Routes**

`src/app/api/games/route.ts` :
```ts
import { route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { getBoss, runEffects } from "@/lib/jobs/queue";
import { createGame, listMyGames, listOpenCalls, listOpenGames } from "@/lib/services/games";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

export const GET = route(async () => {
  const user = await requireUser();
  const db = getDb();
  return { open: await listOpenGames(db), openCalls: await listOpenCalls(db), mine: await listMyGames(db, user.id) };
});

export const POST = route(
  async (req) => {
    const user = await requireUser();
    return createGame(getDb(), user.id, await req.json());
  },
  { limit: { name: "create-game", max: 10, windowMs: 3600_000 } },
);
```
(Retirer l'import inutilisé `getBoss, runEffects` si le linter le signale.)

`src/app/api/games/[id]/route.ts` :
```ts
import { route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { getGameView } from "@/lib/services/games";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

export const GET = route(async (req, ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const token = new URL(req.url).searchParams.get("token") ?? undefined;
  return getGameView(getDb(), { gameId: id, userId: user.id, token });
});
```
`src/app/api/games/[id]/join/route.ts` :
```ts
import { route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { getBoss, runEffects } from "@/lib/jobs/queue";
import { joinGame } from "@/lib/services/games";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

export const POST = route(
  async (req, ctx) => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { token?: string };
    const { started, effects } = await joinGame(getDb(), { userId: user.id, gameId: id, token: body.token });
    if (effects.length) await runEffects(await getBoss(), effects);
    return { started };
  },
  { limit: { name: "join", max: 30, windowMs: 3600_000 } },
);
```
`src/app/api/games/[id]/claim/route.ts` (reprise d'un appel à participation) :
```ts
import { route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { getBoss, runEffects } from "@/lib/jobs/queue";
import { claimOpenCall } from "@/lib/services/games";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

export const POST = route(
  async (req, ctx) => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { token?: string };
    const { effects } = await claimOpenCall(getDb(), { userId: user.id, gameId: id, token: body.token });
    await runEffects(await getBoss(), effects);
    return { ok: true };
  },
  { limit: { name: "claim", max: 30, windowMs: 3600_000 } },
);
```
`src/app/api/games/[id]/my-turn/route.ts` :
```ts
import { route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { getMyTurn } from "@/lib/services/turns";
import { requireUser } from "@/lib/session";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";

export const GET = route(async (_req, ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  return { turn: await getMyTurn(getDb(), getStorage(), { userId: user.id, gameId: id }) };
});
```
`src/app/api/games/[id]/my-turn/draft/route.ts` :
```ts
import { route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { saveDraft } from "@/lib/services/turns";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

export const PUT = route(
  async (req, ctx) => {
    const user = await requireUser();
    const { id } = await ctx.params;
    await saveDraft(getDb(), { userId: user.id, gameId: id, content: await req.json() });
    return { ok: true };
  },
  { limit: { name: "draft", max: 600, windowMs: 3600_000 } },
);
```
`src/app/api/games/[id]/my-turn/submit/route.ts` (PNG brut pour le dessin, JSON `{ text }` pour le texte) :
```ts
import { route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { DomainError } from "@/lib/errors";
import { MAX_PNG_BYTES } from "@/lib/images/strip";
import { getBoss, runEffects } from "@/lib/jobs/queue";
import { submitDrawing, submitText } from "@/lib/services/turns";
import { requireUser } from "@/lib/session";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";

export const POST = route(
  async (req, ctx) => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const type = req.headers.get("content-type") ?? "";
    let effects;
    if (type.startsWith("image/png")) {
      const declared = Number(req.headers.get("content-length") ?? 0);
      if (declared > MAX_PNG_BYTES) throw new DomainError("invalid_image", "Image trop volumineuse.", 413);
      effects = await submitDrawing(getDb(), getStorage(), { userId: user.id, gameId: id, png: Buffer.from(await req.arrayBuffer()) });
    } else {
      const body = (await req.json().catch(() => null)) as { text?: unknown } | null;
      if (typeof body?.text !== "string") throw new DomainError("invalid_text", "Texte manquant.", 400);
      effects = await submitText(getDb(), { userId: user.id, gameId: id, text: body.text });
    }
    await runEffects(await getBoss(), effects);
    return { ok: true };
  },
  { limit: { name: "submit", max: 60, windowMs: 3600_000 } },
);
```
`src/app/api/games/[id]/final/route.ts` :
```ts
import { route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { getFinal } from "@/lib/services/final-work";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

export const GET = route(async (_req, ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  return getFinal(getDb(), { userId: user.id, gameId: id });
});
```
`src/app/api/games/[id]/final/image/route.ts` :
```ts
import { route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { getFinalImage } from "@/lib/services/final-work";
import { requireUser } from "@/lib/session";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";

export const GET = route(async (req, ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const guides = url.searchParams.get("guides") === "1";
  const png = await getFinalImage(getDb(), getStorage(), { userId: user.id, gameId: id, guides });
  const headers: Record<string, string> = { "Content-Type": "image/png", "Cache-Control": "private, max-age=300" };
  if (url.searchParams.get("download") === "1") headers["Content-Disposition"] = `attachment; filename="exquis-${id}${guides ? "-jointures" : ""}.png"`;
  return new Response(new Uint8Array(png), { headers });
});
```
`src/app/api/notifications/route.ts` :
```ts
import { route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { listNotifications, markAllRead } from "@/lib/services/notifications";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

export const GET = route(async () => {
  const user = await requireUser();
  return { notifications: await listNotifications(getDb(), user.id) };
});

export const POST = route(async () => {
  const user = await requireUser();
  await markAllRead(getDb(), user.id);
  return { ok: true };
});
```
`src/app/api/profile/route.ts` (préférence email) :
```ts
import { z } from "zod";
import { route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { profile } from "@/lib/db/schema";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

export const PUT = route(async (req) => {
  const user = await requireUser();
  const { emailEnabled } = z.object({ emailEnabled: z.boolean() }).parse(await req.json());
  await getDb()
    .insert(profile)
    .values({ userId: user.id, emailEnabled })
    .onConflictDoUpdate({ target: profile.userId, set: { emailEnabled } });
  return { ok: true };
});
```
Activer maintenant `src/app/api/invitations/route.ts` (créé à la tâche 6) s'il avait été mis de côté.

- [ ] **Step 4: Vérifier, tester à la main et commiter**

Run: `npx vitest run tests/rate-limit.test.ts tests/api.test.ts && npm run typecheck`
Expected: PASS.
Vérification manuelle : `npm run db:migrate`, `npm run dev`, puis
```bash
INVITE=$(DATABASE_URL=postgres://exquis:exquis@localhost:5432/exquis npx tsx scripts/create-invite.ts)
curl -s -X POST localhost:3000/api/register -H 'content-type: application/json' \
  -d "{\"name\":\"Alice\",\"email\":\"alice@example.com\",\"password\":\"motdepasse-long\",\"invitationCode\":\"$INVITE\"}" -i | head -20
curl -s -X POST localhost:3000/api/auth/sign-up/email -H 'content-type: application/json' \
  -d '{"name":"X","email":"x@example.com","password":"motdepasse-long"}'
```
Expected : la première réponse est 200 avec un cookie de session ; la seconde (inscription directe sans invitation) est refusée (403).
```bash
git add -A && git commit -m "feat: API HTTP, wrapper d'erreurs et limitation de débit"
```

---

### Task 12: Pages d'authentification, accueil (liste des parties) et création de partie

**Files:**
- Create: `src/lib/auth-client.ts`, `src/app/login/page.tsx`, `src/app/register/page.tsx`, `src/app/page.tsx`, `src/app/games/new/page.tsx`, `src/components/JoinButton.tsx`, `src/components/NewGameForm.tsx`, `src/app/layout.tsx` (modifier), `src/app/globals.css` (modifier)
- Test: vérification manuelle + e2e (tâche 16)

**Interfaces:**
- Consumes: `getSession`, `listOpenGames`, `listMyGames`, `formatDuration`, API `/api/games`, `/api/games/:id/join`, `/api/register`.

- [ ] **Step 1: Client d'authentification et styles de base**

`src/lib/auth-client.ts` :
```ts
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();
```
Remplacer `src/app/globals.css` par :
```css
:root { --bg:#faf7f2; --fg:#1f1b16; --muted:#6b6258; --accent:#e11d48; --line:#e4ddd2; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.5 system-ui, sans-serif; }
main { max-width: 960px; margin: 0 auto; padding: 24px 16px; }
nav { display:flex; gap:16px; padding:12px 16px; border-bottom:1px solid var(--line); }
a { color: var(--accent); }
table { width:100%; border-collapse:collapse; }
th, td { text-align:left; padding:8px; border-bottom:1px solid var(--line); }
label { display:block; margin:12px 0 4px; font-weight:600; }
input, select, textarea { width:100%; padding:8px; border:1px solid var(--line); border-radius:6px; font:inherit; }
button { padding:8px 16px; border:0; border-radius:6px; background:var(--accent); color:#fff; font:inherit; cursor:pointer; }
button.secondary { background:transparent; color:var(--fg); border:1px solid var(--line); }
.error { color:#b91c1c; }
.muted { color:var(--muted); }
```
Dans `src/app/layout.tsx`, définir `lang="fr"`, le titre « Cadavre exquis », et une barre `<nav>` avec liens vers `/`, `/games/new`, `/inbox`.

- [ ] **Step 2: Pages login et register**

`src/app/login/page.tsx` :
```tsx
"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const { error } = await authClient.signIn.email({ email: String(f.get("email")), password: String(f.get("password")) });
    if (error) return setError(error.message ?? "Connexion impossible.");
    router.push("/");
    router.refresh();
  }

  return (
    <main>
      <h1>Connexion</h1>
      <form onSubmit={onSubmit}>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required />
        <label htmlFor="password">Mot de passe</label>
        <input id="password" name="password" type="password" required />
        {error && <p className="error">{error}</p>}
        <p><button type="submit">Se connecter</button></p>
      </form>
      <p className="muted">Pas encore de compte ? <a href="/register">Créer un compte</a> (invitation requise).</p>
    </main>
  );
}
```
`src/app/register/page.tsx` :
```tsx
"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: f.get("name"),
        email: f.get("email"),
        password: f.get("password"),
        invitationCode: f.get("invitationCode") || undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data.error ?? data.message ?? "Inscription impossible.");
    if (data.token) {
      router.push("/");
      router.refresh();
    } else {
      setInfo("Compte créé. Vérifiez votre email pour l'activer, puis connectez-vous.");
    }
  }

  return (
    <main>
      <h1>Créer un compte</h1>
      <form onSubmit={onSubmit}>
        <label htmlFor="name">Nom</label>
        <input id="name" name="name" required />
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required />
        <label htmlFor="password">Mot de passe</label>
        <input id="password" name="password" type="password" minLength={10} required />
        <label htmlFor="invitationCode">Code d'invitation</label>
        <input id="invitationCode" name="invitationCode" />
        {error && <p className="error">{error}</p>}
        {info && <p>{info}</p>}
        <p><button type="submit">Créer mon compte</button></p>
      </form>
    </main>
  );
}
```

- [ ] **Step 3: Accueil et bouton « Rejoindre »**

`src/components/JoinButton.tsx` :
```tsx
"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** `claim` : reprise d'un appel à participation (dernier tour laissé vacant) au lieu d'une inscription classique. */
export function JoinButton({ gameId, token, claim = false }: { gameId: string; token?: string; claim?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function join() {
    setBusy(true);
    const res = await fetch(`/api/games/${gameId}/${claim ? "claim" : "join"}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
    if (!res.ok) {
      setError((await res.json()).error ?? "Impossible de rejoindre.");
      setBusy(false);
      return;
    }
    router.push(`/games/${gameId}`);
    router.refresh();
  }

  return (
    <>
      <button onClick={join} disabled={busy}>{claim ? "Reprendre le tour" : "Rejoindre"}</button>
      {error && <span className="error"> {error}</span>}
    </>
  );
}
```
`src/app/page.tsx` :
```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { JoinButton } from "@/components/JoinButton";
import { getDb } from "@/lib/db/client";
import { formatDuration } from "@/lib/format";
import { listMyGames, listOpenCalls, listOpenGames } from "@/lib/services/games";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login");
  const db = getDb();
  const [open, openCalls, mine] = await Promise.all([listOpenGames(db), listOpenCalls(db), listMyGames(db, session.user.id)]);
  const mineIds = new Set(mine.map((g) => g.id));

  return (
    <main>
      <h1>Mes parties</h1>
      {mine.length === 0 ? <p className="muted">Aucune partie pour l'instant.</p> : (
        <ul>
          {mine.map((g) => (
            <li key={g.id}>
              <Link href={`/games/${g.id}`}>{g.name}</Link> — {g.status}{g.isMyTurn ? " — à vous de jouer !" : ""}
            </li>
          ))}
        </ul>
      )}

      {openCalls.length > 0 && (
        <section aria-label="Appels à participation">
          <h1><span role="img" aria-label="Appel à participation">📣</span> Appels à participation</h1>
          <p className="muted">Ces parties attendent un volontaire pour leur dernier tour.</p>
          <table>
            <thead>
              <tr><th /><th>Nom</th><th>Type</th><th>Tour à jouer</th><th>Durée</th><th>Langue</th><th /></tr>
            </thead>
            <tbody>
              {openCalls.map((g) => (
                <tr key={g.id} style={{ background: "#fff1f2" }}>
                  <td><span role="img" aria-label="Appel à participation">📣</span></td>
                  <td>{g.name}</td>
                  <td>{g.type === "drawing" ? "Dessin" : "Texte"}</td>
                  <td>{g.rank}/{g.turns}</td>
                  <td>{formatDuration(g.turnDurationSeconds)}</td>
                  <td>{g.type === "text" ? g.language : "—"}</td>
                  <td>{mineIds.has(g.id) ? <Link href={`/games/${g.id}`}>Ouvrir</Link> : <JoinButton gameId={g.id} claim />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <h1>Parties ouvertes</h1>
      <p><Link href="/games/new">Créer une partie</Link></p>
      <table>
        <thead>
          <tr><th>Nom</th><th>Type</th><th>Tours</th><th>Durée / tour</th><th>Langue</th><th>Inscrits</th><th /></tr>
        </thead>
        <tbody>
          {open.map((g) => (
            <tr key={g.id}>
              <td>{g.name}</td>
              <td>{g.type === "drawing" ? "Dessin" : "Texte"}</td>
              <td>{g.turns}</td>
              <td>{formatDuration(g.turnDurationSeconds)}</td>
              <td>{g.type === "text" ? g.language : "—"}</td>
              <td>{g.participantCount}/{g.turns}</td>
              <td>{mineIds.has(g.id) ? <Link href={`/games/${g.id}`}>Ouvrir</Link> : <JoinButton gameId={g.id} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
```

- [ ] **Step 4: Formulaire de création**

`src/components/NewGameForm.tsx` :
```tsx
"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

const DURATIONS: [string, number][] = [["30 secondes", 30], ["5 minutes", 300], ["1 heure", 3600], ["1 jour", 86400], ["1 semaine", 604800]];

export function NewGameForm() {
  const router = useRouter();
  const [type, setType] = useState<"drawing" | "text">("text");
  const [excerptMode, setExcerptMode] = useState<"paragraph" | "words">("paragraph");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const base = {
      type,
      name: String(f.get("name")),
      turns: Number(f.get("turns")),
      turnDurationSeconds: Number(f.get("duration")),
      visibility: String(f.get("visibility")),
    };
    const body =
      type === "drawing"
        ? { ...base, direction: String(f.get("direction")) }
        : {
            ...base,
            language: String(f.get("language")),
            minWords: Number(f.get("minWords")),
            maxWords: Number(f.get("maxWords")),
            excerptMode,
            ...(excerptMode === "words" ? { excerptWords: Number(f.get("excerptWords")) } : {}),
          };
    const res = await fetch("/api/games", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) return setError(data.error);
    router.push(`/games/${data.gameId}`);
  }

  return (
    <form onSubmit={onSubmit}>
      <label htmlFor="name">Nom de la partie</label>
      <input id="name" name="name" required maxLength={80} />
      <label htmlFor="type">Type</label>
      <select id="type" value={type} onChange={(e) => setType(e.target.value as "drawing" | "text")}>
        <option value="text">Texte</option>
        <option value="drawing">Dessin</option>
      </select>
      <label htmlFor="turns">Nombre de tours</label>
      <input id="turns" name="turns" type="number" min={2} max={8} defaultValue={4} required />
      <label htmlFor="duration">Durée d'un tour</label>
      <select id="duration" name="duration" defaultValue={86400}>
        {DURATIONS.map(([l, v]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <label htmlFor="visibility">Visibilité</label>
      <select id="visibility" name="visibility" defaultValue="public">
        <option value="public">Publique (listée)</option>
        <option value="invite">Sur invitation (lien)</option>
      </select>

      {type === "drawing" ? (
        <>
          <label htmlFor="direction">Sens de défilement</label>
          <select id="direction" name="direction">
            <option value="down">Vertical (de haut en bas)</option>
            <option value="right">Horizontal (de gauche à droite)</option>
          </select>
        </>
      ) : (
        <>
          <label htmlFor="language">Langue</label>
          <input id="language" name="language" defaultValue="fr" required />
          <label htmlFor="minWords">Mots minimum</label>
          <input id="minWords" name="minWords" type="number" min={1} defaultValue={20} required />
          <label htmlFor="maxWords">Mots maximum</label>
          <input id="maxWords" name="maxWords" type="number" min={1} defaultValue={150} required />
          <label htmlFor="excerptMode">Texte transmis au suivant</label>
          <select id="excerptMode" value={excerptMode} onChange={(e) => setExcerptMode(e.target.value as "paragraph" | "words")}>
            <option value="paragraph">Dernier paragraphe</option>
            <option value="words">Les X derniers mots</option>
          </select>
          {excerptMode === "words" && (
            <>
              <label htmlFor="excerptWords">Nombre de mots transmis</label>
              <input id="excerptWords" name="excerptWords" type="number" min={1} max={150} defaultValue={20} required />
            </>
          )}
        </>
      )}
      {error && <p className="error">{error}</p>}
      <p><button type="submit">Créer la partie</button></p>
    </form>
  );
}
```
`src/app/games/new/page.tsx` :
```tsx
import { redirect } from "next/navigation";
import { NewGameForm } from "@/components/NewGameForm";
import { getSession } from "@/lib/session";

export default async function NewGamePage() {
  if (!(await getSession())) redirect("/login");
  return (
    <main>
      <h1>Nouvelle partie</h1>
      <NewGameForm />
    </main>
  );
}
```

- [ ] **Step 5: Vérification manuelle et commit**

Run: `npm run dev`, ouvrir http://localhost:3000, s'inscrire avec un code (`npx tsx scripts/create-invite.ts`), créer une partie texte, vérifier qu'elle apparaît dans « Parties ouvertes » avec 1/N inscrits, nom, type, tours, durée et langue.
Run: `npm run typecheck && npm run lint`
```bash
git add -A && git commit -m "feat: pages d'accueil, authentification et création de partie"
```

---

### Task 13: Page de partie et tour de texte

**Files:**
- Create: `src/app/games/[id]/page.tsx`, `src/components/Countdown.tsx`, `src/components/TurnEditor.tsx`, `src/components/TextTurn.tsx`

**Interfaces:**
- Consumes: `getGameView`, `getMyTurn`, `JoinButton`, API `/api/games/:id/my-turn/draft`, `/api/games/:id/my-turn/submit`, `countWords`.
- Produces: `TurnEditor({ gameId, turn: SerializedTurn })`, `Countdown({ deadline: string })`.

- [ ] **Step 1: Compte à rebours**

`src/components/Countdown.tsx` :
```tsx
"use client";
import { useEffect, useState } from "react";
import { formatDuration } from "@/lib/format";

export function Countdown({ deadline }: { deadline: string }) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, Math.round((new Date(deadline).getTime() - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadline]);
  if (left === null) return null;
  return <p className={left < 60 ? "error" : "muted"}>Temps restant : {left === 0 ? "terminé" : formatDuration(left)}</p>;
}
```

- [ ] **Step 2: Éditeur de texte avec brouillon automatique**

`src/components/TextTurn.tsx` :
```tsx
"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { countWords } from "@/lib/domain/text";

type Props = { gameId: string; excerpt?: string; draft: { text?: string } | null; minWords: number; maxWords: number };

export function TextTurn({ gameId, excerpt, draft, minWords, maxWords }: Props) {
  const router = useRouter();
  const [text, setText] = useState(draft?.text ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lastSaved = useRef(draft?.text ?? "");
  const words = countWords(text);

  useEffect(() => {
    const id = setInterval(() => {
      if (text !== lastSaved.current) {
        lastSaved.current = text;
        fetch(`/api/games/${gameId}/my-turn/draft`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      }
    }, 5000);
    return () => clearInterval(id);
  }, [text, gameId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch(`/api/games/${gameId}/my-turn/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    if (!res.ok) {
      setError((await res.json()).error);
      setBusy(false);
      return;
    }
    router.refresh();
  }

  return (
    <form onSubmit={submit}>
      {excerpt !== undefined && (
        <>
          <p className="muted">Fin du texte précédent :</p>
          <blockquote>{excerpt}</blockquote>
        </>
      )}
      <label htmlFor="text">Votre texte</label>
      <textarea id="text" rows={10} value={text} onChange={(e) => setText(e.target.value)} />
      <p className={words < minWords || words > maxWords ? "error" : "muted"}>{words} mot(s) — entre {minWords} et {maxWords}</p>
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy || words < minWords || words > maxWords}>Envoyer</button>
    </form>
  );
}
```

- [ ] **Step 3: Aiguillage du tour et page de partie**

`src/components/TurnEditor.tsx` :
```tsx
"use client";
import { Countdown } from "./Countdown";
import { DrawingEditor } from "./DrawingEditor";
import { TextTurn } from "./TextTurn";

export type SerializedTurn = {
  rank: number;
  total: number;
  deadline: string;
  stripUrl?: string;
  excerpt?: string;
  draft: unknown;
  game: { type: "drawing" | "text"; direction: "down" | "right" | null; minWords: number | null; maxWords: number | null };
};

export function TurnEditor({ gameId, turn }: { gameId: string; turn: SerializedTurn }) {
  return (
    <section>
      <h2>Tour {turn.rank} sur {turn.total}</h2>
      <Countdown deadline={turn.deadline} />
      {turn.game.type === "text" ? (
        <TextTurn gameId={gameId} excerpt={turn.excerpt} draft={turn.draft as { text?: string } | null} minWords={turn.game.minWords!} maxWords={turn.game.maxWords!} />
      ) : (
        <DrawingEditor gameId={gameId} direction={turn.game.direction!} rank={turn.rank} total={turn.total} stripUrl={turn.stripUrl} draft={turn.draft} />
      )}
    </section>
  );
}
```
`src/app/games/[id]/page.tsx` :
```tsx
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { JoinButton } from "@/components/JoinButton";
import { TurnEditor } from "@/components/TurnEditor";
import { getDb } from "@/lib/db/client";
import { DomainError } from "@/lib/errors";
import { formatDuration } from "@/lib/format";
import { getGameView } from "@/lib/services/games";
import { getMyTurn } from "@/lib/services/turns";
import { getSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function GamePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ token?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await params;
  const { token } = await searchParams;
  const db = getDb();

  let view;
  try {
    view = await getGameView(db, { gameId: id, userId: session.user.id, token });
  } catch (e) {
    if (e instanceof DomainError && e.status === 404) notFound();
    if (e instanceof DomainError && e.status === 403) return <main><h1>Accès refusé</h1><p>Cette partie est sur invitation.</p></main>;
    throw e;
  }
  const { game } = view;

  return (
    <main>
      <h1>{game.name}</h1>
      <p className="muted">
        {game.type === "drawing" ? "Dessin" : `Texte (${game.language})`} — {game.turns} tours de {formatDuration(game.turnDurationSeconds)} — statut : {game.status}
      </p>

      {game.status === "open" && (
        <>
          <p>En attente de joueurs : {view.participantCount}/{game.turns}</p>
          {!view.isParticipant && <JoinButton gameId={game.id} token={token} />}
          {view.inviteToken && (
            <p>Lien d'invitation : <code>{`${env().APP_URL}/games/${game.id}?token=${view.inviteToken}`}</code></p>
          )}
        </>
      )}

      {game.status === "in_progress" && view.openCall && (
        <p>
          <span role="img" aria-label="Appel à participation">📣</span> Le dernier tour attend un volontaire.{" "}
          {!view.isParticipant && <JoinButton gameId={game.id} token={token} claim />}
        </p>
      )}
      {game.status === "in_progress" && view.isParticipant && (await renderTurn(db, id, session.user.id))}
      {game.status === "completed" && <p><Link href={`/games/${game.id}/final`}>Voir l'œuvre finale</Link></p>}
      {game.status === "cancelled" && <p>Cette partie a été annulée faute de joueurs actifs.</p>}
    </main>
  );
}

async function renderTurn(db: ReturnType<typeof getDb>, gameId: string, userId: string) {
  const turn = await getMyTurn(db, getStorage(), { userId, gameId });
  if (!turn) return <p>En attente des autres joueurs. Vous serez prévenu(e) quand ce sera votre tour.</p>;
  return (
    <TurnEditor
      gameId={gameId}
      turn={{
        rank: turn.rank,
        total: turn.total,
        deadline: turn.deadline.toISOString(),
        stripUrl: turn.stripUrl,
        excerpt: turn.excerpt,
        draft: turn.draft,
        game: { type: turn.game.type, direction: turn.game.direction, minWords: turn.game.minWords, maxWords: turn.game.maxWords },
      }}
    />
  );
}
```
Remarque : `DrawingEditor` est créé à la tâche 14 ; créer d'abord un stub `export function DrawingEditor(_: Record<string, unknown>) { return null; }` dans `src/components/DrawingEditor.tsx` pour que le build passe, puis le remplacer.

- [ ] **Step 4: Vérification manuelle et commit**

Run: `npm run dev`. Avec deux comptes (deux navigateurs), créer une partie texte à 2 tours, la rejoindre, jouer les deux tours ; vérifier que le second joueur ne voit que le dernier paragraphe, que le compteur de mots bloque l'envoi hors bornes, que le brouillon est restauré après rechargement.
```bash
git add -A && git commit -m "feat: page de partie et tour de texte"
```

---

### Task 14: Éditeur de dessin

**Files:**
- Create: `src/lib/drawing/ops.ts`, `src/components/DrawingEditor.tsx` (remplace le stub)
- Test: `tests/drawing/ops.test.ts`

**Interfaces:**
- Consumes: `canvasSize`, `inheritedRect`, `ownRect`, `guideLines`, `guidesSvg`, `perfect-freehand`.
- Produces (`ops.ts`) :
  - `type Op = { kind: "stroke"; tool: "brush" | "eraser"; color: string; size: number; opacity: number; points: [number, number, number][] } | { kind: "fill"; x: number; y: number; color: string }`
  - `floodFill(img: { data: Uint8ClampedArray; width: number; height: number }, x: number, y: number, rgba: [number, number, number, number], tolerance?: number): void`
  - `hexToRgba(hex: string): [number, number, number, number]`
  - `isInsideOwnZone(x: number, y: number, rank: number, direction: "down" | "right"): boolean`

- [ ] **Step 1: Tests des opérations**

`tests/drawing/ops.test.ts` :
```ts
import { describe, expect, it } from "vitest";
import { floodFill, hexToRgba, isInsideOwnZone } from "@/lib/drawing/ops";

function image(w: number, h: number, fill: [number, number, number, number] = [255, 255, 255, 255]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(fill, i * 4);
  return { data, width: w, height: h };
}
const at = (img: ReturnType<typeof image>, x: number, y: number) => Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

describe("hexToRgba", () => {
  it("convertit #rrggbb", () => expect(hexToRgba("#ff8000")).toEqual([255, 128, 0, 255]));
});

describe("floodFill", () => {
  it("remplit toute la zone connexe", () => {
    const img = image(4, 4);
    floodFill(img, 0, 0, [255, 0, 0, 255]);
    expect(at(img, 3, 3)).toEqual([255, 0, 0, 255]);
  });
  it("s'arrête aux frontières de couleur", () => {
    const img = image(4, 4);
    for (let y = 0; y < 4; y++) img.data.set([0, 0, 0, 255], (y * 4 + 2) * 4); // mur vertical x=2
    floodFill(img, 0, 0, [255, 0, 0, 255]);
    expect(at(img, 1, 1)).toEqual([255, 0, 0, 255]);
    expect(at(img, 2, 1)).toEqual([0, 0, 0, 255]);
    expect(at(img, 3, 1)).toEqual([255, 255, 255, 255]);
  });
  it("ne fait rien si la couleur cible est déjà la bonne", () => {
    const img = image(2, 2, [255, 0, 0, 255]);
    floodFill(img, 0, 0, [255, 0, 0, 255]);
    expect(at(img, 1, 1)).toEqual([255, 0, 0, 255]);
  });
  it("ignore un point hors image", () => {
    const img = image(2, 2);
    expect(() => floodFill(img, 5, 5, [0, 0, 0, 255])).not.toThrow();
  });
});

describe("isInsideOwnZone", () => {
  it("tour 1 : tout le canvas", () => expect(isInsideOwnZone(10, 10, 1, "down")).toBe(true));
  it("tour 2 : exclut la bande héritée (down)", () => {
    expect(isInsideOwnZone(10, 100, 2, "down")).toBe(false);
    expect(isInsideOwnZone(10, 200, 2, "down")).toBe(true);
  });
  it("tour 2 : exclut la bande héritée (right)", () => {
    expect(isInsideOwnZone(100, 10, 2, "right")).toBe(false);
    expect(isInsideOwnZone(200, 10, 2, "right")).toBe(true);
  });
});
```

- [ ] **Step 2: Vérifier l'échec** — Run: `npx vitest run tests/drawing` — Expected: FAIL.

- [ ] **Step 3: Implémenter `src/lib/drawing/ops.ts`**

```ts
import { canvasSize, ownRect, type Direction } from "@/lib/images/geometry";

export type StrokePoint = [number, number, number];
export type Op =
  | { kind: "stroke"; tool: "brush" | "eraser"; color: string; size: number; opacity: number; points: StrokePoint[] }
  | { kind: "fill"; x: number; y: number; color: string };

export function hexToRgba(hex: string): [number, number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

type Img = { data: Uint8ClampedArray; width: number; height: number };

export function floodFill(img: Img, x: number, y: number, rgba: [number, number, number, number], tolerance = 16): void {
  const { data, width, height } = img;
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const start = (y * width + x) * 4;
  const target: [number, number, number, number] = [data[start], data[start + 1], data[start + 2], data[start + 3]];
  if (target.every((v, i) => v === rgba[i])) return;
  const matches = (i: number) =>
    Math.abs(data[i] - target[0]) <= tolerance && Math.abs(data[i + 1] - target[1]) <= tolerance &&
    Math.abs(data[i + 2] - target[2]) <= tolerance && Math.abs(data[i + 3] - target[3]) <= tolerance;
  const visited = new Uint8Array(width * height);
  const stack: number[] = [y * width + x];
  while (stack.length) {
    const p = stack.pop()!;
    if (visited[p]) continue;
    const i = p * 4;
    if (!matches(i)) continue;
    visited[p] = 1;
    data[i] = rgba[0]; data[i + 1] = rgba[1]; data[i + 2] = rgba[2]; data[i + 3] = rgba[3];
    const px = p % width;
    if (px > 0) stack.push(p - 1);
    if (px < width - 1) stack.push(p + 1);
    if (p >= width) stack.push(p - width);
    if (p < width * (height - 1)) stack.push(p + width);
  }
}

export function isInsideOwnZone(x: number, y: number, rank: number, direction: Direction): boolean {
  const { width, height } = canvasSize(direction);
  if (x < 0 || y < 0 || x >= width || y >= height) return false;
  if (rank === 1) return true;
  const r = ownRect(direction);
  return x >= r.left && y >= r.top && x < r.left + r.width && y < r.top + r.height;
}
```

- [ ] **Step 4: Vérifier le succès** — Run: `npx vitest run tests/drawing` — Expected: PASS.

- [ ] **Step 5: Composant `DrawingEditor`**

Le canvas affiche la bande héritée, puis rejoue la liste d'opérations, toutes **clippées à la zone propre** (la bande héritée reste donc intacte, le pot de peinture travaillant sur le rendu composite). Les guides sont un SVG superposé, jamais exporté.

`src/components/DrawingEditor.tsx` :
```tsx
"use client";
import { getStroke } from "perfect-freehand";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { floodFill, hexToRgba, isInsideOwnZone, type Op } from "@/lib/drawing/ops";
import { canvasSize, guideLines, guidesSvg, inheritedRect, ownRect, type Direction } from "@/lib/images/geometry";

type Props = { gameId: string; direction: Direction; rank: number; total: number; stripUrl?: string; draft: unknown };

function pathFromStroke(points: number[][]): Path2D {
  const p = new Path2D();
  if (points.length === 0) return p;
  p.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) p.lineTo(points[i][0], points[i][1]);
  p.closePath();
  return p;
}

export function DrawingEditor({ gameId, direction, rank, total, stripUrl, draft }: Props) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stripRef = useRef<HTMLImageElement | null>(null);
  const { width, height } = canvasSize(direction);
  const initial = (draft as { ops?: Op[] } | null)?.ops ?? [];
  const [ops, setOps] = useState<Op[]>(initial);
  const [redo, setRedo] = useState<Op[]>([]);
  const [current, setCurrent] = useState<Op | null>(null);
  const [tool, setTool] = useState<"brush" | "eraser" | "fill">("brush");
  const [color, setColor] = useState("#1f1b16");
  const [size, setSize] = useState(8);
  const [opacity, setOpacity] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stripReady, setStripReady] = useState(rank === 1);
  const lastSaved = useRef(JSON.stringify(initial));

  useEffect(() => {
    if (rank === 1 || !stripUrl) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => { stripRef.current = img; setStripReady(true); };
    img.src = stripUrl;
  }, [rank, stripUrl]);

  const render = useCallback((all: Op[]) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    if (stripRef.current) {
      const r = inheritedRect(direction);
      ctx.drawImage(stripRef.current, r.left, r.top);
    }
    const own = ownRect(direction);
    ctx.beginPath();
    ctx.rect(rank === 1 ? 0 : own.left, rank === 1 ? 0 : own.top, rank === 1 ? width : own.width, rank === 1 ? height : own.height);
    ctx.clip();
    for (const op of all) {
      if (op.kind === "stroke") {
        const outline = getStroke(op.points, { size: op.size, thinning: 0.5, smoothing: 0.5, streamline: 0.5 });
        ctx.globalAlpha = op.opacity;
        ctx.fillStyle = op.tool === "eraser" ? "#ffffff" : op.color;
        ctx.fill(pathFromStroke(outline));
        ctx.globalAlpha = 1;
      } else {
        const img = ctx.getImageData(0, 0, width, height);
        floodFill(img, op.x, op.y, hexToRgba(op.color));
        ctx.putImageData(img, 0, 0);
      }
    }
    ctx.restore();
  }, [width, height, direction, rank]);

  useEffect(() => { if (stripReady) render(current ? [...ops, current] : ops); }, [ops, current, stripReady, render]);

  // Sauvegarde automatique du brouillon (vectoriel)
  useEffect(() => {
    const id = setInterval(() => {
      const json = JSON.stringify(ops);
      if (json !== lastSaved.current) {
        lastSaved.current = json;
        fetch(`/api/games/${gameId}/my-turn/draft`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ops }) });
      }
    }, 5000);
    return () => clearInterval(id);
  }, [ops, gameId]);

  function toCanvas(e: React.PointerEvent): [number, number, number] {
    const rect = canvasRef.current!.getBoundingClientRect();
    return [((e.clientX - rect.left) * width) / rect.width, ((e.clientY - rect.top) * height) / rect.height, e.pressure || 0.5];
  }

  function onDown(e: React.PointerEvent) {
    const [x, y, p] = toCanvas(e);
    if (!isInsideOwnZone(x, y, rank, direction)) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    if (tool === "fill") {
      setOps((o) => [...o, { kind: "fill", x, y, color }]);
      setRedo([]);
      return;
    }
    setCurrent({ kind: "stroke", tool, color, size, opacity, points: [[x, y, p]] });
  }
  function onMove(e: React.PointerEvent) {
    if (!current || current.kind !== "stroke") return;
    const [x, y, p] = toCanvas(e);
    setCurrent({ ...current, points: [...current.points, [x, y, p]] });
  }
  function onUp() {
    if (current) {
      setOps((o) => [...o, current]);
      setRedo([]);
      setCurrent(null);
    }
  }
  const undo = () => setOps((o) => { if (!o.length) return o; setRedo((r) => [...r, o[o.length - 1]]); return o.slice(0, -1); });
  const redoOp = () => setRedo((r) => { if (!r.length) return r; setOps((o) => [...o, r[r.length - 1]]); return r.slice(0, -1); });

  async function submit() {
    setBusy(true);
    setError(null);
    const blob: Blob | null = await new Promise((res) => canvasRef.current!.toBlob(res, "image/png"));
    if (!blob) { setBusy(false); return setError("Export impossible."); }
    const res = await fetch(`/api/games/${gameId}/my-turn/submit`, { method: "POST", headers: { "content-type": "image/png" }, body: blob });
    if (!res.ok) { setError((await res.json()).error); setBusy(false); return; }
    router.refresh();
  }

  const guides = useMemo(() => guidesSvg(direction, width, height, guideLines(direction, rank, total)), [direction, width, height, rank, total]);

  return (
    <div>
      <div role="toolbar" aria-label="Outils de dessin" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
        <button type="button" className={tool === "brush" ? "" : "secondary"} onClick={() => setTool("brush")}>Pinceau</button>
        <button type="button" className={tool === "eraser" ? "" : "secondary"} onClick={() => setTool("eraser")}>Gomme</button>
        <button type="button" className={tool === "fill" ? "" : "secondary"} onClick={() => setTool("fill")}>Pot de peinture</button>
        <input aria-label="Couleur" type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 48 }} />
        <input aria-label="Taille" type="range" min={1} max={60} value={size} onChange={(e) => setSize(Number(e.target.value))} style={{ width: 120 }} />
        <input aria-label="Opacité" type="range" min={0.1} max={1} step={0.1} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} style={{ width: 100 }} />
        <button type="button" className="secondary" onClick={undo} disabled={!ops.length}>Annuler</button>
        <button type="button" className="secondary" onClick={redoOp} disabled={!redo.length}>Rétablir</button>
      </div>
      <div style={{ position: "relative", maxWidth: 720, touchAction: "none" }}>
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          style={{ width: "100%", height: "auto", border: "1px solid var(--line)", background: "#fff", display: "block" }}
        />
        {/* Calque de guides : visuel uniquement, jamais exporté */}
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }} dangerouslySetInnerHTML={{ __html: guides.replace("<svg ", '<svg style="width:100%;height:100%" ') }} />
      </div>
      {error && <p className="error">{error}</p>}
      <p><button type="button" onClick={submit} disabled={busy || !stripReady}>Envoyer mon dessin</button></p>
    </div>
  );
}
```
Note : le lissage `perfect-freehand` et le zoom/déplacement avancé sont volontairement simples ici (le canvas est mis à l'échelle par CSS ; le zoom du navigateur suffit en v1).

- [ ] **Step 6: Vérification manuelle et commit**

Run: `npm run dev`. Créer une partie de dessin à 2 tours avec deux comptes. Vérifier : lignes pointillées visibles (une en bas au tour 1), traits à la souris et au stylet, gomme, pot de peinture, annuler/rétablir, brouillon restauré au rechargement, envoi accepté ; au tour 2, la bande héritée apparaît en haut, impossible de la modifier (clic ignoré), et la ligne pointillée haute est visible. Tenter l'envoi d'un PNG altéré via `curl` : refus 400.
Run: `npm run typecheck && npm run lint`
```bash
git add -A && git commit -m "feat: éditeur de dessin (pinceau, gomme, remplissage, brouillon, guides)"
```

---

### Task 15: Œuvre finale (visionneuse) et boîte de réception

**Files:**
- Create: `src/app/games/[id]/final/page.tsx`, `src/components/FinalViewer.tsx`, `src/app/inbox/page.tsx`, `src/components/InboxActions.tsx`

**Interfaces:**
- Consumes: `getFinal`, `listNotifications`, `NOTIFICATION_LABELS`, API `/api/games/:id/final/image`, `/api/notifications`, `/api/profile`, `guidesSvg`.

- [ ] **Step 1: Visionneuse avec interrupteur de jointures**

`src/components/FinalViewer.tsx` :
```tsx
"use client";
import { useMemo, useState } from "react";
import { guidesSvg, type Direction, type Joint } from "@/lib/images/geometry";

type Props = { gameId: string; direction: Direction; width: number; height: number; joints: Joint[] };

export function FinalViewer({ gameId, direction, width, height, joints }: Props) {
  const [showJoints, setShowJoints] = useState(false);
  const svg = useMemo(
    () => guidesSvg(direction, width, height, joints.flatMap((j) => [j.start, j.end])).replace("<svg ", '<svg style="width:100%;height:100%" '),
    [direction, width, height, joints],
  );
  const base = `/api/games/${gameId}/final/image`;

  return (
    <div>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 400 }}>
        <input type="checkbox" style={{ width: "auto" }} checked={showJoints} onChange={(e) => setShowJoints(e.target.checked)} />
        Afficher les jointures
      </label>
      <p>
        <a href={`${base}?download=1`}>Télécharger le PNG</a> · <a href={`${base}?download=1&guides=1`}>Télécharger avec jointures</a>
      </p>
      <div style={{ position: "relative", maxWidth: direction === "down" ? 480 : "100%" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={base} alt="Œuvre finale" style={{ width: "100%", height: "auto", display: "block" }} />
        {showJoints && <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }} dangerouslySetInnerHTML={{ __html: svg }} />}
      </div>
    </div>
  );
}
```
`src/app/games/[id]/final/page.tsx` :
```tsx
import { redirect } from "next/navigation";
import { FinalViewer } from "@/components/FinalViewer";
import { getDb } from "@/lib/db/client";
import { DomainError } from "@/lib/errors";
import { getFinal } from "@/lib/services/final-work";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function FinalPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await params;
  let view;
  try {
    view = await getFinal(getDb(), { userId: session.user.id, gameId: id });
  } catch (e) {
    if (e instanceof DomainError) return <main><h1>Œuvre indisponible</h1><p>{e.message}</p></main>;
    throw e;
  }
  return (
    <main>
      <h1>Œuvre finale</h1>
      <h2>{view.name}</h2>
      {view.type === "drawing" ? (
        view.ready ? <FinalViewer gameId={id} direction={view.direction!} width={view.width!} height={view.height!} joints={view.joints} /> : <p>L'œuvre est en cours d'assemblage, revenez dans un instant.</p>
      ) : (
        <ol>{view.contributions.map((c) => <li key={c.rank}><strong>{c.author}</strong><p style={{ whiteSpace: "pre-wrap" }}>{c.text}</p></li>)}</ol>
      )}
      {view.type === "drawing" && (
        <p className="muted">Auteurs : {view.contributions.map((c) => `${c.rank}. ${c.author}`).join(" · ")}</p>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Boîte de réception et préférence email**

`src/components/InboxActions.tsx` :
```tsx
"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function InboxActions({ emailEnabled }: { emailEnabled: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState(emailEnabled);

  async function markRead() {
    await fetch("/api/notifications", { method: "POST" });
    router.refresh();
  }
  async function toggleEmail(v: boolean) {
    setEmail(v);
    await fetch("/api/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ emailEnabled: v }) });
  }

  return (
    <div>
      <button className="secondary" onClick={markRead}>Tout marquer comme lu</button>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 400 }}>
        <input type="checkbox" style={{ width: "auto" }} checked={email} onChange={(e) => toggleEmail(e.target.checked)} />
        Recevoir les notifications par email
      </label>
    </div>
  );
}
```
`src/app/inbox/page.tsx` :
```tsx
import Link from "next/link";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { InboxActions } from "@/components/InboxActions";
import { getDb } from "@/lib/db/client";
import { profile } from "@/lib/db/schema";
import { NOTIFICATION_LABELS } from "@/lib/notifications/render";
import { listNotifications, type NotificationType } from "@/lib/services/notifications";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const db = getDb();
  const [items, [p]] = await Promise.all([
    listNotifications(db, session.user.id),
    db.select().from(profile).where(eq(profile.userId, session.user.id)),
  ]);
  return (
    <main>
      <h1>Notifications</h1>
      <InboxActions emailEnabled={p?.emailEnabled ?? true} />
      {items.length === 0 ? <p className="muted">Rien pour l'instant.</p> : (
        <ul>
          {items.map((n) => (
            <li key={n.id} style={{ fontWeight: n.readAt ? 400 : 700 }}>
              <Link href={`/games/${n.gameId}`}>{NOTIFICATION_LABELS[n.type as NotificationType]} — {n.gameName}</Link>
              <span className="muted"> · {n.createdAt.toLocaleString("fr-FR")}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Vérification manuelle et commit**

Run: `npm run dev` et `npm run worker` (deux terminaux). Terminer une partie de dessin à 2 tours : le worker assemble l'œuvre, la page finale affiche l'image ; la case « Afficher les jointures » superpose/retire les pointillés ; les deux liens de téléchargement donnent des PNG différents. Vérifier que la boîte de réception liste « C'est votre tour », « La partie est terminée » et « L'œuvre finale est prête », et que désactiver l'email est enregistré.
Run: `npm run typecheck && npm run lint`
```bash
git add -A && git commit -m "feat: visionneuse d'œuvre finale et boîte de réception"
```

---

### Task 16: Déploiement, observabilité, documentation et test de bout en bout

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `docker-compose.prod.yml`, `README.md`, `playwright.config.ts`, `e2e/text-game.spec.ts`, `src/app/api/health/route.ts`
- Modify: `next.config.ts`

**Interfaces:**
- Consumes: l'application complète.

- [ ] **Step 1: Sortie standalone et endpoint de santé**

`next.config.ts` :
```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["sharp", "pg-boss"],
};
export default nextConfig;
```
`src/app/api/health/route.ts` (vérifie la base et la fraîcheur du worker : dernier passage du balayage) :
```ts
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    const rows = await getDb().execute(
      sql`select max(completed_on) as last from pgboss.job where name = 'turn-sweep' and state = 'completed'`,
    );
    const last = (rows as unknown as { last: Date | null }[])[0]?.last ?? null;
    const workerOk = last !== null && Date.now() - new Date(last).getTime() < 5 * 60_000;
    return Response.json({ db: true, worker: workerOk, lastSweep: last }, { status: workerOk ? 200 : 503 });
  } catch (e) {
    return Response.json({ db: false, error: String(e) }, { status: 503 });
  }
}
```
Si le schéma `pgboss` diffère dans la version installée, adapter la requête après inspection (`\dt pgboss.*`).

- [ ] **Step 2: Dockerfile et compose de production**

`Dockerfile` :
```dockerfile
FROM node:22-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/src ./src
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json /app/tsconfig.json ./
EXPOSE 3000
CMD ["node", "server.js"]
```
`.dockerignore` : `node_modules`, `.next`, `.git`, `.storage`, `.env*`, `docs`.

`docker-compose.prod.yml` :
```yaml
services:
  web:
    build: .
    env_file: .env.production
    ports: ["3000:3000"]
    depends_on: [db]
    command: sh -c "npx tsx src/lib/db/migrate.ts && node server.js"
  worker:
    build: .
    env_file: .env.production
    depends_on: [db]
    command: npx tsx src/worker.ts
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: exquis
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: exquis
    volumes: [dbdata:/var/lib/postgresql/data]
volumes:
  dbdata:
```
Run: `docker build -t exquis .` — Expected : build réussi.
Sauvegardes : documenter dans le README une tâche cron quotidienne `docker compose exec db pg_dump -U exquis exquis | gzip > backup-$(date +%F).sql.gz`.

- [ ] **Step 3: Sentry (optionnel, nécessite un compte)**

Run: `npx @sentry/wizard@latest -i nextjs` (interactif ; fournir le DSN). Commiter ensuite les fichiers `sentry.*.config.ts` et la variable `SENTRY_DSN` dans `.env.example`. Si aucun compte Sentry n'est disponible, ignorer cette étape : la journalisation console et `/api/health` couvrent la v1.

- [ ] **Step 4: Test de bout en bout (texte, deux joueurs)**

`playwright.config.ts` :
```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: { baseURL: "http://localhost:3000" },
  webServer: { command: "npm run dev", url: "http://localhost:3000", reuseExistingServer: true },
});
```
`e2e/text-game.spec.ts` :
```ts
import { execSync } from "node:child_process";
import { expect, test, type Browser } from "@playwright/test";

const invite = () => execSync("npx tsx scripts/create-invite.ts", { env: process.env }).toString().trim();

async function register(browser: Browser, name: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/register");
  await page.getByLabel("Nom").fill(name);
  await page.getByLabel("Email").fill(`${name}-${Date.now()}@example.com`);
  await page.getByLabel("Mot de passe").fill("motdepasse-long-1");
  await page.getByLabel("Code d'invitation").fill(invite());
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await page.waitForURL("/");
  return page;
}

test("deux joueurs terminent une partie de texte", async ({ browser }) => {
  const alice = await register(browser, "Alice");
  const bob = await register(browser, "Bob");

  await alice.goto("/games/new");
  await alice.getByLabel("Nom de la partie").fill("Partie e2e");
  await alice.getByLabel("Nombre de tours").fill("2");
  await alice.getByLabel("Mots minimum").fill("2");
  await alice.getByLabel("Mots maximum").fill("30");
  await alice.getByRole("button", { name: "Créer la partie" }).click();
  await alice.waitForURL(/\/games\/.+/);
  const gameUrl = alice.url();

  await bob.goto("/");
  await bob.getByRole("row", { name: /Partie e2e/ }).getByRole("button", { name: "Rejoindre" }).click();
  await bob.waitForURL(gameUrl);

  const players = [alice, bob];
  for (const [i, text] of ["Il était une fois\n\nun dragon timide", "qui rencontra un chevalier"].entries()) {
    let current = null;
    for (const p of players) {
      await p.goto(gameUrl);
      if (await p.getByLabel("Votre texte").isVisible()) current = p;
    }
    expect(current, `joueur actif au tour ${i + 1}`).not.toBeNull();
    if (i === 1) await expect(current!.getByText("un dragon timide")).toBeVisible();
    if (i === 1) await expect(current!.getByText("Il était une fois")).toHaveCount(0);
    await current!.getByLabel("Votre texte").fill(text);
    await current!.getByRole("button", { name: "Envoyer" }).click();
  }

  await alice.goto(`${gameUrl}/final`);
  await expect(alice.getByRole("heading", { name: "Œuvre finale" })).toBeVisible();
  await expect(alice.getByText("qui rencontra un chevalier")).toBeVisible();
});
```
Run: `npx playwright install chromium && npx playwright test`
Expected : PASS (nécessite la base de dev migrée : `npm run db:migrate`, `REQUIRE_EMAIL_VERIFICATION=false`).

- [ ] **Step 5: README et vérification finale**

`README.md` : prérequis (Node 22, Docker), démarrage local (`docker compose up -d db`, `cp .env.example .env.local`, `npm run db:migrate`, `npm run dev`, `npm run worker`), création de la première invitation (`npx tsx scripts/create-invite.ts`), ouverture des inscriptions (`REGISTRATION_MODE=open`, et alors ajouter Google OAuth), variables d'environnement, déploiement (`docker-compose.prod.yml`), sauvegardes, tests (`npm test`, `npx playwright test`).

Run (vérification finale) : `npm test && npm run typecheck && npm run lint && npm run build`
Expected : tout passe.
```bash
git add -A && git commit -m "chore: déploiement Docker, santé, README et test e2e"
```

---

## Auto-revue (spec ↔ plan)

| Exigence de la spec | Tâche |
|---|---|
| §2 règles de jeu (2–8 joueurs, durée, démarrage plein, tirage au sort, limites) | 2, 7 |
| §2 liste : nom, type, tours, durée, langue, inscrits | 7 (`listOpenGames`), 12 (page) |
| §3 pile (Next.js, Postgres, Better Auth, S3, pg-boss, sharp, Resend) | 1, 4, 5, 6, 9 |
| §4 modèle de données (toutes les tables) | 4 |
| §5 cycle de vie, remise en jeu, plafond 2, annulation | 7, 8, 9 |
| §6 filtrage serveur, bande, intégrité de la zone héritée, extrait texte | 3, 8 |
| §6 transaction + verrou + idempotence + tolérance 5 s | 8, 9 |
| §6 œuvre finale propre, jointures en superposition, export `guides=1`, cache | 3, 10, 15 |
| §7 éditeur (calques, outils, brouillon, compte à rebours, guides non exportés) | 14, 13 |
| §8 notifications (événements, email + boîte, préférences, durée ≥ 5 min, rappel 75 %) | 7, 9, 15 |
| §9 sécurité (cookies, invitations, accès, limites de débit, validation) | 6, 8, 11 |
| §10 modération préparée (rôle, `report`, `hidden_at`) | 4 (colonnes/tables, non exposées) |
| §11 déploiement, journalisation, santé | 16 |
| §12 stratégie de test | tâches 2–11 (unitaires/intégration), 16 (e2e) |

**Écarts assumés (à valider)**
- Google OAuth reporté à l'ouverture des inscriptions (en mode invitation, tout compte passe par `/api/register`).
- « Rappel avec minimum 30 s » interprété comme : pas de rappel pour les tours < 120 s.
- Paragraphe unique très long : l'extrait est plafonné à 150 mots (le « dernier paragraphe » révélerait sinon tout le texte).
- **Dernier tour expiré (décision validée)** : appel à participation (`open_call`) listé sur l'accueil avec le logo 📣, repris par n'importe quel non-participant ; relancé sans limite si le volontaire laisse aussi expirer. Les parties sur invitation n'apparaissent pas dans la liste publique mais l'appel reste repris via le lien d'invitation.
- Un volontaire s'ajoute comme participant supplémentaire : une partie peut donc finir avec plus de participants que de tours, les auteurs révélés étant ceux des contributions.
- Sur les calques de l'éditeur : la bande héritée est protégée par un `clip` sur la zone propre plutôt que par un calque séparé, car le pot de peinture doit travailler sur le rendu composite ; le serveur revérifie l'intégrité de la bande.

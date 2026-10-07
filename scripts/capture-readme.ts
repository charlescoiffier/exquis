/**
 * Régénère les captures du README (docs/images/) : `npm run capture:readme`.
 *
 * Le script est autonome : il crée une base jetable (`exquis_shots`) sur le PostgreSQL local (celui de `npm run db:dev`
 * ou de Docker, utilisateur/mot de passe `exquis`), la migre, lance l'application sur le port 3100, joue quelques parties
 * (texte et dessin, terminées ou en cours) par l'API, prend les captures avec Playwright (Chromium), puis arrête le
 * serveur qu'il a lancé et supprime la base. Rien n'est écrit dans la base de développement.
 */
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { chromium, request, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import postgres from "postgres";
import sharp, { type OverlayOptions } from "sharp";
import { extractStrip } from "../src/lib/images/strip";

const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
const ADMIN_URL = "postgres://exquis:exquis@localhost:5432/exquis";
const SHOTS_DB = "exquis_shots";
const SHOTS_URL = `postgres://exquis:exquis@localhost:5432/${SHOTS_DB}`;
const OUT = path.resolve("docs/images");
const STORAGE_DIR = ".storage-shots";
const PASSWORD = "motdepasse-long-1";

const env = {
  ...process.env,
  DATABASE_URL: SHOTS_URL,
  APP_URL: BASE,
  BETTER_AUTH_SECRET: "captures-readme-captures-readme-captures",
  STORAGE_SECRET: "captures-readme-storage-secret",
  STORAGE_DIR,
  STORAGE_DRIVER: "local",
  REQUIRE_EMAIL_VERIFICATION: "false",
  REGISTRATION_MODE: "invite",
} as NodeJS.ProcessEnv;
Object.assign(process.env, env);

const log = (m: string) => console.log(`[capture] ${m}`);

// ---------- Dessins ----------
// Dessins « faits main » : contours légèrement tremblants, remplissages décalés du trait comme au feutre, hachures, doubles traits.
// Les extrémités des lignes qui traversent la bande de raccord (cou, jambes, tronc) tombent exactement au même endroit d'un tour
// à l'autre, pour que le dessin se prolonge sans rupture.
type Palette = { main: string; accent: string; dark: string };
const MONSTRE: Palette = { main: "#1B9C95", accent: "#F2B705", dark: "#1F1B16" };
const ARBRE: Palette = { main: "#3E8B4A", accent: "#9A6A3A", dark: "#3A2A1A" };

const svgOf = (inner: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1600" viewBox="0 0 1600 1600">${inner}</svg>`);

/** Générateur pseudo-aléatoire déterministe (mulberry32) : les captures sont identiques d'une exécution à l'autre. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Pt = [number, number];
/** Courbe lisse (Catmull-Rom → Bézier) passant par les points. */
function smooth(pts: Pt[], closed = false): string {
  const n = pts.length;
  const at = (i: number): Pt => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d + (closed ? "Z" : "");
}

/** Ellipse irrégulière : le rayon varie légèrement le long du tour. */
function blob(cx: number, cy: number, rx: number, ry: number, amp: number, r: () => number): Pt[] {
  const n = 22;
  const phase = r() * Math.PI * 2;
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + (amp / Math.max(rx, ry)) * (Math.sin(a * 3 + phase) * 0.6 + (r() - 0.5));
    return [cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k] as Pt;
  });
}

/** Ligne tremblante : le bruit s'annule aux extrémités, qui restent exactes. */
function line(x0: number, y0: number, x1: number, y1: number, amp: number, r: () => number): Pt[] {
  const n = Math.max(4, Math.round(Math.hypot(x1 - x0, y1 - y0) / 90));
  const nx = -(y1 - y0), ny = x1 - x0;
  const len = Math.hypot(nx, ny) || 1;
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const e = Math.sin(Math.PI * t) * amp * (r() * 2 - 1);
    return [x0 + (x1 - x0) * t + (nx / len) * e, y0 + (y1 - y0) * t + (ny / len) * e] as Pt;
  });
}

const stroke = (d: string, color: string, w: number, extra = "") => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;

/** Forme fermée « au feutre » : remplissage décalé et hachuré, puis double contour. */
function filled(pts: Pt[], fill: string, ink: string, w: number, id: string, r: () => number, dx = 14, dy = 10): string {
  const d = smooth(pts, true);
  const hatch = Array.from({ length: 16 }, (_, i) => {
    const y = -400 + i * 70 + r() * 20;
    return `<path d="M-200 ${y} L2000 ${y + 520 + r() * 30}" stroke="${ink}" stroke-opacity=".18" stroke-width="7" stroke-linecap="round"/>`;
  }).join("");
  return `<defs><clipPath id="${id}"><path d="${d}" transform="translate(${dx} ${dy})"/></clipPath></defs>
    <path d="${d}" transform="translate(${dx} ${dy})" fill="${fill}" fill-opacity=".92"/>
    <g clip-path="url(#${id})">${hatch}</g>
    ${stroke(d, ink, w)}
    ${stroke(d, ink, w * 0.45, `transform="translate(${(r() * 8 - 4).toFixed(1)} ${(r() * 8 - 4).toFixed(1)})" stroke-opacity=".6"`)}`;
}

function shapes(k: number, p: Palette): string {
  const r = rng(100 + k);
  const ink = p.dark;
  if (k === 1) {
    // Cou (extrémités fixes en x = 735 et 865 sur la bande de raccord), puis tête, cornes, yeux, sourire.
    const neck = [line(735, 1000, 735, 1600, 5, r), line(865, 1000, 865, 1600, 5, r)].map((l) => stroke(smooth(l), ink, 20)).join("");
    const eye = (cx: number, dx: number, id: string) =>
      filled(blob(cx, 580, 108, 104, 6, r), "#ffffff", ink, 14, id, r, 6, 5) + `<circle cx="${cx + dx}" cy="${598}" r="${40 + r() * 8}" fill="${ink}"/><circle cx="${cx + dx - 14}" cy="${582}" r="12" fill="#fff"/>`;
    const horn = (pts: Pt[], id: string) => filled(pts, p.accent, ink, 16, id, r, 8, 6);
    return `${neck}
      ${horn([[480, 380], [540, 130], [610, 190], [700, 300], [600, 360]], "h1")}
      ${horn([[1120, 380], [1070, 120], [990, 200], [900, 300], [1000, 360]], "h2")}
      ${filled(blob(800, 650, 430, 410, 20, r), p.main, ink, 20, "head", r, 18, 12)}
      ${eye(650, 14, "e1")}${eye(955, -10, "e2")}
      ${stroke(smooth(line(560, 470, 700, 440, 10, r)), ink, 14)}${stroke(smooth(line(900, 440, 1040, 470, 10, r)), ink, 14)}
      ${stroke(smooth([[560, 800], [640, 900], [800, 960], [960, 905], [1050, 790]]), ink, 26)}
      ${[690, 760, 850, 930].map((x, i) => stroke(`M${x} ${[905, 940, 950, 925][i]} l${i % 2 ? 6 : -6} 44`, ink, 12)).join("")}
      <circle cx="540" cy="760" r="38" fill="#F26B6B" fill-opacity=".45"/><circle cx="1060" cy="760" r="38" fill="#F26B6B" fill-opacity=".45"/>`;
  }
  if (k === 2) {
    // Cou en haut (mêmes x qu'au tour 1), corps, bras, ventre, jambes (extrémités fixes en x = 565/680 et 920/1035 en bas).
    const neck = [line(735, 0, 735, 520, 5, r), line(865, 0, 865, 520, 5, r)].map((l) => stroke(smooth(l), ink, 20)).join("");
    const legs = [line(565, 1250, 565, 1600, 5, r), line(680, 1250, 680, 1600, 5, r), line(920, 1250, 920, 1600, 5, r), line(1035, 1250, 1035, 1600, 5, r)]
      .map((l) => stroke(smooth(l), ink, 20)).join("");
    return `${neck}${legs}
      ${filled(blob(800, 840, 520, 560, 24, r), p.accent, ink, 20, "body", r, 16, 12)}
      ${stroke(smooth([[330, 700], [220, 760], [165, 860], [170, 1010]]), ink, 54)}${stroke(smooth([[1270, 700], [1380, 770], [1440, 880], [1432, 1020]]), ink, 54)}
      ${filled(blob(800, 850, 150, 140, 10, r), p.main, ink, 16, "belly", r, 8, 6)}
      ${[[560, 650], [1040, 640], [800, 560], [650, 1070], [960, 1060]].map(([x, y]) => `<circle cx="${Math.round(x + (r() * 14 - 7))}" cy="${y}" r="${38 + r() * 12}" fill="${ink}" fill-opacity=".85"/>`).join("")}`;
  }
  // k === 3 : jambes (extrémités fixes en haut), pieds, sol pointillé.
  const legs = [line(565, 0, 565, 1250, 5, r), line(680, 0, 680, 1250, 5, r), line(920, 0, 920, 1250, 5, r), line(1035, 0, 1035, 1250, 5, r)]
    .map((l) => stroke(smooth(l), ink, 20)).join("");
  return `${legs}
    ${filled(blob(560, 1330, 230, 92, 10, r), p.main, ink, 18, "f1", r, 8, 8)}
    ${filled(blob(1040, 1330, 230, 92, 10, r), p.main, ink, 18, "f2", r, 8, 8)}
    ${stroke(smooth(line(110, 1470, 1490, 1480, 10, r)), ink, 12, 'stroke-dasharray="3 34"')}`;
}

/** Arbre (tour 1) : feuillage en nuage, pommes, haut du tronc qui traverse la bande de raccord (x = 720 et 880). */
function treeShapes(p: Palette): string {
  const r = rng(300);
  const trunk = [line(720, 620, 720, 1600, 5, r), line(880, 620, 880, 1600, 5, r)].map((l) => stroke(smooth(l), p.dark, 22)).join("");
  const puffs = [[800, 420, 330, 280], [500, 520, 250, 220], [1100, 520, 250, 220], [650, 280, 220, 190], [960, 280, 220, 190]]
    .map(([cx, cy, rx, ry], i) => filled(blob(cx, cy, rx, ry, 18, r), i % 2 ? "#4FA05A" : p.main, p.dark, 18, `leaf${i}`, r, 10, 10)).join("");
  const apples = [[560, 560], [840, 330], [1060, 600], [700, 700]]
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="34" fill="#D6403A" stroke="${p.dark}" stroke-width="9"/><path d="M${x} ${y - 34} l8 -26" stroke="${p.dark}" stroke-width="8" stroke-linecap="round"/>`).join("");
  return `${trunk}${puffs}${apples}`;
}

/** Dessin du tour `k` : la bande héritée du tour précédent est reposée en haut, comme dans l'éditeur. */
async function drawTurn(k: number, p: Palette, previous?: Buffer, tree = false): Promise<Buffer> {
  const layers: OverlayOptions[] = [{ input: svgOf(tree ? treeShapes(p) : shapes(k, p)) }];
  if (previous) layers.push({ input: await extractStrip(previous, "down"), left: 0, top: 0 });
  return sharp({ create: { width: 1600, height: 1600, channels: 3, background: "#ffffff" } }).composite(layers).png().toBuffer();
}

// ---------- Parties ----------
type User = { name: string; email: string; id: string; api: APIRequestContext };

async function api<T>(res: Awaited<ReturnType<APIRequestContext["post"]>>): Promise<T> {
  if (!res.ok()) throw new Error(`${res.url()} → ${res.status()} ${await res.text()}`);
  return (await res.json()) as T;
}

/** `--preview <dossier>` : écrit seulement les dessins générés (monstre en trois tours, arbre) pour les relire, sans rien d'autre. */
async function preview(dir: string) {
  mkdirSync(dir, { recursive: true });
  const m1 = await drawTurn(1, MONSTRE);
  const m2 = await drawTurn(2, MONSTRE, m1);
  const m3 = await drawTurn(3, MONSTRE, m2);
  const { assembleDrawing } = await import("../src/lib/images/strip");
  const final = await assembleDrawing([m1, m2, m3], "down");
  await sharp(final.image).resize({ height: 1000 }).toFile(path.join(dir, "monstre.png"));
  await sharp(await drawTurn(1, ARBRE, undefined, true)).resize({ height: 800 }).toFile(path.join(dir, "arbre.png"));
  log(`aperçus dans ${dir}`);
}

async function main() {
  const previewAt = process.argv.indexOf("--preview");
  if (previewAt > 0) return preview(process.argv[previewAt + 1]);
  mkdirSync(OUT, { recursive: true });
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe(`DROP DATABASE IF EXISTS ${SHOTS_DB} WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE ${SHOTS_DB}`);
  await admin.end();
  rmSync(STORAGE_DIR, { recursive: true, force: true });
  execSync("npx tsx src/lib/db/migrate.ts", { env, stdio: "ignore" });
  const db = postgres(SHOTS_URL, { max: 2, onnotice: () => {} });

  let server: ChildProcess | undefined;
  let browser: Browser | undefined;
  try {
    log(`serveur de développement sur le port ${PORT}…`);
    server = spawn("npx", ["next", "dev", "--turbopack", "-p", String(PORT)], { env, stdio: "ignore", detached: true });
    for (let i = 0; i < 120; i++) {
      try {
        if ((await fetch(`${BASE}/login`)).ok) break;
      } catch {
        /* pas encore prêt */
      }
      await new Promise((r) => setTimeout(r, 1000));
      if (i === 119) throw new Error("le serveur ne répond pas");
    }

    // Invitations et comptes
    const { createInvitation } = await import("../src/lib/services/invitations");
    const { createDb } = await import("../src/lib/db/client");
    const drizzleDb = createDb(SHOTS_URL);
    const names = ["Alice", "Bastien", "Chloé", "Dylan"];
    const users: Record<string, User> = {};
    for (const name of names) {
      const code = await createInvitation(drizzleDb.db, null);
      const email = `${name.toLowerCase().replace("é", "e")}@exemple.fr`;
      const ctx = await request.newContext({ baseURL: BASE });
      await api(await ctx.post("/api/register", { data: { name, email, password: PASSWORD, invitationCode: code } }));
      const [row] = await db`select id from "user" where email = ${email}`;
      users[name] = { name, email, id: row.id as string, api: ctx };
    }
    const [A, B, C, D] = names.map((n) => users[n]);

    const create = async (by: User, body: Record<string, unknown>, joiners: User[]) => {
      const { gameId } = await api<{ gameId: string }>(await by.api.post("/api/games", { data: body }));
      for (const j of joiners) await api(await j.api.post(`/api/games/${gameId}/join`, { data: {} }));
      return gameId;
    };
    /** Impose l'ordre des joueurs (rang 1, 2, 3…) une fois la partie démarrée. */
    const setOrder = async (gameId: string, order: User[]) => {
      for (let i = 0; i < order.length; i++) await db`update turn set assigned_user_id = ${order[i].id} where game_id = ${gameId} and rank = ${i + 1}`;
    };
    const text = (by: User, gameId: string, t: string) => by.api.post(`/api/games/${gameId}/my-turn/submit`, { data: { text: t } }).then(api);
    const png = (by: User, gameId: string, data: Buffer) =>
      by.api.post(`/api/games/${gameId}/my-turn/submit`, { headers: { "content-type": "image/png" }, data }).then(api);
    const textBase = { type: "text", turnDurationSeconds: 86400, visibility: "public", language: "fr", minWords: 12, maxWords: 70, excerptMode: "paragraph" };
    const drawBase = { type: "drawing", turnDurationSeconds: 86400, visibility: "public", direction: "down" };

    // 1. Texte terminé : « Le jardin des heures » (Bastien, Alice, Chloé)
    const jardin = await create(B, { ...textBase, name: "Le jardin des heures", turns: 3, turnLabels: ["Début", "Milieu", "Fin"] }, [A, C]);
    await setOrder(jardin, [B, A, C]);
    await text(B, jardin, "Au fond du jardin, il y avait un puits que personne ne regardait plus.\nLa lune, fatiguée de veiller, s'y était endormie un soir d'été.");
    await text(A, jardin, "Le matin venu, personne ne la chercha. Un corbeau déposa une clé sur la margelle et attendit que quelqu'un ose la ramasser.");
    await text(C, jardin, "Chloé la ramassa : elle n'ouvrait aucune porte, mais le jardin se mit à compter les heures à l'envers.\nLes roses fermèrent, les oiseaux se turent, et la lune, rassurée, se rendormit.");

    // 2. Dessin terminé : « Monstre de poche » (Chloé, Dylan, Alice)
    const monstre = await create(C, { ...drawBase, name: "Monstre de poche", turns: 3, turnLabels: ["Tête", "Corps", "Jambes"] }, [D, A]);
    await setOrder(monstre, [C, D, A]);
    const m1 = await drawTurn(1, MONSTRE);
    await png(C, monstre, m1);
    const m2 = await drawTurn(2, MONSTRE, m1);
    await png(D, monstre, m2);
    const m3 = await drawTurn(3, MONSTRE, m2);
    await png(A, monstre, m3);

    // Assemblage des œuvres finales (normalement fait par le worker).
    const { assembleFinalWork } = await import("../src/lib/services/final-work");
    const { getStorage } = await import("../src/lib/storage");
    for (const g of [jardin, monstre]) await assembleFinalWork(drizzleDb.db, getStorage(), g);

    // Avatars, commentaires, lien public et amis (par les services, comme le ferait l'application).
    const { updateProfile } = await import("../src/lib/services/account");
    const { addComment } = await import("../src/lib/services/comments");
    const { setPublicLink } = await import("../src/lib/services/sharing");
    const { ensureFriendCode, listFriendRequests, respondToFriendRequest, sendFriendRequestByCode } = await import("../src/lib/services/friends");
    const gdb = drizzleDb.db;
    await updateProfile(gdb, A.id, { avatar: { shape: "star", color: "mustard", bg: "teal" } });
    await updateProfile(gdb, B.id, { avatar: { shape: "ring", color: "cream", bg: "red" } });
    await updateProfile(gdb, C.id, { avatar: { shape: "hexagon", color: "ink", bg: "butter" } });
    await updateProfile(gdb, D.id, { avatar: { shape: "dots", color: "pine", bg: "sand" } });
    await addComment(gdb, { userId: C.id, gameId: jardin, body: "La lune qui se rendort à l'envers, j'adore cette image." });
    await addComment(gdb, { userId: A.id, gameId: jardin, body: "Merci Chloé : j'étais bloquée avec ce corbeau et sa clé !" });
    await setPublicLink(gdb, { userId: B.id, gameId: jardin, enabled: true });
    await sendFriendRequestByCode(gdb, { userId: A.id, code: await ensureFriendCode(gdb, B.id) });
    await respondToFriendRequest(gdb, { userId: B.id, requestId: (await listFriendRequests(gdb, B.id)).incoming[0].requestId, accept: true });
    await sendFriendRequestByCode(gdb, { userId: C.id, code: await ensureFriendCode(gdb, A.id) });

    // 3. Texte en cours : c'est à Alice de jouer (tour 2)
    const voyage = await create(D, { ...textBase, name: "Voyage immobile", turns: 3, turnLabels: ["Départ", "Traversée", "Arrivée"], minWords: 15, maxWords: 60 }, [A, B]);
    await setOrder(voyage, [D, A, B]);
    await text(D, voyage, "Le train n'a jamais quitté la gare, mais les voyageurs jurent avoir traversé trois pays.\nChacun racontait un paysage différent depuis la même fenêtre.");

    // 4. Dessin en cours : c'est à Alice de jouer (tour 2)
    const arbre = await create(B, { ...drawBase, name: "Arbre en trois étages", turns: 3, turnLabels: ["Feuillage", "Tronc", "Racines"] }, [A, C]);
    await setOrder(arbre, [B, A, C]);
    await png(B, arbre, await drawTurn(1, ARBRE, undefined, true));

    // 5. Parties à rejoindre
    await create(C, { ...drawBase, name: "Les quatre saisons", turns: 4, turnDurationSeconds: 3600, turnLabels: ["Printemps", "Été", "Automne", "Hiver"] }, []);
    await create(D, { ...textBase, name: "Lettres à personne", turns: 5, turnDurationSeconds: 604800, language: "en" }, [B]);
    await create(B, { ...textBase, name: "", turns: 2, turnDurationSeconds: 300 }, []);

    // ---------- Captures ----------
    browser = await chromium.launch();
    const desktop = { viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1 };
    const mobile = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

    const login = async (opts: typeof desktop | typeof mobile, user: User) => {
      const ctx = await browser!.newContext(opts);
      const page = await ctx.newPage();
      await page.goto(`${BASE}/login`);
      await page.getByLabel("Email").fill(user.email);
      await page.getByLabel("Mot de passe").fill(PASSWORD);
      await page.getByRole("button", { name: "Se connecter" }).click();
      await page.waitForURL(`${BASE}/`);
      return { ctx, page };
    };
    const shot = async (page: Page, name: string, locator?: string) => {
      // Cache la pastille de développement de Next.js, qui n'a rien à faire sur une capture.
      await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
      await page.waitForTimeout(700);
      const file = path.join(OUT, `${name}.png`);
      if (locator) await page.locator(locator).first().screenshot({ path: file });
      else await page.screenshot({ path: file });
      log(`${name}.png`);
    };
    const drawing = async (page: Page, hover: boolean) => {
      await page.waitForSelector("canvas.drawing-canvas");
      await page.waitForTimeout(1200);
      const box = (await page.locator("canvas.drawing-canvas").boundingBox())!;
      const jitter = rng(7);
      const at = (fx: number, fy: number): [number, number] => [box.x + box.width * fx, box.y + box.height * fy];
      /** Trait à la main : points intermédiaires légèrement décalés, comme un geste réel. */
      const hand = async (pts: [number, number][], wobble = 0.006) => {
        await page.mouse.move(...at(...pts[0]));
        await page.mouse.down();
        for (let i = 1; i < pts.length; i++) {
          const [x0, y0] = pts[i - 1];
          const [x1, y1] = pts[i];
          for (let s = 1; s <= 7; s++) {
            const t = s / 7;
            const wob = Math.sin(Math.PI * t) * wobble * (jitter() * 2 - 1);
            await page.mouse.move(...at(x0 + (x1 - x0) * t + wob, y0 + (y1 - y0) * t + wob * 0.7));
          }
        }
        await page.mouse.up();
      };
      // Le tronc prolonge celui de la bande reçue (x ≈ 0,45 et 0,55) : deux traits épais bruns, puis l'écorce au crayon fin.
      await page.getByRole("button", { name: "Marron", exact: true }).click();
      await page.getByRole("button", { name: "Épais", exact: true }).click();
      await hand([[0.45, 0.1], [0.452, 0.3], [0.447, 0.55], [0.455, 0.9]]);
      await hand([[0.55, 0.1], [0.548, 0.32], [0.553, 0.6], [0.545, 0.9]]);
      await page.getByRole("button", { name: "Fin", exact: true }).click();
      for (const [x, y] of [[0.48, 0.25], [0.51, 0.4], [0.485, 0.55], [0.515, 0.7], [0.49, 0.82]] as [number, number][]) {
        await hand([[x, y], [x + 0.012, y + 0.035], [x + 0.004, y + 0.07]], 0.003);
      }
      // Reflet de lumière au surligneur, mousse à l'aérographe.
      await page.getByRole("button", { name: "Jaune", exact: true }).click();
      await page.getByRole("button", { name: "Surligneur", exact: true }).click();
      await page.getByLabel("Taille du trait").fill("34");
      await hand([[0.47, 0.16], [0.468, 0.45], [0.472, 0.76]], 0.004);
      await page.getByRole("button", { name: "Vert", exact: true }).click();
      await page.getByRole("button", { name: "Aérographe", exact: true }).click();
      await page.getByLabel("Taille du trait").fill("46");
      await hand([[0.452, 0.8], [0.5, 0.76], [0.548, 0.82]], 0.004);
      await hand([[0.452, 0.28], [0.472, 0.36], [0.455, 0.44]], 0.004);
      if (hover) await page.mouse.move(...at(0.78, 0.62), { steps: 4 });
    };

    // Bureau
    {
      const { ctx, page } = await login(desktop, A);
      await shot(page, "accueil-bureau");
      await page.goto(`${BASE}/games/${voyage}`);
      await page.getByLabel("Votre texte").fill("Le matin venu, personne ne la chercha.\nUn corbeau déposa une clé sur la margelle et attendit que quelqu'un ose la ramasser.");
      await shot(page, "tour-texte-bureau");
      await page.goto(`${BASE}/games/${arbre}`);
      await page.setViewportSize({ width: 1280, height: 1480 });
      await drawing(page, true);
      await shot(page, "tour-dessin-bureau");
      await page.setViewportSize({ width: 1280, height: 1000 });
      await page.goto(`${BASE}/games/${monstre}/final`);
      await page.getByText("Afficher avec jointures et noms").click();
      await shot(page, "oeuvre-dessin-bureau", "main");
      await page.goto(`${BASE}/games/${jardin}/final`);
      await shot(page, "oeuvre-texte-bureau", "main");
      await ctx.close();
    }
    // Téléphone
    {
      const { ctx, page } = await login(mobile, A);
      await shot(page, "accueil-mobile");
      await page.goto(`${BASE}/games/new`);
      await shot(page, "creation-mobile");
      await page.goto(`${BASE}/games/${voyage}`);
      await page.getByLabel("Votre texte").fill("Le matin venu, personne ne la chercha.\nUn corbeau déposa une clé sur la margelle et attendit que quelqu'un ose la ramasser.");
      await shot(page, "tour-texte-mobile");
      await page.goto(`${BASE}/games/${arbre}`);
      await page.setViewportSize({ width: 390, height: 1500 });
      await drawing(page, false);
      await shot(page, "tour-dessin-mobile");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${BASE}/games/${monstre}/final`);
      await page.getByText("Afficher avec jointures et noms").click();
      await shot(page, "oeuvre-dessin-mobile");
      await page.setViewportSize({ width: 390, height: 1300 });
      await page.goto(`${BASE}/friends`);
      await shot(page, "amis-mobile");
      await page.setViewportSize({ width: 390, height: 1700 });
      await page.goto(`${BASE}/account`);
      await shot(page, "compte-mobile");
      await ctx.close();
    }
  } finally {
    await browser?.close().catch(() => {});
    if (server?.pid) {
      try {
        process.kill(-server.pid, "SIGTERM"); // groupe de processus lancé par ce script, et lui seul
      } catch {
        /* déjà arrêté */
      }
    }
    await new Promise((r) => setTimeout(r, 1500));
    await db.end().catch(() => {});
    const cleanup = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
    await cleanup.unsafe(`DROP DATABASE IF EXISTS ${SHOTS_DB} WITH (FORCE)`).catch(() => {});
    await cleanup.end();
    rmSync(STORAGE_DIR, { recursive: true, force: true });
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);

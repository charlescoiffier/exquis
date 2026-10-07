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
type Palette = { main: string; accent: string; dark: string };
const MONSTRE: Palette = { main: "#0B7A75", accent: "#F2B705", dark: "#101010" };
const ARBRE: Palette = { main: "#2F6B3A", accent: "#8A5A2B", dark: "#3A2A1A" };

const svgOf = (inner: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1600" viewBox="0 0 1600 1600">${inner}</svg>`);

function shapes(k: number, p: Palette): string {
  if (k === 1) {
    return `
      <rect x="720" y="1000" width="160" height="600" fill="${p.dark}"/>
      <circle cx="800" cy="640" r="430" fill="${p.main}" stroke="${p.dark}" stroke-width="22"/>
      <polygon points="470,360 560,120 690,300" fill="${p.accent}" stroke="${p.dark}" stroke-width="18"/>
      <polygon points="1130,360 1040,120 910,300" fill="${p.accent}" stroke="${p.dark}" stroke-width="18"/>
      <circle cx="650" cy="560" r="105" fill="#fff" stroke="${p.dark}" stroke-width="16"/>
      <circle cx="950" cy="560" r="105" fill="#fff" stroke="${p.dark}" stroke-width="16"/>
      <circle cx="675" cy="575" r="42" fill="${p.dark}"/><circle cx="925" cy="575" r="42" fill="${p.dark}"/>
      <path d="M560 800 Q800 1010 1040 800" fill="none" stroke="${p.dark}" stroke-width="30" stroke-linecap="round"/>
      <rect x="720" y="1040" width="160" height="560" fill="${p.dark}"/>`;
  }
  if (k === 2) {
    return `
      <rect x="720" y="0" width="160" height="460" fill="${p.dark}"/>
      <ellipse cx="800" cy="820" rx="520" ry="580" fill="${p.accent}" stroke="${p.dark}" stroke-width="22"/>
      <path d="M330 700 Q120 760 150 1020" fill="none" stroke="${p.dark}" stroke-width="64" stroke-linecap="round"/>
      <path d="M1270 700 Q1480 760 1450 1020" fill="none" stroke="${p.dark}" stroke-width="64" stroke-linecap="round"/>
      <circle cx="800" cy="820" r="150" fill="${p.main}" stroke="${p.dark}" stroke-width="16"/>
      <circle cx="560" cy="640" r="46" fill="${p.dark}"/><circle cx="1040" cy="640" r="46" fill="${p.dark}"/><circle cx="800" cy="560" r="46" fill="${p.dark}"/>
      <rect x="560" y="1240" width="120" height="360" fill="${p.dark}"/>
      <rect x="920" y="1240" width="120" height="360" fill="${p.dark}"/>`;
  }
  return `
    <rect x="560" y="0" width="120" height="1250" fill="${p.dark}"/>
    <rect x="920" y="0" width="120" height="1250" fill="${p.dark}"/>
    <ellipse cx="560" cy="1330" rx="220" ry="90" fill="${p.main}" stroke="${p.dark}" stroke-width="20"/>
    <ellipse cx="1040" cy="1330" rx="220" ry="90" fill="${p.main}" stroke="${p.dark}" stroke-width="20"/>
    <line x1="120" y1="1450" x2="1480" y2="1450" stroke="${p.dark}" stroke-width="12" stroke-dasharray="4 36" stroke-linecap="round"/>`;
}

/** Dessin du tour `k` : la bande héritée du tour précédent est reposée en haut, comme dans l'éditeur. */
async function drawTurn(k: number, p: Palette, previous?: Buffer): Promise<Buffer> {
  const layers: OverlayOptions[] = [{ input: svgOf(shapes(k, p)) }];
  if (previous) layers.push({ input: await extractStrip(previous, "down"), left: 0, top: 0 });
  return sharp({ create: { width: 1600, height: 1600, channels: 3, background: "#ffffff" } }).composite(layers).png().toBuffer();
}

// ---------- Parties ----------
type User = { name: string; email: string; id: string; api: APIRequestContext };

async function api<T>(res: Awaited<ReturnType<APIRequestContext["post"]>>): Promise<T> {
  if (!res.ok()) throw new Error(`${res.url()} → ${res.status()} ${await res.text()}`);
  return (await res.json()) as T;
}

async function main() {
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

    // 3. Texte en cours : c'est à Alice de jouer (tour 2)
    const voyage = await create(D, { ...textBase, name: "Voyage immobile", turns: 3, turnLabels: ["Départ", "Traversée", "Arrivée"], minWords: 15, maxWords: 60 }, [A, B]);
    await setOrder(voyage, [D, A, B]);
    await text(D, voyage, "Le train n'a jamais quitté la gare, mais les voyageurs jurent avoir traversé trois pays.\nChacun racontait un paysage différent depuis la même fenêtre.");

    // 4. Dessin en cours : c'est à Alice de jouer (tour 2)
    const arbre = await create(B, { ...drawBase, name: "Arbre en trois étages", turns: 3, turnLabels: ["Feuillage", "Tronc", "Racines"] }, [A, C]);
    await setOrder(arbre, [B, A, C]);
    await png(B, arbre, await drawTurn(1, ARBRE));

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
      const at = (fx: number, fy: number): [number, number] => [box.x + box.width * fx, box.y + box.height * fy];
      const stroke = async (pts: [number, number][]) => {
        await page.mouse.move(...at(...pts[0]));
        await page.mouse.down();
        for (const p of pts.slice(1)) await page.mouse.move(...at(...p), { steps: 6 });
        await page.mouse.up();
      };
      await page.getByRole("button", { name: "Marron", exact: true }).click();
      await page.getByLabel("Taille du pinceau").fill("34");
      await stroke([[0.36, 0.2], [0.4, 0.55], [0.38, 0.9]]);
      await stroke([[0.64, 0.2], [0.6, 0.55], [0.62, 0.9]]);
      await page.getByRole("button", { name: "Vert", exact: true }).click();
      await stroke([[0.1, 0.35], [0.3, 0.2], [0.5, 0.3], [0.7, 0.18], [0.9, 0.33]]);
      await stroke([[0.15, 0.45], [0.35, 0.33], [0.55, 0.42], [0.8, 0.3]]);
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

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
  REGISTRATION_MODE: "open",
} as NodeJS.ProcessEnv;
Object.assign(process.env, env);

const log = (m: string) => console.log(`[capture] ${m}`);

// ---------- Dessins ----------
// Dessins « faits main » : contours légèrement tremblants, remplissages décalés du trait comme au feutre, hachures, doubles traits.
// Les extrémités des lignes qui traversent la bande de raccord (cou, jambes, tronc) tombent exactement au même endroit d'un tour
// à l'autre, pour que le dessin se prolonge sans rupture.
type Palette = { main: string; accent: string; dark: string };
const MONSTRE: Palette = { main: "#1B9C95", accent: "#F2B705", dark: "#2A211B" };
const ARBRE: Palette = { main: "#3E8B4A", accent: "#9A6A3A", dark: "#3A2A1A" };

const svgOf = (inner: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1600" viewBox="0 0 1600 1600">${DEFS}${inner}</svg>`);

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

// ----- Rendu « crayons de couleur » : dégradés de volume, ombre portée, grain, reflets, contour au crayon -----
let uid = 0;
const nid = (p: string) => `${p}${uid++}`;

/** Filtres communs : grain de papier / de crayon et flous d'ombre. */
const DEFS = `<defs>
  <filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="4" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1.4 -.55" result="a"/><feComposite in="a" in2="SourceGraphic" operator="in"/></filter>
  <filter id="b8" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="8"/></filter>
  <filter id="b20" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="20"/></filter>
  <filter id="b34" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="34"/></filter>
</defs>`;

function radial(light: string, base: string, shade: string): { id: string; def: string } {
  const id = nid("rg");
  return { id, def: `<radialGradient id="${id}" cx=".36" cy=".3" r=".85"><stop offset="0" stop-color="${light}"/><stop offset=".5" stop-color="${base}"/><stop offset="1" stop-color="${shade}"/></radialGradient>` };
}
/** Dégradé horizontal (ne dépend que de x) : une forme qui traverse la bande de raccord garde la même teinte des deux côtés. */
function linearX(a: string, b: string, c: string): { id: string; def: string } {
  const id = nid("lg");
  return { id, def: `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${a}"/><stop offset=".45" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient>` };
}
const bounds = (pts: Pt[]) => {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
};

type Tint = { light: string; base: string; shade: string };
/** Forme peinte : volume (dégradé radial), ombre intérieure, hachures, grain, reflet, double contour au crayon. */
function painted(pts: Pt[], t: Tint, ink: string, w: number, r: () => number, opts: { shine?: boolean; hatch?: boolean } = {}): string {
  const id = nid("p");
  const d = smooth(pts, true);
  const g = radial(t.light, t.base, t.shade);
  const b = bounds(pts);
  const hatch = opts.hatch === false ? "" : Array.from({ length: 7 }, (_, i) => {
    const x = b.x0 + b.w * (0.35 + i * 0.1);
    return `<path d="M${x.toFixed(0)} ${(b.y0 + b.h * 0.45).toFixed(0)} l${(b.w * 0.22).toFixed(0)} ${(b.h * 0.5).toFixed(0)}" stroke="${t.shade}" stroke-opacity=".22" stroke-width="6" stroke-linecap="round"/>`;
  }).join("");
  const shine = opts.shine === false ? "" : `<ellipse cx="${(b.x0 + b.w * 0.3).toFixed(0)}" cy="${(b.y0 + b.h * 0.24).toFixed(0)}" rx="${(b.w * 0.14).toFixed(0)}" ry="${(b.h * 0.08).toFixed(0)}" fill="#fff" opacity=".55" filter="url(#b8)" transform="rotate(-25 ${(b.x0 + b.w * 0.3).toFixed(0)} ${(b.y0 + b.h * 0.24).toFixed(0)})"/>`;
  return `<defs>${g.def}<clipPath id="c${id}"><path d="${d}"/></clipPath></defs>
    <path d="${d}" fill="url(#${g.id})"/>
    <g clip-path="url(#c${id})">
      <path d="${d}" fill="none" stroke="${t.shade}" stroke-width="70" opacity=".5" filter="url(#b20)"/>
      ${hatch}
      <path d="${d}" fill="#000" filter="url(#grain)" opacity=".2"/>
      ${shine}
    </g>
    ${stroke(d, ink, w)}
    ${stroke(d, ink, w * 0.4, `transform="translate(${(r() * 6 - 3).toFixed(1)} ${(r() * 6 - 3).toFixed(1)})" stroke-opacity=".55"`)}`;
}

/** Tube entre deux lignes verticales (extrémités exactes en x) : remplissage dégradé + deux contours tremblants. */
function tube(xl: number, xr: number, y0: number, y1: number, t: [string, string, string], ink: string, w: number, r: () => number, bands?: { period: number; color: string; height: number }): string {
  const g = linearX(...t);
  const left = line(xl, y0, xl, y1, 5, r), right = line(xr, y0, xr, y1, 5, r);
  const body = `M${xl} ${y0} L${xr} ${y0} L${xr} ${y1} L${xl} ${y1} Z`;
  const stripes = bands
    ? Array.from({ length: Math.ceil((y1 - y0) / bands.period) + 1 }, (_, i) => {
        const y = Math.ceil(y0 / bands.period) * bands.period + i * bands.period;
        return y + bands.height <= y1 + bands.period ? `<rect x="${xl}" y="${y}" width="${xr - xl}" height="${bands.height}" fill="${bands.color}" fill-opacity=".9"/>` : "";
      }).join("")
    : "";
  return `<defs>${g.def}<clipPath id="ct${xl}_${y0}"><path d="${body}"/></clipPath></defs>
    <path d="${body}" fill="url(#${g.id})"/>
    <g clip-path="url(#ct${xl}_${y0})">${stripes}<path d="${body}" fill="#000" filter="url(#grain)" opacity=".18"/></g>
    ${stroke(smooth(left), ink, w)}${stroke(smooth(right), ink, w)}
    ${stroke(smooth(line(xl + 14, y0, xl + 14, y1, 4, r)), "#ffffff", 6, 'stroke-opacity=".35"')}`;
}

const TEAL: Tint = { light: "#7FE0D6", base: "#1B9C95", shade: "#0B5F5B" };
const GOLD: Tint = { light: "#FFE58A", base: "#F2B705", shade: "#B07A00" };
const CREAM: Tint = { light: "#FFFFFF", base: "#FBF1D3", shade: "#D9C79A" };
const RED: Tint = { light: "#FF8F86", base: "#D6403A", shade: "#8E1E1E" };
const WHITE: Tint = { light: "#FFFFFF", base: "#F4F4F0", shade: "#C9C9C0" };

function shapes(k: number, p: Palette): string {
  const r = rng(100 + k);
  const ink = p.dark;
  const eye = (cx: number, look: number) => {
    const ix = cx + look, iy = 592;
    const g = radial("#FFE9A8", "#E2A21B", "#8A5A00");
    return `${painted(blob(cx, 580, 112, 108, 6, r), WHITE, ink, 14, r, { hatch: false, shine: false })}
      <defs>${g.def}</defs><circle cx="${ix}" cy="${iy}" r="62" fill="url(#${g.id})" stroke="${ink}" stroke-width="7"/>
      <circle cx="${ix + 6}" cy="${iy + 4}" r="30" fill="${ink}"/>
      <circle cx="${ix - 20}" cy="${iy - 22}" r="16" fill="#fff"/><circle cx="${ix + 22}" cy="${iy + 22}" r="8" fill="#fff" fill-opacity=".8"/>
      ${stroke(smooth([[cx - 118, 540], [cx - 40, 478], [cx + 60, 482], [cx + 120, 540]]), ink, 16)}`;
  };
  if (k === 1) {
    const neck = tube(735, 865, 1000, 1600, ["#0B5F5B", "#1B9C95", "#7FE0D6"], ink, 20, r);
    const horn = (pts: Pt[]) => painted(pts, GOLD, ink, 16, r);
    const earL = painted(blob(430, 560, 90, 110, 8, r), TEAL, ink, 16, r);
    const earR = painted(blob(1170, 560, 90, 110, 8, r), TEAL, ink, 16, r);
    const mouthPts: Pt[] = [[590, 810], [700, 860], [800, 870], [900, 860], [1010, 810], [980, 900], [900, 970], [800, 990], [700, 970], [620, 900]];
    const mouthD = smooth(mouthPts, true);
    const teeth = [660, 735, 810, 885, 950].map((x, i) => `<rect x="${x - 26}" y="${[836, 852, 858, 852, 836][i]}" width="52" height="46" rx="14" fill="#fff" stroke="${ink}" stroke-width="6"/>`).join("");
    const mouth = `<defs><clipPath id="cm"><path d="${mouthD}"/></clipPath></defs>
      <path d="${mouthD}" fill="#6B1F2E"/>
      <g clip-path="url(#cm)"><ellipse cx="800" cy="975" rx="120" ry="62" fill="#F27F8E" stroke="#B0485A" stroke-width="8"/>${stroke("M800 925 l0 40", "#B0485A", 7)}</g>
      ${teeth}${stroke(mouthD, ink, 18)}`;
    return `${neck}${earL}${earR}
      ${horn([[470, 400], [520, 150], [560, 90], [640, 210], [700, 330], [600, 380]])}
      ${horn([[1130, 400], [1080, 150], [1040, 90], [960, 210], [900, 330], [1000, 380]])}
      ${painted(blob(800, 650, 430, 410, 20, r), TEAL, ink, 20, r)}
      ${[[690, 250], [800, 225], [910, 250]].map(([x, y]) => stroke(`M${x} ${y + 70} q${(x - 800) / 6} -60 ${(x - 800) / 3 + 10} -75`, TEAL.shade, 16)).join("")}
      ${eye(650, 14)}${eye(955, -8)}
      <circle cx="800" cy="700" r="12" fill="${ink}" fill-opacity=".7"/>
      <ellipse cx="540" cy="760" rx="52" ry="34" fill="#F26B8A" opacity=".5" filter="url(#b8)"/><ellipse cx="1060" cy="760" rx="52" ry="34" fill="#F26B8A" opacity=".5" filter="url(#b8)"/>
      ${[[600, 690], [625, 720], [575, 725], [1000, 690], [975, 720], [1025, 725]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7" fill="#0B5F5B" fill-opacity=".6"/>`).join("")}
      ${mouth}`;
  }
  if (k === 2) {
    const neck = tube(735, 865, 0, 520, ["#0B5F5B", "#1B9C95", "#7FE0D6"], ink, 20, r);
    const legs = [565, 920].map((x) => tube(x, x + 115, 1250, 1600, ["#0B5F5B", "#1B9C95", "#7FE0D6"], ink, 20, r, { period: 80, color: "#FBF1D3", height: 36 })).join("");
    const arm = (pts: Pt[]) => {
      const d = smooth(pts);
      return `${stroke(d, ink, 84)}${stroke(d, "#1B9C95", 62)}${stroke(d, "#7FE0D6", 18, 'transform="translate(-10 -10)" stroke-opacity=".7"')}`;
    };
    const hand = (cx: number, cy: number) =>
      painted(blob(cx, cy, 60, 56, 6, r), TEAL, ink, 14, r, { hatch: false }) +
      [-34, 0, 34].map((dx) => `<circle cx="${cx + dx}" cy="${cy + 56}" r="22" fill="#1B9C95" stroke="${ink}" stroke-width="10"/>`).join("");
    return `${neck}${legs}
      ${arm([[330, 700], [230, 760], [170, 880], [172, 990]])}${arm([[1270, 700], [1370, 770], [1432, 890], [1430, 1000]])}
      ${hand(172, 1010)}${hand(1430, 1020)}
      ${painted(blob(800, 840, 520, 560, 24, r), GOLD, ink, 20, r)}
      ${painted(blob(800, 930, 290, 330, 14, r), CREAM, ink, 14, r, { hatch: false })}
      ${stroke(smooth([[560, 840], [700, 790], [900, 790], [1040, 840]]), "#B07A00", 9, 'stroke-dasharray="14 16" stroke-opacity=".8"')}
      ${[[560, 650], [1040, 640], [800, 560], [620, 1090], [980, 1080], [470, 880], [1130, 900]].map(([x, y]) => `<circle cx="${Math.round(x + (r() * 14 - 7))}" cy="${y}" r="${30 + Math.round(r() * 14)}" fill="#B07A00" fill-opacity=".75"/>`).join("")}
      <circle cx="800" cy="960" r="46" fill="#1B9C95" stroke="${ink}" stroke-width="10"/><circle cx="800" cy="960" r="12" fill="${ink}" fill-opacity=".7"/>`;
  }
  // k === 3 : jambes rayées, chaussures, ombre portée, herbe et fleurs.
  const legs = [565, 920].map((x) => tube(x, x + 115, 0, 1250, ["#0B5F5B", "#1B9C95", "#7FE0D6"], ink, 20, r, { period: 80, color: "#FBF1D3", height: 36 })).join("");
  const shoe = (cx: number) =>
    painted(blob(cx, 1330, 235, 98, 10, r), RED, ink, 18, r, { hatch: false }) +
    `<path d="M${cx - 215} 1385 Q${cx} 1425 ${cx + 215} 1385" fill="none" stroke="#fff" stroke-width="20" stroke-linecap="round" stroke-opacity=".9"/>` +
    [-40, 10, 60].map((dx) => stroke(`M${cx + dx} 1260 l22 28`, "#fff", 10)).join("");
  const grass = Array.from({ length: 70 }, () => {
    const x = 60 + r() * 1480, y = 1470 + r() * 40, h = 40 + r() * 60, lean = r() * 40 - 20;
    return stroke(`M${x.toFixed(0)} ${y.toFixed(0)} q${(lean / 2).toFixed(0)} ${(-h / 2).toFixed(0)} ${lean.toFixed(0)} ${(-h).toFixed(0)}`, ["#3E8B4A", "#5DAE5A", "#2F6B3A"][Math.floor(r() * 3)], 9);
  }).join("");
  const flower = (x: number, y: number, c: string) =>
    `${stroke(`M${x} ${y} l0 70`, "#2F6B3A", 8)}${Array.from({ length: 5 }, (_, i) => `<circle cx="${(x + Math.cos((i / 5) * 6.283) * 20).toFixed(0)}" cy="${(y + Math.sin((i / 5) * 6.283) * 20).toFixed(0)}" r="16" fill="${c}" stroke="${ink}" stroke-width="5"/>`).join("")}<circle cx="${x}" cy="${y}" r="11" fill="#F2B705" stroke="${ink}" stroke-width="5"/>`;
  return `<ellipse cx="560" cy="1450" rx="270" ry="40" fill="#000" opacity=".22" filter="url(#b20)"/><ellipse cx="1040" cy="1450" rx="270" ry="40" fill="#000" opacity=".22" filter="url(#b20)"/>
    ${legs}${grass}${shoe(560)}${shoe(1040)}${flower(210, 1420, "#F26B8A")}${flower(1380, 1430, "#FFFFFF")}${flower(800, 1465, "#F2B705")}`;
}

/** Arbre (tour 1) : tronc à écorce, feuillage en nuage ombré, pommes brillantes. Le tronc traverse la bande de raccord (x = 720 et 880). */
function treeShapes(p: Palette): string {
  const r = rng(300);
  const ink = p.dark;
  const BARK: [string, string, string] = ["#5A3A1E", "#9A6A3A", "#C99A5E"];
  const bark = Array.from({ length: 26 }, () => {
    const x = 735 + r() * 130, y = 700 + r() * 880, h = 50 + r() * 120;
    return stroke(`M${x.toFixed(0)} ${y.toFixed(0)} q${(r() * 12 - 6).toFixed(0)} ${(h / 2).toFixed(0)} ${(r() * 10 - 5).toFixed(0)} ${h.toFixed(0)}`, "#3A2A1A", 6, 'stroke-opacity=".55"');
  }).join("");
  const trunk = tube(720, 880, 620, 1600, BARK, ink, 22, r) + bark;
  // Feuillage : une cinquantaine de touffes légères (dégradé, fin contour), du fond sombre vers le dessus clair.
  const leaf = (cx: number, cy: number, rad: number, light: number) => {
    const g = radial(light > 0.66 ? "#D7F2B0" : light > 0.33 ? "#B6E39B" : "#8FCB84", light > 0.66 ? "#6DBB5E" : light > 0.33 ? "#4FA05A" : "#3E8B4A", light > 0.66 ? "#3E8B4A" : "#1F5A32");
    const pts = blob(cx, cy, rad, rad * 0.88, rad * 0.1, r);
    return `<defs>${g.def}</defs><path d="${smooth(pts, true)}" fill="url(#${g.id})" stroke="#1F5A32" stroke-width="7" stroke-opacity=".85"/>
      <path d="M${cx - rad * 0.4} ${cy - rad * 0.2} q${rad * 0.3} ${-rad * 0.35} ${rad * 0.7} ${-rad * 0.2}" stroke="#fff" stroke-opacity=".35" stroke-width="9" fill="none" stroke-linecap="round"/>`;
  };
  const spots: [number, number, number][] = [];
  while (spots.length < 52) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r());
    const x = 800 + Math.cos(a) * d * 470, y = 440 + Math.sin(a) * d * 290;
    spots.push([x, y, 72 + r() * 46]);
  }
  spots.sort((a, b) => b[1] - a[1]);
  const maxY = 730, minY = 150;
  const branches = [stroke("M800 640 q-70 -70 -170 -110", ink, 34), stroke("M800 640 q70 -70 170 -110", ink, 34), stroke("M800 650 q-70 -70 -170 -110", "#9A6A3A", 22), stroke("M800 650 q70 -70 170 -110", "#9A6A3A", 22)].join("");
  const puffs = `<ellipse cx="800" cy="430" rx="440" ry="230" fill="#1F5A32" opacity=".4" filter="url(#b34)"/>` + spots.map(([x, y, rad]) => leaf(x, y, rad, 1 - (y - minY) / (maxY - minY))).join("");
  const veins = "";
  const apple = (x: number, y: number) => {
    const g = radial("#FF9A90", "#D6403A", "#8E1E1E");
    return `<defs>${g.def}</defs><circle cx="${x}" cy="${y}" r="40" fill="url(#${g.id})" stroke="${ink}" stroke-width="8"/><ellipse cx="${x - 14}" cy="${y - 16}" rx="10" ry="6" fill="#fff" opacity=".7" transform="rotate(-30 ${x - 14} ${y - 16})"/>${stroke(`M${x} ${y - 40} q6 -22 18 -30`, ink, 7)}<path d="M${x + 6} ${y - 52} q22 -18 38 -4 q-22 14 -38 4z" fill="#4FA05A" stroke="${ink}" stroke-width="5"/>`;
  };
  return `${trunk}${branches}${puffs}${veins}${[[560, 560], [870, 330], [1040, 600], [700, 690], [440, 440], [1170, 470], [900, 560]].map(([x, y]) => apple(x, y)).join("")}`;
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
    const { createDb } = await import("../src/lib/db/client");
    const drizzleDb = createDb(SHOTS_URL);
    const names = ["Alice", "Bastien", "Chloé", "Dylan"];
    const users: Record<string, User> = {};
    for (const name of names) {
      const email = `${name.toLowerCase().replace("é", "e")}@exemple.fr`;
      const ctx = await request.newContext({ baseURL: BASE });
      await api(await ctx.post("/api/register", { data: { name, email, password: PASSWORD } }));
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
      await page.getByLabel("Mot de passe", { exact: true }).fill(PASSWORD);
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
      // Le tronc prolonge celui de la bande reçue (x ≈ 0,45 et 0,55) : d'abord le remplissage au surligneur brun (trois passes),
      // puis les deux contours au crayon épais, l'écorce au crayon fin, un nœud (ovale), un reflet et de la mousse.
      const size = async (v: string) => page.getByLabel("Taille du trait").fill(v);
      await page.getByRole("button", { name: "Marron", exact: true }).click();
      await page.getByRole("button", { name: "Crayon", exact: true }).click();
      await size("60");
      for (const x of [0.466, 0.5, 0.534]) await hand([[x, 0.09], [x + 0.002, 0.45], [x - 0.002, 0.91]], 0.003);
      await page.getByRole("button", { name: "Noir", exact: true }).click();
      await page.getByRole("button", { name: "Épais", exact: true }).click();
      await hand([[0.45, 0.1], [0.452, 0.3], [0.447, 0.55], [0.455, 0.9]]);
      await hand([[0.55, 0.1], [0.548, 0.32], [0.553, 0.6], [0.545, 0.9]]);
      await page.getByRole("button", { name: "Fin", exact: true }).click();
      await page.getByRole("button", { name: "Noir", exact: true }).click();
      for (const [x, y] of [[0.47, 0.22], [0.51, 0.3], [0.485, 0.42], [0.52, 0.5], [0.475, 0.62], [0.515, 0.72], [0.49, 0.82]] as [number, number][]) {
        await hand([[x, y], [x + 0.008, y + 0.04], [x + 0.002, y + 0.08]], 0.003);
      }
      await page.getByRole("button", { name: "Moyen", exact: true }).click();
      await page.getByRole("button", { name: "Ovale", exact: true }).click();
      await page.getByRole("button", { name: "Rempli", exact: true }).click();
      await hand([[0.5, 0.52], [0.52, 0.58]], 0);
      await page.getByRole("button", { name: "Jaune", exact: true }).click();
      await page.getByRole("button", { name: "Surligneur", exact: true }).click();
      await size("26");
      await hand([[0.475, 0.16], [0.473, 0.45], [0.477, 0.74]], 0.003);
      await page.getByRole("button", { name: "Vert", exact: true }).click();
      await page.getByRole("button", { name: "Aérographe", exact: true }).click();
      await size("40");
      await hand([[0.452, 0.8], [0.5, 0.76], [0.548, 0.83]], 0.004);
      await hand([[0.452, 0.28], [0.468, 0.36], [0.455, 0.46]], 0.004);
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
      await page.getByText("Afficher les noms des dessinateurs").click();
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
      await page.getByText("Afficher les noms des dessinateurs").click();
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

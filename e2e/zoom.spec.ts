import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
async function register(browser: Browser, name: string, run: string, mobile = false) {
  const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 1500 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : { viewport: { width: 900, height: 1500 } });
  const page = await ctx.newPage();
  await page.goto("/register");
  await page.getByLabel("Nom").fill(name);
  await page.getByLabel("Email").fill(`${name.toLowerCase()}-${run}@example.com`);
  await page.getByLabel("Mot de passe").fill("motdepasse-long-1");
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await page.waitForURL("/");
  return page;
}
// Zoom au pincement (écran tactile simulé par le protocole Chromium) : le dessin zoomé suit les doigts, le trait tombe sous le doigt,
// « Vue entière » réinitialise, un deuxième doigt en plein trait annule le trait sans le valider.
test("zoom au pincement", async ({ browser }) => {
  test.setTimeout(240_000);
  const run = randomUUID().slice(0, 8);
  const alice = await register(browser, "Alice", run, true);
  const b = await register(browser, "Bob", run, true);
  await alice.goto("/games/new");
  await alice.getByLabel("Type", { exact: true }).selectOption("drawing");
  await alice.getByLabel("Nombre de dessinateurs").selectOption("2");
  await alice.getByRole("button", { name: "Créer la partie" }).click();
  await alice.waitForURL(/\/games\/(?!new)[^/]+$/);
  const url = alice.url();
  await b.goto(url);
  await b.getByRole("button", { name: "Rejoindre" }).click();
  await b.waitForURL(url);
  let active: Page | null = null;
  await expect.poll(async () => { for (const p of [alice, b]) { await p.goto(url); if (await p.getByRole("button", { name: "Envoyer mon dessin" }).isVisible()) { active = p; return true; } } return false; }, { timeout: 60_000 }).toBe(true);
  const a = active as unknown as Page;
  const cdp = await a.context().newCDPSession(a);
  const canvas = a.locator("canvas.drawing-canvas");
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  const touch = async (type: "touchStart" | "touchMove" | "touchEnd", points: { x: number; y: number; id: number }[]) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : points.map((p) => ({ x: p.x, y: p.y, id: p.id })) });
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  // Pincement : zoom environ ×3, centré.
  await touch("touchStart", [{ x: cx - 30, y: cy, id: 1 }, { x: cx + 30, y: cy, id: 2 }]);
  for (let i = 1; i <= 10; i++) await touch("touchMove", [{ x: cx - 30 - i * 6, y: cy, id: 1 }, { x: cx + 30 + i * 6, y: cy, id: 2 }]);
  await touch("touchEnd", []);
  await a.waitForTimeout(300);
  const transform = await a.locator(".canvas-stage").evaluate((el) => (el as HTMLElement).style.transform);
  expect(transform).toMatch(/scale\([23]/);
  // Trait au doigt pendant le zoom : il doit tomber sous le doigt (pixel sombre à la position correspondante du canvas).
  const sx = box.x + box.width * 0.5, sy = box.y + box.height * 0.5;
  await touch("touchStart", [{ x: sx - 40, y: sy, id: 5 }]);
  for (let i = 1; i <= 8; i++) await touch("touchMove", [{ x: sx - 40 + i * 10, y: sy, id: 5 }]);
  await touch("touchEnd", []);
  await a.waitForTimeout(400);
  const dark = await a.evaluate(({ sx, sy }) => {
    const c = document.querySelector("canvas.drawing-canvas") as HTMLCanvasElement;
    const r = c.getBoundingClientRect();
    const px = Math.round(((sx - r.left) / r.width) * c.width), py = Math.round(((sy - r.top) / r.height) * c.height);
    const d = c.getContext("2d")!.getImageData(px, py, 1, 1).data;
    return [d[0], d[1], d[2]];
  }, { sx, sy });
  expect(dark[0]).toBeLessThan(80);
  // Réinitialisation.
  await a.getByRole("button", { name: /Vue entière/ }).click();
  expect(await a.locator(".canvas-stage").evaluate((el) => (el as HTMLElement).style.transform)).toBe("");
  // Un second doigt en plein trait annule le trait sans le valider.
  await touch("touchStart", [{ x: cx, y: cy - 100, id: 7 }]);
  await touch("touchMove", [{ x: cx + 60, y: cy - 100, id: 7 }]);
  await touch("touchStart", [{ x: cx, y: cy - 100, id: 7 }, { x: cx + 80, y: cy + 100, id: 8 }]);
  await touch("touchEnd", []);
  await a.waitForTimeout(300);
});

import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";

// Base de dev (voir .env.local, chargé par playwright.config.ts) : les données du test y restent, avec des noms uniques.
// L'inscription est libre (REGISTRATION_MODE=open) : aucun code d'invitation.
async function register(browser: Browser, name: string, run: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/register");
  await page.getByLabel("Nom").fill(name);
  await page.getByLabel("Email").fill(`${name.toLowerCase()}-${run}@example.com`);
  await page.getByLabel("Mot de passe", { exact: true }).fill("motdepasse-long-1");
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await page.waitForURL("/");
  return page;
}

test("deux joueurs terminent une partie de texte", async ({ browser }) => {
  const run = randomUUID().slice(0, 8);
  const gameName = `Partie e2e ${run}`;
  const alice = await register(browser, "Alice", run);
  const bob = await register(browser, "Bob", run);

  await alice.goto("/games/new");
  await alice.getByLabel("Type", { exact: true }).selectOption("text");
  await alice.getByLabel("Titre de la partie (facultatif)").fill(gameName);
  await alice.getByLabel("Nombre d'écrivains").selectOption("2");
  await alice.getByLabel("Mots minimum").fill("2");
  await alice.getByLabel("Mots maximum").fill("30");
  await alice.getByRole("button", { name: "Créer la partie" }).click();
  await alice.waitForURL(/\/games\/(?!new)[^/]+$/);
  const gameUrl = alice.url();

  // Les listes sont paginées (plus anciennes d'abord) : on rejoint la partie directement par son lien.
  await bob.goto(gameUrl);
  await bob.getByRole("button", { name: "Rejoindre" }).click();
  await bob.waitForURL(gameUrl);

  const players = [alice, bob];
  const turns = ["Il était une fois\n\nun dragon timide", "qui rencontra un chevalier"];
  for (const [i, text] of turns.entries()) {
    // Cherche le joueur dont c'est le tour (la partie démarre dès qu'elle est pleine) sans pause fixe.
    let current: Page | null = null;
    await expect
      .poll(
        async () => {
          for (const p of players) {
            await p.goto(gameUrl);
            if (await p.getByLabel("Votre texte").isVisible()) {
              current = p;
              return true;
            }
          }
          return false;
        },
        { message: `joueur actif au tour ${i + 1}`, timeout: 60_000 },
      )
      .toBe(true);
    const active = current!;
    if (i === 1) {
      await expect(active.getByText("un dragon timide")).toBeVisible();
      await expect(active.getByText("Il était une fois")).toHaveCount(0);
    }
    await active.getByLabel("Votre texte").fill(text);
    await active.getByRole("button", { name: "Envoyer" }).click();
    // Au dernier tour, la page de l'œuvre est compilée à froid par le serveur de dev : on laisse plus de temps.
    await expect(active.getByLabel("Votre texte")).toBeHidden({ timeout: 45_000 });
  }

  await alice.goto(`${gameUrl}/final`);
  await expect(alice.getByRole("heading", { name: "Œuvre finale" })).toBeVisible();
  await expect(alice.getByText("qui rencontra un chevalier")).toBeVisible();

  // Commentaire d'Alice, puis lien public ouvert par un visiteur sans compte.
  await alice.getByLabel("Votre commentaire").fill("Quelle histoire !");
  await alice.getByRole("button", { name: "Publier" }).click();
  await expect(alice.getByText("Quelle histoire !")).toBeVisible();
  await alice.getByRole("button", { name: "Activer le lien public" }).click();
  const link = await alice.locator("code.invite-link").textContent();
  expect(link).toMatch(/\/p\/[A-Za-z0-9_-]{32}$/);
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(new URL(link!).pathname);
  await expect(visitor.getByRole("heading", { name: gameName })).toBeVisible();
  await expect(visitor.getByText("qui rencontra un chevalier")).toBeVisible();
  await expect(visitor.getByText("Quelle histoire !")).toHaveCount(0);
});

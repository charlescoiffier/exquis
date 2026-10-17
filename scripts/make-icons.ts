/** Génère les icônes de l'application installable (public/icons) à partir de src/app/icon.svg : `npx tsx scripts/make-icons.ts`. */
import { mkdirSync, readFileSync } from "node:fs";
import sharp from "sharp";

mkdirSync("public/icons", { recursive: true });
const svg = readFileSync("src/app/icon.svg");
async function main() {
  for (const size of [192, 512]) {
    await sharp(svg, { density: 384 }).resize(size, size).png().toFile(`public/icons/icon-${size}.png`);
  }
  // Icône « maskable » : le dessin occupe 70 % du carré, sur le fond de la page, pour résister au recadrage des lanceurs Android.
  const inner = await sharp(svg, { density: 384 }).resize(358, 358).png().toBuffer();
  await sharp({ create: { width: 512, height: 512, channels: 4, background: "#FBFAF5" } })
    .composite([{ input: inner, left: 77, top: 77 }])
    .png()
    .toFile("public/icons/icon-maskable-512.png");
  console.log("icônes générées dans public/icons");
}
main();

/**
 * `npm run dev:phone` : serveur de développement + worker accessibles depuis un smartphone du même réseau Wi-Fi.
 * Détecte l'adresse locale du Mac, la passe en APP_URL (connexion, liens d'invitation) et affiche l'adresse à ouvrir
 * avec un code d'invitation. La base de dev doit tourner (`npm run db:dev`).
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { networkInterfaces } from "node:os";

const PORT = process.env.PORT ?? "3000";

function lanAddress(): string | null {
  const candidates: string[] = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family === "IPv4" && !i.internal) candidates.push(`${name}\t${i.address}`);
    }
  }
  const pick = candidates.find((c) => c.startsWith("en0\t")) ?? candidates.find((c) => /\t(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))\./.test(c)) ?? candidates[0];
  return pick ? pick.split("\t")[1] : null;
}

const ip = lanAddress();
if (!ip) {
  console.error("Aucune adresse réseau locale trouvée : connectez le Mac à un réseau Wi-Fi.");
  process.exit(1);
}
const url = `http://${ip}:${PORT}`;
const env = { ...process.env, APP_URL: url } as NodeJS.ProcessEnv;

const children: ChildProcess[] = [
  spawn("npx", ["next", "dev", "--turbopack", "-H", "0.0.0.0", "-p", PORT], { env, stdio: "inherit" }),
  spawn("npm", ["run", "worker"], { env, stdio: "inherit" }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill("SIGTERM");
  setTimeout(() => process.exit(code), 500);
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
for (const c of children) c.on("exit", (code) => stop(code ?? 0));

let code = "";
try {
  code = execFileSync("npx", ["tsx", "--env-file-if-exists=.env.local", "scripts/create-invite.ts"], { env, stdio: ["ignore", "pipe", "ignore"] }).toString().trim().split("\n").pop() ?? "";
} catch {
  // base indisponible : on n'affiche simplement pas de code
}
console.log(`\n  Sur le smartphone (même Wi-Fi) : ${url}${code ? `\n  Code d'invitation pour créer un compte : ${code}` : ""}\n  Ctrl+C pour arrêter le serveur et le worker.\n`);

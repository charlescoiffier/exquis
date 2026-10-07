import { defineConfig } from "@playwright/test";
import { config } from "dotenv";

// Le serveur lancé par webServer et le script d'invitation du test lisent la base de dev dans .env.local.
config({ path: ".env.local", quiet: true });

export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  workers: 1,
  use: { baseURL: "http://localhost:3000" },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
    env: { ...process.env, REQUIRE_EMAIL_VERIFICATION: "false", REGISTRATION_MODE: "invite" } as Record<string, string>,
  },
});

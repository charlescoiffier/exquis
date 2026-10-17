import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default("http://localhost:3000"),
  BETTER_AUTH_SECRET: z.string().min(16),
  // Inscription libre par défaut ; « invite » réserve l'inscription aux personnes munies d'un code (npm run invite).
  REGISTRATION_MODE: z.enum(["invite", "open"]).default("open"),
  // Non renseignée : la vérification de l'adresse n'est exigée que si un service d'email est configuré (voir requireEmailVerification).
  REQUIRE_EMAIL_VERIFICATION: z.enum(["true", "false"]).optional(),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_DIR: z.string().default(".storage"),
  STORAGE_SECRET: z.string().min(16),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  // Envoi par SMTP (alternative à Resend) : serveur de votre hébergeur ou de votre domaine.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  // true : TLS implicite (port 465) ; false : STARTTLS (port 587) si le serveur le propose.
  SMTP_SECURE: z.enum(["true", "false"]).default("false"),
  MAIL_FROM: z.string().default("Exquis <no-reply@localhost>"),
});

export type Env = z.infer<typeof schema>;
let cached: Env | undefined;
export function env(): Env {
  return (cached ??= schema.parse(process.env));
}

/** Un service d'email est configuré (Resend ou SMTP) : sans lui, les emails ne sont qu'écrits dans les journaux. */
export function emailConfigured(e: Env = env()): boolean {
  return !!e.RESEND_API_KEY || !!e.SMTP_HOST;
}

/** Vérification de l'adresse à l'inscription : valeur explicite, sinon exigée seulement si l'on sait envoyer des emails. */
export function requireEmailVerification(e: Env = env()): boolean {
  return e.REQUIRE_EMAIL_VERIFICATION ? e.REQUIRE_EMAIL_VERIFICATION === "true" : emailConfigured(e);
}

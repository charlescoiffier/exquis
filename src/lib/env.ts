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

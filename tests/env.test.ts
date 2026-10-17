import { describe, expect, it } from "vitest";
import { emailConfigured, requireEmailVerification, type Env } from "@/lib/env";

const base = { REGISTRATION_MODE: "open", SMTP_PORT: 587, SMTP_SECURE: "false", MAIL_FROM: "x" } as unknown as Env;

describe("configuration des emails", () => {
  it("emailConfigured : Resend ou SMTP", () => {
    expect(emailConfigured(base)).toBe(false);
    expect(emailConfigured({ ...base, RESEND_API_KEY: "re_x" })).toBe(true);
    expect(emailConfigured({ ...base, SMTP_HOST: "smtp.exemple.fr" })).toBe(true);
  });
  it("la vérification d'adresse suit la valeur explicite, sinon la présence d'un service d'email", () => {
    expect(requireEmailVerification(base)).toBe(false);
    expect(requireEmailVerification({ ...base, SMTP_HOST: "smtp.exemple.fr" })).toBe(true);
    expect(requireEmailVerification({ ...base, SMTP_HOST: "smtp.exemple.fr", REQUIRE_EMAIL_VERIFICATION: "false" })).toBe(false);
    expect(requireEmailVerification({ ...base, REQUIRE_EMAIL_VERIFICATION: "true" })).toBe(true);
  });
});

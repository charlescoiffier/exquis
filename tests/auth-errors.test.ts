import { describe, expect, it } from "vitest";
import { loginErrorMessage } from "@/lib/auth-errors";

describe("loginErrorMessage", () => {
  it.each([
    [{ status: 401, code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" }, "Email ou mot de passe incorrect."],
    [{ status: 401 }, "Email ou mot de passe incorrect."],
    [{ status: 403, code: "EMAIL_NOT_VERIFIED", message: "Email not verified" }, "Vérifiez votre email avant de vous connecter."],
    [{ status: 429, message: "Too many requests. Please try again later." }, "Trop de tentatives, réessayez plus tard."],
    [{ status: 500, message: "Erreur du serveur" }, "Erreur du serveur"],
    [{ status: 500 }, "Connexion impossible."],
    [{}, "Connexion impossible."],
  ])("%j -> %s", (e, out) => expect(loginErrorMessage(e)).toBe(out));
});

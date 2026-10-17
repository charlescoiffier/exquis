import { eq } from "drizzle-orm";
import { route } from "@/lib/api";
import { getDb } from "@/lib/db/client";
import { user } from "@/lib/db/auth-schema";
import { DomainError } from "@/lib/errors";
import { getMailer, mailerKind } from "@/lib/notifications/mailer";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

/** Envoie un email de test à l'adresse du compte, et dit pourquoi si l'envoi échoue. */
export const POST = route(
  async () => {
    const u = await requireUser();
    const kind = mailerKind();
    if (kind === "console") throw new DomainError("mail_unavailable", "Aucun service d'email n'est configuré sur ce serveur.", 503);
    const [row] = await getDb().select({ email: user.email }).from(user).where(eq(user.id, u.id));
    try {
      await getMailer().send({ to: row.email, subject: "Exquis : email de test", text: "Si vous lisez ceci, les emails d'Exquis fonctionnent." });
    } catch (e) {
      console.error("[mail] test d'envoi échoué", e);
      throw new DomainError("mail_failed", `L'envoi a échoué : ${e instanceof Error ? e.message.slice(0, 160) : "erreur inconnue"}`, 502);
    }
    return { sent: true, to: row.email };
  },
  { limit: { name: "test-email", max: 10, windowMs: 3600_000 } },
);

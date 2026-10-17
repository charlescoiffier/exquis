/** Envoie un email de test avec la configuration actuelle : `npm run mail:test -- adresse@exemple.fr`. */
import { env } from "../src/lib/env";
import { getMailer, mailerKind } from "../src/lib/notifications/mailer";

async function main() {
  const to = process.argv[2];
  if (!to) {
    console.error("Usage : npm run mail:test -- <adresse>");
    process.exit(1);
  }
  const kind = mailerKind();
  console.log(`Service : ${kind} · expéditeur : ${env().MAIL_FROM}`);
  if (kind === "console") console.log("Aucun service configuré (RESEND_API_KEY ou SMTP_HOST) : rien ne sera réellement envoyé.");
  await getMailer().send({ to, subject: "Exquis : email de test", text: "Si vous lisez ceci, l'envoi d'emails fonctionne." });
  console.log("Envoyé sans erreur.");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("Échec de l'envoi :", e instanceof Error ? e.message : e);
    process.exit(1);
  },
);

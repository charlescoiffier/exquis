import nodemailer from "nodemailer";
import { emailConfigured, env, type Env } from "@/lib/env";

export interface Mailer {
  send(m: { to: string; subject: string; text: string }): Promise<void>;
}

export class ConsoleMailer implements Mailer {
  async send(m: { to: string; subject: string; text: string }) {
    console.log(`[mail] (non envoyé : aucun service d'email configuré) à ${m.to} — ${m.subject}\n${m.text}`);
  }
}

export class ResendMailer implements Mailer {
  constructor(private readonly apiKey: string, private readonly from: string) {}
  async send(m: { to: string; subject: string; text: string }) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: this.from, to: [m.to], subject: m.subject, text: m.text }),
    });
    // Le corps de la réponse explique la cause (domaine non vérifié, clé invalide…) : on la garde dans l'erreur.
    if (!r.ok) throw new Error(`Resend : HTTP ${r.status} ${(await r.text().catch(() => "")).slice(0, 300)}`);
  }
}

/** Envoi par SMTP (serveur de l'hébergeur ou du domaine). */
export class SmtpMailer implements Mailer {
  private readonly transport: nodemailer.Transporter;
  constructor(e: Env, private readonly from: string) {
    this.transport = nodemailer.createTransport({
      host: e.SMTP_HOST,
      port: e.SMTP_PORT,
      secure: e.SMTP_SECURE === "true",
      auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASSWORD } : undefined,
    });
  }
  async send(m: { to: string; subject: string; text: string }) {
    await this.transport.sendMail({ from: this.from, to: m.to, subject: m.subject, text: m.text });
  }
}

/** Service utilisé : SMTP s'il est configuré, sinon Resend, sinon la console (rien n'est envoyé). */
export function mailerKind(e: Env = env()): "smtp" | "resend" | "console" {
  return e.SMTP_HOST ? "smtp" : e.RESEND_API_KEY ? "resend" : "console";
}

export function getMailer(): Mailer {
  const e = env();
  if (e.SMTP_HOST) return new SmtpMailer(e, e.MAIL_FROM);
  if (e.RESEND_API_KEY) return new ResendMailer(e.RESEND_API_KEY, e.MAIL_FROM);
  return new ConsoleMailer();
}

export { emailConfigured };

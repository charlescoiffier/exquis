import { env } from "@/lib/env";

export interface Mailer {
  send(m: { to: string; subject: string; text: string }): Promise<void>;
}

export class ConsoleMailer implements Mailer {
  async send(m: { to: string; subject: string; text: string }) {
    console.log(`[mail] à ${m.to} — ${m.subject}\n${m.text}`);
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
    if (!r.ok) throw new Error(`Resend: HTTP ${r.status}`);
  }
}

export function getMailer(): Mailer {
  const e = env();
  return e.RESEND_API_KEY ? new ResendMailer(e.RESEND_API_KEY, e.MAIL_FROM) : new ConsoleMailer();
}

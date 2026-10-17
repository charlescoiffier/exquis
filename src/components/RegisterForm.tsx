"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PasswordInput } from "@/components/ui/PasswordInput";

export function RegisterForm({ inviteOnly }: { inviteOnly: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: f.get("name"),
        email: f.get("email"),
        password: f.get("password"),
        invitationCode: f.get("invitationCode") || undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data.error ?? data.message ?? "Inscription impossible.");
    if (data.token) {
      router.push("/");
      router.refresh();
    } else {
      setInfo("Compte créé. Vérifiez votre email pour l'activer, puis connectez-vous.");
    }
  }

  return (
    <>
      <Card className="auth-card">
        <form onSubmit={onSubmit}>
          <label htmlFor="name" style={{ marginTop: 0 }}>Nom</label>
          <input id="name" name="name" autoComplete="nickname" required />
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required />
          <label htmlFor="password">Mot de passe</label>
          <PasswordInput id="password" name="password" autoComplete="new-password" minLength={10} required describedBy="password-hint" />
          <p id="password-hint" className="hint">10 caractères au minimum.</p>
          {inviteOnly && (
            <>
              <label htmlFor="invitationCode">Code d&apos;invitation</label>
              <input id="invitationCode" name="invitationCode" />
            </>
          )}
          {error && <p className="form-error" role="alert" style={{ marginTop: 14 }}>{error}</p>}
          {info && <p className="notice success" role="status" style={{ marginTop: 14 }}>{info}</p>}
          <Button type="submit">Créer mon compte</Button>
        </form>
        <p className="muted" style={{ margin: "16px 0 0" }}>Déjà inscrit ? <a href="/login">Se connecter</a></p>
      </Card>
    </>
  );
}

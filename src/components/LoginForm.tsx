"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { authClient } from "@/lib/auth-client";
import { loginErrorMessage } from "@/lib/auth-errors";

export function LoginForm({ inviteOnly }: { inviteOnly: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email"));
    setError(null);
    setInfo(null);
    setUnverifiedEmail(null);
    const { error } = await authClient.signIn.email({ email, password: String(f.get("password")) });
    if (error) {
      if (error.code === "EMAIL_NOT_VERIFIED" || error.status === 403) setUnverifiedEmail(email);
      return setError(loginErrorMessage(error));
    }
    router.push("/");
    router.refresh();
  }

  async function resend() {
    if (!unverifiedEmail) return;
    setInfo(null);
    const { error } = await authClient.sendVerificationEmail({ email: unverifiedEmail, callbackURL: "/" });
    setInfo(error ? "Envoi impossible pour le moment, réessayez plus tard." : "Email de confirmation envoyé : cliquez sur le lien qu'il contient, puis connectez-vous.");
  }

  return (
    <Card className="auth-card">
      <form onSubmit={onSubmit}>
        <label htmlFor="email" style={{ marginTop: 0 }}>Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required />
        <label htmlFor="password">Mot de passe</label>
        <PasswordInput id="password" name="password" autoComplete="current-password" required />
        {error && <p className="form-error" role="alert" style={{ marginTop: 14 }}>{error}</p>}
        {unverifiedEmail && <button type="button" className="secondary" onClick={resend} style={{ marginTop: 12 }}>Renvoyer l&apos;email de confirmation</button>}
        {info && <p className="notice success" role="status" style={{ marginTop: 14 }}>{info}</p>}
        <Button type="submit">Se connecter</Button>
      </form>
      <p className="muted" style={{ margin: "16px 0 0" }}>
        Pas encore de compte ? <a href="/register">Créer un compte</a>
        {inviteOnly ? " (invitation requise)." : "."}
      </p>
    </Card>
  );
}

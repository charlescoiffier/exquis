"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { authClient } from "@/lib/auth-client";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const { error } = await authClient.signIn.email({ email: String(f.get("email")), password: String(f.get("password")) });
    if (error) return setError(error.status === 401 || error.status === 400 ? "Email ou mot de passe incorrect." : "Connexion impossible.");
    router.push("/");
    router.refresh();
  }

  return (
    <main>
      <Banner title="Connexion" />
      <Card className="auth-card">
        <form onSubmit={onSubmit}>
          <label htmlFor="email" style={{ marginTop: 0 }}>Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required />
          <label htmlFor="password">Mot de passe</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
          {error && <p className="form-error" role="alert" style={{ marginTop: 14 }}>{error}</p>}
          <Button type="submit">Se connecter</Button>
        </form>
        <p className="muted" style={{ margin: "16px 0 0" }}>Pas encore de compte ? <a href="/register">Créer un compte</a> (invitation requise).</p>
      </Card>
    </main>
  );
}

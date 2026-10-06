"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const { error } = await authClient.signIn.email({ email: String(f.get("email")), password: String(f.get("password")) });
    if (error) return setError(error.message ?? "Connexion impossible.");
    router.push("/");
    router.refresh();
  }

  return (
    <main>
      <h1>Connexion</h1>
      <form onSubmit={onSubmit}>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required />
        <label htmlFor="password">Mot de passe</label>
        <input id="password" name="password" type="password" required />
        {error && <p className="error">{error}</p>}
        <p><button type="submit">Se connecter</button></p>
      </form>
      <p className="muted">Pas encore de compte ? <a href="/register">Créer un compte</a> (invitation requise).</p>
    </main>
  );
}

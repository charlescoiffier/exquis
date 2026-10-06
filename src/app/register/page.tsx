"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function RegisterPage() {
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
    <main>
      <h1>Créer un compte</h1>
      <form onSubmit={onSubmit}>
        <label htmlFor="name">Nom</label>
        <input id="name" name="name" required />
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required />
        <label htmlFor="password">Mot de passe</label>
        <input id="password" name="password" type="password" minLength={10} required />
        <label htmlFor="invitationCode">Code d&apos;invitation</label>
        <input id="invitationCode" name="invitationCode" />
        {error && <p className="error">{error}</p>}
        {info && <p>{info}</p>}
        <p><button type="submit">Créer mon compte</button></p>
      </form>
    </main>
  );
}

"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";

async function saveProfile(patch: { name?: string; emailEnabled?: boolean }): Promise<string | null> {
  try {
    const res = await fetch("/api/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    const data = await res.json().catch(() => ({}));
    return res.ok ? null : (data.error ?? "Enregistrement impossible.");
  } catch {
    return "Impossible de joindre le serveur, réessayez.";
  }
}

/** Changement du nom affiché. */
export function NameForm({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const err = await saveProfile({ name });
    setBusy(false);
    if (err) return setMessage({ ok: false, text: err });
    setMessage({ ok: true, text: "Nom enregistré." });
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit}>
      <label htmlFor="account-name">Nom affiché</label>
      <input id="account-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} required aria-describedby="account-name-hint" />
      <p id="account-name-hint" className="hint">Visible des autres joueurs dans les listes et sur les œuvres.</p>
      {message && <p role={message.ok ? "status" : "alert"} className={message.ok ? "notice" : "error"}>{message.text}</p>}
      <Button type="submit" disabled={busy || name.trim() === "" || name.trim() === initialName}>Enregistrer</Button>
    </form>
  );
}

/** Préférence d'envoi des notifications par email. */
export function EmailPreference({ initial }: { initial: boolean }) {
  const [email, setEmail] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  async function toggle(v: boolean) {
    const previous = email;
    setEmail(v);
    setError(null);
    const err = await saveProfile({ emailEnabled: v });
    if (err) {
      setEmail(previous);
      setError(err);
    }
  }

  return (
    <div>
      <label className="switch">
        <input type="checkbox" role="switch" checked={email} onChange={(e) => toggle(e.target.checked)} />
        <span className="switch-track" aria-hidden="true" />
        <span>Recevoir les notifications par email</span>
      </label>
      {error && <p role="alert" className="error">{error}</p>}
    </div>
  );
}

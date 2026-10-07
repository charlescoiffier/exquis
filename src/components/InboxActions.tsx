"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function InboxActions({ emailEnabled }: { emailEnabled: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState(emailEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function markRead() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/notifications", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Impossible de marquer les notifications comme lues.");
        return;
      }
      router.refresh();
    } catch {
      setError("Impossible de joindre le serveur, réessayez.");
    } finally {
      setBusy(false);
    }
  }
  async function toggleEmail(v: boolean) {
    const previous = email;
    setEmail(v);
    setError(null);
    try {
      const res = await fetch("/api/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ emailEnabled: v }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEmail(previous);
        setError(data.error ?? "Impossible d'enregistrer la préférence.");
      }
    } catch {
      setEmail(previous);
      setError("Impossible de joindre le serveur, réessayez.");
    }
  }

  return (
    <div className="inbox-actions">
      <label className="switch">
        <input type="checkbox" role="switch" checked={email} onChange={(e) => toggleEmail(e.target.checked)} />
        <span className="switch-track" aria-hidden="true" />
        <span>Recevoir les notifications par email</span>
      </label>
      <button type="button" className="secondary" onClick={markRead} disabled={busy}>Tout marquer comme lu</button>
      {error && <p role="alert" className="error inbox-error">{error}</p>}
    </div>
  );
}

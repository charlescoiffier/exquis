"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function InboxActions() {
  const router = useRouter();
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
  return (
    <div className="inbox-actions">
      <button type="button" className="secondary" onClick={markRead} disabled={busy}>Tout marquer comme lu</button>
      {error && <p role="alert" className="error inbox-error">{error}</p>}
    </div>
  );
}

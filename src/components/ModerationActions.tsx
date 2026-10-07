"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";

/** Traiter un signalement : masquer le contenu ou rejeter le signalement. */
export function ModerationActions({ reportId, targetType }: { reportId: string; targetType: "comment" | "work" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "hide" | "dismiss") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/moderation/reports/${reportId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Action impossible.");
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
    <div className="turn-actions">
      <Button disabled={busy} onClick={() => act("hide")}>{targetType === "comment" ? "Masquer le commentaire" : "Masquer l'œuvre"}</Button>
      <Button variant="secondary" disabled={busy} onClick={() => act("dismiss")}>Rejeter le signalement</Button>
      {error && <span role="alert" className="error">{error}</span>}
    </div>
  );
}

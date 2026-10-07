"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Quitter une partie (après confirmation) : ses tours à venir sont proposés à d'autres joueurs. */
export function LeaveButton({ gameId, inProgress }: { gameId: string; inProgress: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function leave() {
    const question = inProgress
      ? "Quitter cette partie ? Vos tours à venir seront proposés à d'autres joueurs."
      : "Quitter cette partie ? Vous serez désinscrit(e).";
    if (!window.confirm(question)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/games/${gameId}/leave`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Impossible de quitter la partie.");
        setBusy(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Impossible de quitter la partie.");
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="secondary" onClick={leave} disabled={busy}>Quitter</button>
      {error && <p role="alert" className="error" style={{ margin: 0 }}>{error}</p>}
    </>
  );
}

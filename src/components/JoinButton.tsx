"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** `claim` : reprise d'un appel à participation (dernier tour laissé vacant) au lieu d'une inscription classique. */
export function JoinButton({ gameId, token, claim = false }: { gameId: string; token?: string; claim?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/games/${gameId}/${claim ? "claim" : "join"}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Impossible de rejoindre.");
        setBusy(false);
        return;
      }
      router.push(`/games/${gameId}`);
      router.refresh();
    } catch {
      setError("Impossible de rejoindre.");
      setBusy(false);
    }
  }

  return (
    <>
      <button onClick={join} disabled={busy}>{claim ? "Reprendre le tour" : "Rejoindre"}</button>
      {error && <p role="alert" className="error" style={{ margin: "8px 0 0" }}>{error}</p>}
    </>
  );
}

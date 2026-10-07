"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

/** Quitter une partie (après confirmation dans une modale) : ses tours à venir sont proposés à d'autres joueurs. */
export function LeaveButton({ gameId, gameName, inProgress }: { gameId: string; gameName: string; inProgress: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function leave() {
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
      setOpen(false);
      router.refresh();
    } catch {
      setError("Impossible de quitter la partie.");
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="secondary" onClick={() => setOpen(true)}>Quitter</button>
      {open && (
        <ConfirmDialog
          title="Quitter cette partie ?"
          confirmLabel="Quitter la partie"
          busy={busy}
          error={error}
          onConfirm={leave}
          onCancel={() => {
            setOpen(false);
            setError(null);
          }}
        >
          <p>
            <strong>{gameName}</strong>
            <br />
            {inProgress
              ? "Vos tours à venir seront proposés à d'autres joueurs. Ce que vous avez déjà envoyé restera dans l'œuvre."
              : "Vous serez désinscrit(e) de cette partie."}
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}

"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

/** Lien public en lecture seule : activé et révoqué par le créateur, copiable par tous les participants. */
export function ShareCard({ gameId, token, isCreator }: { gameId: string; token: string | null; isCreator: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  // L'origine n'est connue que dans le navigateur : on l'ajoute après l'hydratation pour que le rendu serveur et client coïncident.
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const link = token ? `${origin}/p/${token}` : "";

  async function set(enabled: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/games/${gameId}/share`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled }) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Action impossible.");
        return;
      }
      setConfirmOff(false);
      setCopied(false);
      router.refresh();
    } catch {
      setError("Impossible de joindre le serveur, réessayez.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    setCopied(false);
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setError("Copie automatique impossible : sélectionnez le lien pour le copier.");
    }
  }

  return (
    <section aria-labelledby="partage" className="final-info">
      <h2 id="partage">Partager</h2>
      <Card>
        {token ? (
          <>
            <p style={{ margin: "0 0 8px" }}>Toute personne qui a ce lien peut voir l&apos;œuvre, sans compte. Les commentaires restent réservés aux participants.</p>
            <code className="invite-link">{link}</code>
            <div className="turn-actions">
              <button type="button" onClick={copy}>Copier le lien</button>
              {isCreator && <button type="button" className="secondary" onClick={() => setConfirmOff(true)} disabled={busy}>Désactiver le lien</button>}
              {copied && <span role="status" className="feedback">Copié.</span>}
            </div>
          </>
        ) : isCreator ? (
          <>
            <p style={{ margin: "0 0 8px" }}>Créez un lien public en lecture seule pour montrer l&apos;œuvre à des personnes qui n&apos;ont pas de compte. Vous pourrez le désactiver à tout moment.</p>
            <button type="button" onClick={() => set(true)} disabled={busy}>Activer le lien public</button>
          </>
        ) : (
          <p style={{ margin: 0 }} className="muted">Le créateur de la partie peut activer un lien public pour partager cette œuvre.</p>
        )}
        {error && <p role="alert" className="error">{error}</p>}
      </Card>
      {confirmOff && (
        <ConfirmDialog title="Désactiver le lien public ?" confirmLabel="Désactiver" busy={busy} error={error} onConfirm={() => set(false)} onCancel={() => setConfirmOff(false)}>
          <p>Le lien actuel cessera de fonctionner pour tous ceux qui l&apos;ont reçu. En le réactivant, un nouveau lien sera créé.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}

"use client";
import { useState } from "react";

export function InviteButton() {
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const link = code ? `${window.location.origin}/register` : "";
  const message = code ? `Rejoins-moi sur Cadavre exquis : ${link} — code d'invitation : ${code}` : "";

  async function generate() {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch("/api/invitations", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.code !== "string") {
        setError(res.status === 429 ? (data.error ?? "Trop d'invitations en attente : attendez qu'elles soient utilisées.") : (data.error ?? "Impossible de générer une invitation."));
        return;
      }
      setCode(data.code);
    } catch {
      setError("Impossible de joindre le serveur, réessayez.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    setCopied(false);
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
    } catch {
      // Presse-papiers indisponible : on sélectionne le texte pour une copie manuelle.
      const el = document.getElementById("invite-message");
      const sel = window.getSelection();
      if (el && sel) {
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      setError("Copie automatique impossible : le texte est sélectionné, copiez-le manuellement.");
    }
  }

  return (
    <div>
      <button type="button" className="secondary" onClick={generate} disabled={busy}>Générer une invitation</button>
      {code && (
        <div>
          <p>Code d&apos;invitation : <code>{code}</code></p>
          <p>Lien d&apos;inscription : <code>{link}</code></p>
          <p id="invite-message" className="muted">{message}</p>
          <button type="button" className="secondary" onClick={copy}>Copier</button>
          {copied && <span role="status" className="muted"> Copié.</span>}
        </div>
      )}
      {error && <p role="alert" className="error">{error}</p>}
    </div>
  );
}

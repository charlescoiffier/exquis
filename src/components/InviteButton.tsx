"use client";
import { useState } from "react";
import { copyText } from "@/lib/clipboard";

export function InviteButton() {
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const link = code ? `${window.location.origin}/register` : "";
  const message = code ? `Rejoins-moi sur Exquis : ${link} — code d'invitation : ${code}` : "";

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
    if (await copyText(message)) {
      setCopied(true);
    } else {
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
      <p className="hint" style={{ margin: "0 0 10px" }}>Générez un code à usage unique pour inviter quelqu&apos;un à s&apos;inscrire.</p>
      <button type="button" onClick={generate} disabled={busy}>Générer une invitation</button>
      {code && (
        <div className="invite">
          <p style={{ margin: "0 0 6px" }}>Code d&apos;invitation : <code className="invite-code">{code}</code></p>
          <p style={{ margin: "0 0 6px" }}>Lien d&apos;inscription : <code className="invite-link">{link}</code></p>
          <p id="invite-message" className="invite-link muted">{message}</p>
          <div className="turn-actions">
            <button type="button" className="secondary" onClick={copy}>Copier</button>
            {copied && <span role="status" className="feedback">Copié.</span>}
          </div>
        </div>
      )}
      {error && <p role="alert" className="error">{error}</p>}
    </div>
  );
}

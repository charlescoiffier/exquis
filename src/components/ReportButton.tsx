"use client";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { REPORT_REASONS } from "@/lib/report-reasons";

/** Signaler un commentaire ou une œuvre : motif obligatoire, précisions facultatives, envoyé aux modérateurs. */
export function ReportButton({ targetType, targetId, label = "Signaler", className = "secondary comment-delete" }: { targetType: "comment" | "work"; targetId: string; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>(REPORT_REASONS[0].id);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/reports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetType, targetId, reason, details: details.trim() || undefined }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Envoi impossible.");
        if (data.code === "already_reported") setDone(true);
        return;
      }
      setDone(true);
      setOpen(false);
    } catch {
      setError("Impossible de joindre le serveur, réessayez.");
    } finally {
      setBusy(false);
    }
  }

  if (done && !open) return <span role="status" className="feedback">Signalement envoyé.</span>;
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{label}</button>
      {open && (
        <ConfirmDialog title={targetType === "comment" ? "Signaler ce commentaire" : "Signaler cette œuvre"} confirmLabel="Envoyer le signalement" busy={busy} error={error} onConfirm={send} onCancel={() => setOpen(false)}>
          <label htmlFor="report-reason">Motif</label>
          <select id="report-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
            {REPORT_REASONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          <label htmlFor="report-details" style={{ marginTop: 12 }}>Précisions (facultatif)</label>
          <textarea id="report-details" rows={3} maxLength={500} value={details} onChange={(e) => setDetails(e.target.value)} />
          <p className="hint">Votre signalement est transmis aux modérateurs ; la personne concernée n&apos;est pas prévenue.</p>
        </ConfirmDialog>
      )}
    </>
  );
}

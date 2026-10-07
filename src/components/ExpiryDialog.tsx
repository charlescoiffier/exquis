"use client";
import { useEffect, useRef } from "react";
import { formatDuration } from "@/lib/format";

type Props = {
  question: string;
  submitLabel: string;
  msLeft: number;
  busy: boolean;
  error: string | null;
  onSubmit: () => void;
  onAbandon: () => void;
};

/** Fenêtre modale de confirmation affichée entre l'échéance et la fin du délai de validation. */
export function ExpiryDialog({ question, submitLabel, msLeft, busy, error, onSubmit, onAbandon }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const seconds = Math.ceil(msLeft / 1000);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    submitRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  function onKeyDown(e: React.KeyboardEvent) {
    // Échap ne ferme pas la fenêtre : abandonner doit être un choix explicite.
    if (e.key === "Escape") {
      e.preventDefault();
      return;
    }
    if (e.key !== "Tab") return;
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? []);
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !ref.current?.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !ref.current?.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="modal-backdrop" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "grid", placeItems: "center", zIndex: 1000 }}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="expiry-title"
        aria-describedby="expiry-desc"
        onKeyDown={onKeyDown}
        style={{ background: "var(--bg, #fff)", color: "inherit", padding: 24, maxWidth: 420, width: "calc(100% - 32px)", border: "1px solid var(--line)", borderRadius: 8 }}
      >
        <h2 id="expiry-title" style={{ marginTop: 0 }}>{question}</h2>
        <p id="expiry-desc" role="timer" aria-live="off">
          Il vous reste {formatDuration(seconds)} pour valider.
        </p>
        {error && <p className="error" role="alert">{error}</p>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button ref={submitRef} type="button" onClick={onSubmit} disabled={busy}>{submitLabel}</button>
          <button type="button" className="secondary" onClick={onAbandon}>Abandonner ce tour</button>
        </div>
      </div>
    </div>
  );
}

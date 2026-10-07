"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatDuration } from "@/lib/format";

/** Temps restant (ms) avant `expiresAtMs`, mis à jour à l'intérieur du composant appelant seulement. */
function useRemaining(expiresAtMs: number, getNow: () => number): number {
  const [left, setLeft] = useState(() => Math.max(0, expiresAtMs - getNow()));
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, expiresAtMs - getNow()));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [expiresAtMs, getNow]);
  return left;
}

export const EDITOR_ROOT_ID = "turn-editor-root";

type Props = {
  question: string;
  expiresAtMs: number;
  getNow: () => number;
  busy: boolean;
  error: string | null;
  /** Absent : l'envoi est impossible (explication affichée à la place). */
  submitLabel?: string;
  onSubmit?: () => void;
  explanation?: string;
  continueLabel?: string;
  onContinue?: () => void;
  onAbandon: () => void;
};

/** Fenêtre modale de confirmation affichée entre l'échéance et la fin du délai de validation. */
export function ExpiryDialog({ question, expiresAtMs, getNow, busy, error, submitLabel, onSubmit, explanation, continueLabel, onContinue, onAbandon }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const left = useRemaining(expiresAtMs, getNow);
  const seconds = Math.ceil(left / 1000);

  // L'éditeur est rendu inerte (ni focus ni clic) tant que la fenêtre est ouverte.
  useEffect(() => {
    const root = document.getElementById(EDITOR_ROOT_ID);
    // Lire l'élément focalisé AVANT de rendre l'éditeur inerte (inert fait perdre le focus).
    const previous = document.activeElement as HTMLElement | null;
    root?.setAttribute("inert", "");
    const first = ref.current?.querySelector<HTMLElement>("button:not([disabled])");
    (first ?? ref.current)?.focus();
    return () => {
      root?.removeAttribute("inert");
      previous?.focus?.();
    };
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
      ref.current?.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === ref.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "grid", placeItems: "center", zIndex: 1000 }}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="expiry-title"
        aria-describedby="expiry-desc"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={{ background: "var(--bg, #fff)", color: "inherit", padding: 24, maxWidth: 420, width: "calc(100% - 32px)", border: "1px solid var(--line)", borderRadius: 8 }}
      >
        <h2 id="expiry-title" style={{ marginTop: 0 }}>{question}</h2>
        <div id="expiry-desc">
          {explanation && <p>{explanation}</p>}
          <p role="timer" aria-live="off">Il vous reste {formatDuration(seconds)} pour valider.</p>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {submitLabel && onSubmit && <button type="button" onClick={onSubmit} disabled={busy}>{submitLabel}</button>}
          {continueLabel && onContinue && <button type="button" onClick={onContinue}>{continueLabel}</button>}
          <button type="button" className="secondary" onClick={onAbandon} disabled={busy}>Abandonner ce tour</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Bandeau de compte à rebours (fenêtre de validation, une fois la fenêtre modale fermée). */
export function ValidationBanner({ expiresAtMs, getNow }: { expiresAtMs: number; getNow: () => number }) {
  const left = useRemaining(expiresAtMs, getNow);
  return <p role="status" className="error">Temps écoulé : il vous reste {formatDuration(Math.ceil(left / 1000))} pour envoyer votre texte.</p>;
}

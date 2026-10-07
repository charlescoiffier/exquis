"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Petite fenêtre modale de confirmation, dans le style de l'application. Le focus démarre sur « Annuler » (choix sûr),
 * reste dans la fenêtre (Tab) et revient à l'élément d'origine à la fermeture. Échap ou un clic à côté annule.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel = "Annuler",
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (!busy) onCancel();
      return;
    }
    if (e.key !== "Tab") return;
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? []);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div className="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={children ? descId : undefined} onKeyDown={onKeyDown} className="dialog dialog-small">
        <h2 id={titleId} className="dialog-title">{title}</h2>
        {children && <div id={descId}>{children}</div>}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={onConfirm} disabled={busy}>{confirmLabel}</button>
          <button type="button" className="secondary" ref={cancelRef} onClick={onCancel} disabled={busy}>{cancelLabel}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

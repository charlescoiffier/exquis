"use client";
import { useState } from "react";

/** Champ de mot de passe avec un bouton pour l'afficher en clair ou le masquer. */
export function PasswordInput({ id, name, autoComplete, minLength, required, describedBy }: { id: string; name: string; autoComplete: string; minLength?: number; required?: boolean; describedBy?: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-field">
      <input id={id} name={name} type={visible ? "text" : "password"} autoComplete={autoComplete} minLength={minLength} required={required} aria-describedby={describedBy} autoCapitalize="none" spellCheck={false} />
      <button type="button" className="secondary" onClick={() => setVisible((v) => !v)} aria-pressed={visible} aria-label={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"}>
        {visible ? "Masquer" : "Afficher"}
      </button>
    </div>
  );
}

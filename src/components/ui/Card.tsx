import type { ReactNode } from "react";

/** Carte à bordure noire de 2 px et ombre dure. `call` : carte « canard » pour un appel à participation. */
export function Card({ children, call = false, className = "" }: { children: ReactNode; call?: boolean; className?: string }) {
  return <div className={`card${call ? " card-call" : ""}${className ? ` ${className}` : ""}`}>{children}</div>;
}

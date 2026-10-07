"use client";
import { useEffect } from "react";

/**
 * Sur un trackpad, le défilement à deux doigts au-dessus d'un champ numérique sélectionné en change la valeur :
 * on retire le focus du champ avant que le navigateur ne modifie sa valeur.
 */
export function NoWheelNumber() {
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement && el.type === "number" && e.target === el) el.blur();
    };
    document.addEventListener("wheel", onWheel, { passive: true });
    return () => document.removeEventListener("wheel", onWheel);
  }, []);
  return null;
}

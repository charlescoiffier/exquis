"use client";
import { useEffect } from "react";
import { TURN_PREFIX, pageTitle } from "@/lib/hooks/auto-refresh";

/**
 * Badge dans le titre de l'onglet quand c'est le tour du joueur ; titre d'origine restauré sinon et au démontage.
 * Next réécrit le titre à chaque rafraîchissement : on le réapplique tant que le composant est monté.
 */
export function TurnTitle({ myTurn }: { myTurn: boolean }) {
  useEffect(() => {
    if (!myTurn) return;
    let original = document.title;
    const apply = () => {
      if (document.title.startsWith(TURN_PREFIX)) return;
      original = document.title;
      document.title = pageTitle(true, original);
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      document.title = original;
    };
  }, [myTurn]);
  return null;
}

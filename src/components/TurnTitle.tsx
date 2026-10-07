"use client";
import { useEffect } from "react";
import { pageTitle } from "@/lib/hooks/auto-refresh";

/**
 * Badge dans le titre de l'onglet quand c'est le tour du joueur ; titre d'origine restauré sinon et au démontage.
 * Next réécrit le titre à chaque rafraîchissement : on le réapplique tant que le composant est monté.
 */
export function TurnTitle({ myTurn }: { myTurn: boolean }) {
  useEffect(() => {
    if (!myTurn) return;
    const badge = pageTitle(true);
    let original = document.title;
    const apply = () => {
      if (document.title === badge) return;
      original = document.title;
      document.title = badge;
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

"use client";
import { useEffect, useRef } from "react";
import { createDraftSaver, startAutosave } from "./draft-autosave";

const INTERVAL_MS = 5000;

/**
 * Sauvegarde le brouillon du tour courant : dernier contenu en ref, un seul intervalle de 5 s,
 * enregistrement confirmé seulement si `res.ok`, et envoi immédiat quand l'onglet passe en arrière-plan.
 */
export function useDraftAutosave(gameId: string, content: object, initial: object): void {
  const json = JSON.stringify(content);
  const latest = useRef(json);
  useEffect(() => {
    latest.current = json;
  }, [json]);
  const initialJson = useRef(JSON.stringify(initial));

  useEffect(() => {
    const saver = createDraftSaver({
      initial: initialJson.current,
      read: () => latest.current,
      send: async (body) => {
        const res = await fetch(`/api/games/${gameId}/my-turn/draft`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body,
          keepalive: body.length < 60000,
        });
        return res.ok;
      },
    });
    const stop = startAutosave(saver, INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void saver.flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [gameId]);
}

"use client";
import { useEffect, useState } from "react";
import { EXPIRED_MESSAGE, consumeExpired, msUntilReassigned, noticeMessage, onExpiredCleared, readMarker } from "@/lib/expired-notice";

/** Affiché quand le joueur n'a plus de tour actif : rappelle une seule fois que son tour a été remis en jeu. */
export function ExpiredNotice({ gameId }: { gameId: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const m = readMarker(gameId);
    if (m) {
      const now = Date.now();
      const text = noticeMessage(m, now);
      if (text) {
        setMsg(text);
        if (text === EXPIRED_MESSAGE) consumeExpired(gameId);
        else {
          // Abandon : on passe au message définitif quand le serveur a réellement remis le tour en jeu.
          timer = setTimeout(() => {
            setMsg(EXPIRED_MESSAGE);
            consumeExpired(gameId);
          }, Math.max(0, msUntilReassigned(m, now)));
        }
      }
    }
    const off = onExpiredCleared(() => setMsg(null));
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [gameId]);
  if (!msg) return null;
  return (
    <p role="status" className="error">
      {msg}{" "}
      <button type="button" className="secondary" onClick={() => { consumeExpired(gameId); setMsg(null); }}>
        Fermer
      </button>
    </p>
  );
}

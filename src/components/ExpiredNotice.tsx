"use client";
import { useEffect, useState } from "react";
import { EXPIRED_MESSAGE, consumeExpired, msUntilReassigned, noticeDecision, onExpiredCleared, readMarker } from "@/lib/expired-notice";
import { clockOffset } from "@/lib/turn-timing";

/** Affiché quand le joueur n'a plus de tour actif : rappelle une seule fois que son tour a été remis en jeu. */
export function ExpiredNotice({ gameId, serverNow }: { gameId: string; serverNow: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const m = readMarker(gameId);
    if (m) {
      // Heure du serveur (pas l'horloge brute du client).
      const now = Date.now() + clockOffset(serverNow, Date.now());
      const { message, consume } = noticeDecision(m, now);
      if (message) setMsg(message);
      if (consume) consumeExpired(gameId);
      else if (message) {
        // Abandon : on passe au message définitif quand le serveur a réellement remis le tour en jeu.
        timer = setTimeout(() => {
          setMsg(EXPIRED_MESSAGE);
          consumeExpired(gameId);
        }, Math.max(0, msUntilReassigned(m, now)));
      }
    }
    const off = onExpiredCleared(() => setMsg(null));
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [gameId, serverNow]);
  if (!msg) return null;
  return (
    <div role="status" className="notice error expired-notice">
      <span>{msg}</span>
      <button type="button" className="secondary" onClick={() => { consumeExpired(gameId); setMsg(null); }}>
        Fermer
      </button>
    </div>
  );
}

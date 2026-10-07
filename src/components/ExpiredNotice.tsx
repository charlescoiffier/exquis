"use client";
import { useEffect, useState } from "react";
import { EXPIRED_MESSAGE, clearExpired, expiredTurnKey } from "@/lib/expired-notice";

/** Affiché quand le joueur n'a plus de tour actif : rappelle que son tour expiré a été remis en jeu. */
export function ExpiredNotice({ gameId }: { gameId: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    setShow(expiredTurnKey(gameId) !== null);
  }, [gameId]);
  if (!show) return null;
  return (
    <p role="status" className="error">
      {EXPIRED_MESSAGE}{" "}
      <button
        type="button"
        className="secondary"
        onClick={() => {
          clearExpired(gameId);
          setShow(false);
        }}
      >
        Fermer
      </button>
    </p>
  );
}

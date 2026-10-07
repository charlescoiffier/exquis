"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { EXPIRED_MESSAGE, clearExpired, expiredTurnKey, markExpired } from "@/lib/expired-notice";
import { clockOffset, turnPhase } from "@/lib/turn-timing";
import { Countdown } from "./Countdown";
import { DrawingEditor } from "./DrawingEditor";
import { TextTurn } from "./TextTurn";

export type SerializedTurn = {
  rank: number;
  total: number;
  deadline: string;
  /** Heure du serveur au rendu : sert à corriger le décalage d'horloge du client. */
  serverNow?: string;
  stripUrl?: string;
  excerpt?: string;
  draft: unknown;
  game: { type: "drawing" | "text"; direction: "down" | "right" | null; minWords: number | null; maxWords: number | null; excerptMode: "paragraph" | "words" | null; excerptWords: number | null };
};

export function TurnEditor({ gameId, turn }: { gameId: string; turn: SerializedTurn }) {
  const router = useRouter();
  const turnKey = `${gameId}:${turn.deadline}:${turn.rank}`;
  const deadlineMs = Date.parse(turn.deadline);
  const [offset] = useState(() => clockOffset(turn.serverNow, Date.now()));
  const [lost, setLost] = useState(() => expiredTurnKey(gameId) === turnKey);
  const [now, setNow] = useState(() => Date.now() + offset);

  useEffect(() => {
    if (expiredTurnKey(gameId) !== turnKey) clearExpired(gameId);
  }, [gameId, turnKey]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + offset), 250);
    return () => clearInterval(id);
  }, [offset]);

  const { phase, msToExpiry } = turnPhase(deadlineMs, now);

  // Tour perdu (fin de la fenêtre, abandon, ou envoi refusé) : l'éditeur est démonté (état local vidé), la page rechargée.
  const lose = useCallback(() => {
    markExpired(gameId, turnKey);
    setLost(true);
    router.refresh();
  }, [gameId, turnKey, router]);

  useEffect(() => {
    if (phase === "expired" && !lost) lose();
  }, [phase, lost, lose]);

  if (lost || phase === "expired") {
    return (
      <section>
        <h2>Tour {turn.rank} sur {turn.total}</h2>
        <p role="status" className="error">{EXPIRED_MESSAGE}</p>
      </section>
    );
  }

  const validationMsLeft = phase === "validation" ? msToExpiry : null;
  return (
    <section>
      <h2>Tour {turn.rank} sur {turn.total}</h2>
      <Countdown deadline={turn.deadline} offsetMs={offset} />
      {turn.game.type === "text" ? (
        <TextTurn gameId={gameId} excerpt={turn.excerpt} draft={turn.draft as { text?: string } | null} minWords={turn.game.minWords!} maxWords={turn.game.maxWords!} rule={turn.game.excerptMode === "words" ? { mode: "words", count: turn.game.excerptWords ?? 1 } : { mode: "paragraph" }} validationMsLeft={validationMsLeft} onLost={lose} />
      ) : (
        <DrawingEditor gameId={gameId} direction={turn.game.direction!} rank={turn.rank} total={turn.total} stripUrl={turn.stripUrl} draft={turn.draft} validationMsLeft={validationMsLeft} onLost={lose} />
      )}
    </section>
  );
}

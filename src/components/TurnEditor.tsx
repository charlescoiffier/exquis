"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ABANDONED_MESSAGE, EXPIRED_MESSAGE, clearExpired, editorMarkerAction, markExpired, readMarker, turnKeyOf } from "@/lib/expired-notice";
import { CLIENT_GRACE_MS, nextClock, turnPhase, type ClockState, type TurnPhase } from "@/lib/turn-timing";
import { Countdown } from "./Countdown";
import { DrawingEditor } from "./DrawingEditor";
import { EDITOR_ROOT_ID } from "./ExpiryDialog";
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

/** État d'envoi partagé avec les éditeurs : le tour n'est jamais déclaré perdu pendant un envoi en cours. */
export type SubmitState = { busy: boolean; done: boolean };
export type LostKind = "abandoned" | "expired";
export type Expiry = { active: boolean; expiresAtMs: number; getNow: () => number };

export function TurnEditor({ gameId, turn }: { gameId: string; turn: SerializedTurn }) {
  const router = useRouter();
  const turnKey = turnKeyOf(turn.rank, turn.deadline);
  const deadlineMs = Date.parse(turn.deadline);
  const clock = useRef<ClockState>({ offset: 0, serverNowMs: -Infinity });
  const getNow = useCallback(() => Date.now() + clock.current.offset, []);
  const submitState = useRef<SubmitState>({ busy: false, done: false });
  const pendingMarked = useRef(false);
  // Rien n'est lu (horloge, stockage) avant le montage : le premier rendu est identique côté serveur et client.
  const [ready, setReady] = useState(false);
  const [lost, setLost] = useState<LostKind | null>(null);
  // Seule la phase (qui change deux fois par tour) est en état : les éditeurs ne sont pas rendus à chaque tick.
  const [phase, setPhase] = useState<TurnPhase>("open");

  // Recalage de l'horloge à chaque rendu serveur (sondage de 5 s) ; une charge périmée est ignorée.
  useEffect(() => {
    clock.current = nextClock(clock.current, turn.serverNow, Date.now());
  }, [turn.serverNow]);

  useEffect(() => {
    const action = editorMarkerAction(readMarker(gameId), turnKey);
    if (action.lost) setLost(action.lost);
    if (action.clear) clearExpired(gameId);
    setPhase(turnPhase(deadlineMs, getNow()).phase);
    setReady(true);
  }, [gameId, turnKey, deadlineMs, getNow]);

  // Tour perdu : l'éditeur est démonté (état local vidé), la page rechargée.
  const lose = useCallback(
    (kind: LostKind) => {
      markExpired(gameId, turnKey, kind);
      setLost(kind);
      router.refresh();
    },
    [gameId, turnKey, router],
  );

  useEffect(() => {
    if (!ready || lost) return;
    const id = setInterval(() => {
      const s = submitState.current;
      if (s.done) return;
      const p = turnPhase(deadlineMs, getNow()).phase;
      setPhase(p);
      // Dès l'échéance, on note que le serveur peut reprendre le tour (message si la page est rafraîchie sans éditeur).
      if (p !== "open" && !pendingMarked.current) {
        pendingMarked.current = true;
        markExpired(gameId, turnKey, "pending");
      }
      // Jamais pendant un envoi : c'est son résultat qui décide.
      if (p === "expired" && !s.busy) lose("expired");
    }, 250);
    return () => clearInterval(id);
  }, [ready, lost, deadlineMs, gameId, turnKey, getNow, lose]);

  const title = <h2>Tour {turn.rank} sur {turn.total}</h2>;
  if (!ready) return <section>{title}</section>;
  if (lost) {
    return (
      <section>
        {title}
        <p role="status" className="error">{lost === "abandoned" ? ABANDONED_MESSAGE : EXPIRED_MESSAGE}</p>
      </section>
    );
  }

  const expiry: Expiry = { active: phase !== "open", expiresAtMs: deadlineMs + CLIENT_GRACE_MS, getNow };
  return (
    <section id={EDITOR_ROOT_ID}>
      {title}
      <Countdown deadline={turn.deadline} getNow={getNow} />
      {turn.game.type === "text" ? (
        <TextTurn gameId={gameId} excerpt={turn.excerpt} draft={turn.draft as { text?: string } | null} minWords={turn.game.minWords!} maxWords={turn.game.maxWords!} rule={turn.game.excerptMode === "words" ? { mode: "words", count: turn.game.excerptWords ?? 1 } : { mode: "paragraph" }} expiry={expiry} submitState={submitState} onLost={lose} />
      ) : (
        <DrawingEditor gameId={gameId} direction={turn.game.direction!} rank={turn.rank} total={turn.total} stripUrl={turn.stripUrl} draft={turn.draft} expiry={expiry} submitState={submitState} onLost={lose} />
      )}
    </section>
  );
}

"use client";
import { Countdown } from "./Countdown";
import { DrawingEditor } from "./DrawingEditor";
import { TextTurn } from "./TextTurn";

export type SerializedTurn = {
  rank: number;
  total: number;
  deadline: string;
  stripUrl?: string;
  excerpt?: string;
  draft: unknown;
  game: { type: "drawing" | "text"; direction: "down" | "right" | null; minWords: number | null; maxWords: number | null; excerptMode: "paragraph" | "words" | null; excerptWords: number | null };
};

export function TurnEditor({ gameId, turn }: { gameId: string; turn: SerializedTurn }) {
  return (
    <section>
      <h2>Tour {turn.rank} sur {turn.total}</h2>
      <Countdown deadline={turn.deadline} />
      {turn.game.type === "text" ? (
        <TextTurn gameId={gameId} excerpt={turn.excerpt} draft={turn.draft as { text?: string } | null} minWords={turn.game.minWords!} maxWords={turn.game.maxWords!} rule={turn.game.excerptMode === "words" ? { mode: "words", count: turn.game.excerptWords ?? 1 } : { mode: "paragraph" }} />
      ) : (
        <DrawingEditor gameId={gameId} direction={turn.game.direction!} rank={turn.rank} total={turn.total} stripUrl={turn.stripUrl} draft={turn.draft} />
      )}
    </section>
  );
}

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AutoRefresh } from "@/components/AutoRefresh";
import { JoinButton } from "@/components/JoinButton";
import { ExpiredNotice } from "@/components/ExpiredNotice";
import { TurnEditor } from "@/components/TurnEditor";
import { TurnTitle } from "@/components/TurnTitle";
import { getDb } from "@/lib/db/client";
import { DomainError } from "@/lib/errors";
import { formatDuration } from "@/lib/format";
import { getGameView } from "@/lib/services/games";
import { getMyTurn } from "@/lib/services/turns";
import { getSession } from "@/lib/session";
import { getStorage } from "@/lib/storage";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function GamePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ token?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await params;
  const { token } = await searchParams;
  const db = getDb();

  let view;
  try {
    view = await getGameView(db, { gameId: id, userId: session.user.id, token });
  } catch (e) {
    if (e instanceof DomainError && e.status === 404) notFound();
    if (e instanceof DomainError && e.status === 403) return <main><h1>Accès refusé</h1><p>Cette partie est sur invitation.</p></main>;
    throw e;
  }
  const { game } = view;

  return (
    <main>
      {game.status !== "completed" && game.status !== "cancelled" && <AutoRefresh />}
      <h1>{game.name}</h1>
      <p className="muted">
        {game.type === "drawing" ? "Dessin" : `Texte (${game.language})`} — {game.turns} tours de {formatDuration(game.turnDurationSeconds)} — statut : {game.status}
      </p>

      {game.status === "open" && (
        <>
          <p>En attente de joueurs : {view.participantCount}/{game.turns}</p>
          {!view.isParticipant && <JoinButton gameId={game.id} token={token} />}
          {view.inviteToken && (
            <p>Lien d&apos;invitation : <code>{`${env().APP_URL}/games/${game.id}?token=${view.inviteToken}`}</code></p>
          )}
        </>
      )}

      {game.status === "in_progress" && view.openCall && (
        <p>
          <span role="img" aria-label="Appel à participation">📣</span> Le dernier tour attend un volontaire.{" "}
          {!view.isParticipant && <JoinButton gameId={game.id} token={token} claim />}
        </p>
      )}
      {game.status === "in_progress" && view.isParticipant && (await renderTurn(db, id, session.user.id))}
      {game.status === "completed" && <p><Link href={`/games/${game.id}/final`}>Voir l&apos;œuvre finale</Link></p>}
      {game.status === "cancelled" && (
        <>
          <p>Cette partie a été annulée faute de joueurs actifs.</p>
          {view.isParticipant && <p><Link href={`/games/${game.id}/final`}>Voir ce qui a été réalisé</Link></p>}
        </>
      )}
    </main>
  );
}

async function renderTurn(db: ReturnType<typeof getDb>, gameId: string, userId: string) {
  const turn = await getMyTurn(db, getStorage(), { userId, gameId });
  if (!turn) return <><ExpiredNotice gameId={gameId} /><p>En attente des autres joueurs. Vous serez prévenu(e) quand ce sera votre tour.</p></>;
  // La clé garde l'état de l'éditeur lors d'un rafraîchissement tant que le tour (et son échéance) ne change pas.
  return (
    <>
      <TurnTitle myTurn />
      <TurnEditor
        key={`${turn.turnId}-${turn.deadline.toISOString()}`}
        gameId={gameId}
      turn={{
        rank: turn.rank,
        total: turn.total,
        deadline: turn.deadline.toISOString(),
        serverNow: new Date().toISOString(),
        stripUrl: turn.stripUrl,
        excerpt: turn.excerpt,
        draft: turn.draft,
        game: { type: turn.game.type, direction: turn.game.direction, minWords: turn.game.minWords, maxWords: turn.game.maxWords, excerptMode: turn.game.excerptMode as "paragraph" | "words" | null, excerptWords: turn.game.excerptWords },
      }}
      />
    </>
  );
}

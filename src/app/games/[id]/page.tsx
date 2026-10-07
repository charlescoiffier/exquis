import { notFound, redirect } from "next/navigation";
import { AutoRefresh } from "@/components/AutoRefresh";
import { JoinButton } from "@/components/JoinButton";
import { ExpiredNotice } from "@/components/ExpiredNotice";
import { TurnEditor } from "@/components/TurnEditor";
import { Banner } from "@/components/ui/Banner";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TurnTitle } from "@/components/TurnTitle";
import { getDb } from "@/lib/db/client";
import { DomainError } from "@/lib/errors";
import { formatDuration, statusLabel } from "@/lib/format";
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

  const typeText = game.type === "drawing" ? "Dessin" : `Texte (${game.language})`;
  return (
    <main>
      {game.status !== "completed" && game.status !== "cancelled" && <AutoRefresh />}
      <Banner title={game.name} />
      <p className="game-meta">
        <span className={`pill status status-${game.status}`}>{statusLabel(game.status)}</span>
        <span className="meta">{typeText} · {game.turns} tours de {formatDuration(game.turnDurationSeconds)}</span>
      </p>

      {game.status === "open" && (
        <Card>
          <h2 className="card-title">En attente de joueurs</h2>
          <p className="count-line">
            <span className="count-num" aria-hidden="true">{view.participantCount}/{game.turns}</span>
            <span className="count-label">joueurs inscrits</span>
            <span className="sr-only"> : {view.participantCount} sur {game.turns}</span>
          </p>
          {!view.isParticipant && <JoinButton gameId={game.id} token={token} />}
          {view.inviteToken && (
            <div className="invite">
              <p className="hint">Lien d&apos;invitation</p>
              <code className="invite-link">{`${env().APP_URL}/games/${game.id}?token=${view.inviteToken}`}</code>
            </div>
          )}
        </Card>
      )}

      {game.status === "in_progress" && view.openCall && (
        <Card call>
          <span className="pill call">Appel à participation</span>
          <p className="call-text">
            <span role="img" aria-label="Appel à participation">📣</span> Le dernier tour attend un volontaire.
          </p>
          {!view.isParticipant && <JoinButton gameId={game.id} token={token} claim />}
        </Card>
      )}
      {game.status === "in_progress" && view.isParticipant && (await renderTurn(db, id, session.user.id))}
      {game.status === "completed" && (
        <Card>
          <h2 className="card-title">Partie terminée</h2>
          <ButtonLink href={`/games/${game.id}/final`}>Voir l&apos;œuvre finale</ButtonLink>
        </Card>
      )}
      {game.status === "cancelled" && (
        <Card>
          <h2 className="card-title">Partie annulée</h2>
          <p>Cette partie a été annulée faute de joueurs actifs.</p>
          {view.isParticipant && <ButtonLink href={`/games/${game.id}/final`} variant="secondary">Voir ce qui a été réalisé</ButtonLink>}
        </Card>
      )}
    </main>
  );
}

async function renderTurn(db: ReturnType<typeof getDb>, gameId: string, userId: string) {
  const turn = await getMyTurn(db, getStorage(), { userId, gameId });
  if (!turn) {
    return (
      <>
        <ExpiredNotice gameId={gameId} serverNow={new Date().toISOString()} />
        <Card>
          <h2 className="card-title">En attente des autres joueurs</h2>
          <p>Vous serez prévenu(e) quand ce sera votre tour.</p>
        </Card>
      </>
    );
  }
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

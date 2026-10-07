import { notFound, redirect } from "next/navigation";
import { AutoRefresh } from "@/components/AutoRefresh";
import { InviteFriends } from "@/components/FriendsPanels";
import { JoinButton } from "@/components/JoinButton";
import { ExpiredNotice } from "@/components/ExpiredNotice";
import { TurnEditor } from "@/components/TurnEditor";
import { Banner } from "@/components/ui/Banner";
import { Icon } from "@/components/ui/Icon";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TurnTitle } from "@/components/TurnTitle";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { game } from "@/lib/db/schema";
import { DomainError } from "@/lib/errors";
import { Countdown } from "@/components/Countdown";
import { GameTag } from "@/components/GameTag";
import { GameMetaItems } from "@/components/GameMeta";
import { turnLabelOf } from "@/lib/format";
import { listInvitableFriends } from "@/lib/services/game-invites";
import { getGameView } from "@/lib/services/games";
import { getActiveTurnInfo, getMyTurn } from "@/lib/services/turns";
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
    if (e instanceof DomainError && e.status === 403) return (
        <main>
          <Banner title="Accès refusé" />
          <Card><p role="alert" style={{ margin: 0 }}>Cette partie est sur invitation.</p></Card>
        </main>
      );
    throw e;
  }
  const { game } = view;

  // Une partie terminée mène directement à son œuvre.
  if (game.status === "completed" && view.isParticipant) redirect(`/games/${game.id}/final`);
  const labels = (game.turnLabels ?? []).filter((l) => l.trim() !== "");
  const invitable = game.status === "open" && view.isParticipant ? await listInvitableFriends(db, { userId: session.user.id, gameId: game.id }) : [];
  return (
    <main>
      {game.status !== "completed" && game.status !== "cancelled" && <AutoRefresh />}
      <Banner
        title={game.name}
        theme={game.theme}
        meta={<GameMetaItems type={game.type} turns={game.turns} turnDurationSeconds={game.turnDurationSeconds} language={game.language} creatorName={view.creatorName} />}
        action={<GameTag kind={game.status === "in_progress" ? (view.openCall ? "call" : "in_progress") : game.status === "open" ? "open" : game.status === "completed" ? "completed" : "cancelled"} />}
      />
      {labels.length > 0 && (
        <p className="meta game-labels">Intitulés des tours : {(game.turnLabels ?? []).map((l, i) => l.trim() || `Tour ${i + 1}`).join(" → ")}</p>
      )}

      {game.status === "open" && (
        <Card>
          <h2 className="card-title">En attente de joueurs</h2>
          <p className="count-line">
            <span className="count-num" aria-hidden="true">{view.participantCount}/{game.turns}</span>
            <span className="count-label">joueurs inscrits</span>
            <span className="sr-only"> : {view.participantCount} sur {game.turns}</span>
          </p>
          {!view.isParticipant && <JoinButton gameId={game.id} token={token} />}
          {invitable.length > 0 && (
            <div className="invite">
              <p className="hint">Inviter des amis</p>
              <InviteFriends gameId={game.id} friends={invitable} />
            </div>
          )}
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
            <Icon name="speaker" label="Appel à participation" /> Un tour attend un volontaire.
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
  let turn;
  try {
    turn = await getMyTurn(db, getStorage(), { userId, gameId });
  } catch (e) {
    // Lecture non critique : une panne passagère (base, stockage) lors d'un rafraîchissement ne doit pas faire tomber la page.
    if (e instanceof DomainError) throw e;
    console.error("getMyTurn a échoué", e);
    return (
      <Card>
        <h2 className="card-title">En attente…</h2>
        <p>Votre tour n&apos;a pas pu être chargé pour le moment ; la page se mettra à jour automatiquement.</p>
      </Card>
    );
  }
  if (!turn) {
    const active = await getActiveTurnInfo(db, gameId).catch(() => null);
    const [g] = await db.select({ type: game.type, turns: game.turns }).from(game).where(eq(game.id, gameId));
    const who = g && active ? `${g.type === "drawing" ? "Dessinateur" : "Écrivain"} ${active.rank}` : null;
    return (
      <>
        <ExpiredNotice gameId={gameId} serverNow={new Date().toISOString()} />
        <Card>
          <h2 className="card-title">En attente des autres joueurs</h2>
          {who && active && g && (
            <div className="waiting-turn">
              <p>
                <strong>{who}</strong> {g.type === "drawing" ? "est en train de dessiner" : "est en train d'écrire"} (tour {active.rank} sur {g.turns}).
              </p>
              <Countdown deadline={active.deadline.toISOString()} inline />
            </div>
          )}
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
        theme: turn.game.theme,
        label: turnLabelOf(turn.game.turnLabels, turn.rank),
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

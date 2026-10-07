import Link from "next/link";
import { redirect } from "next/navigation";
import { AutoRefresh } from "@/components/AutoRefresh";
import { JoinButton } from "@/components/JoinButton";
import { TurnTitle } from "@/components/TurnTitle";
import { Banner } from "@/components/ui/Banner";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { getDb } from "@/lib/db/client";
import { formatDuration, statusLabel } from "@/lib/format";
import { listMyGames, listOpenCalls, listOpenGames } from "@/lib/services/games";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const typeLabel = (t: string) => (t === "drawing" ? "Dessin" : "Texte");

export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login");
  const db = getDb();
  const [open, openCalls, mine] = await Promise.all([listOpenGames(db), listOpenCalls(db), listMyGames(db, session.user.id)]);
  const mineIds = new Set(mine.map((g) => g.id));

  return (
    <main>
      <AutoRefresh />
      <TurnTitle myTurn={mine.some((g) => g.isMyTurn)} />
      <Banner title="Exquis" />

      <section aria-labelledby="mes-parties">
        <h2 id="mes-parties">Mes parties</h2>
        {mine.length === 0 ? (
          <Card>
            <p>Aucune partie pour l&apos;instant : rejoignez une partie ouverte ci-dessous ou lancez la vôtre.</p>
            <ButtonLink href="/games/new">Créer une partie</ButtonLink>
          </Card>
        ) : (
          <ul className="cards">
            {mine.map((g) => (
              <li key={g.id}>
                <Card className="game-card">
                  <div className="game-main">
                    <Link href={`/games/${g.id}`} className="game-title">{g.name}</Link>
                    <div className="meta">{typeLabel(g.type)} · {statusLabel(g.status)}</div>
                  </div>
                  {g.isMyTurn && <span className="pill turn">À vous de jouer !</span>}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {openCalls.length > 0 && (
        <section aria-labelledby="appels">
          <h2 id="appels"><span role="img" aria-label="Appel à participation">📣</span> Appels à participation</h2>
          <p className="muted">Ces parties attendent un volontaire pour leur dernier tour.</p>
          <ul className="cards">
            {openCalls.map((g) => (
              <li key={g.id}>
                <Card call className="game-card">
                  <div className="game-main">
                    <span className="pill call">Appel à participation</span>
                    <div className="game-title">{g.name}</div>
                    <div className="meta">
                      {typeLabel(g.type)} · tour à jouer {g.rank}/{g.turns} · {formatDuration(g.turnDurationSeconds)}{g.type === "text" ? ` · ${g.language}` : ""}
                    </div>
                  </div>
                  <div className="game-side">
                    {mineIds.has(g.id) ? <Link href={`/games/${g.id}`}>Ouvrir</Link> : <JoinButton gameId={g.id} claim />}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="ouvertes">
        <div className="section-head">
          <h2 id="ouvertes">Parties ouvertes</h2>
          <ButtonLink href="/games/new" variant="secondary">Créer une partie</ButtonLink>
        </div>
        {open.length === 0 ? (
          <Card>
            <p>Aucune partie ouverte pour l&apos;instant : lancez-en une et invitez vos amis.</p>
            <ButtonLink href="/games/new">Créer une partie</ButtonLink>
          </Card>
        ) : (
          <ul className="cards">
            {open.map((g) => (
              <li key={g.id}>
                <Card className="game-card">
                  <div className="game-main">
                    <div className="game-title">{g.name}</div>
                    <div className="meta">
                      {typeLabel(g.type)} · {g.turns} tours · {formatDuration(g.turnDurationSeconds)}{g.type === "text" ? ` · ${g.language}` : ""}
                    </div>
                    <div className="game-action">
                      {mineIds.has(g.id) ? <Link href={`/games/${g.id}`}>Ouvrir</Link> : <JoinButton gameId={g.id} />}
                    </div>
                  </div>
                  <div className="game-count" aria-label={`${g.participantCount} inscrits sur ${g.turns}`}>
                    <span className="count-num">{g.participantCount}/{g.turns}</span>
                    <span className="count-label">inscrits</span>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

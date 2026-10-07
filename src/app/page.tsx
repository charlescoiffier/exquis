import Link from "next/link";
import { redirect } from "next/navigation";
import { AutoRefresh } from "@/components/AutoRefresh";
import { GameMeta } from "@/components/GameMeta";
import { JoinButton } from "@/components/JoinButton";
import { TurnTitle } from "@/components/TurnTitle";
import { Banner } from "@/components/ui/Banner";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/Pagination";
import { getDb } from "@/lib/db/client";
import { statusLabel } from "@/lib/format";
import { listMyCurrentGameIds, listMyCurrentGames, listOpenCalls, listOpenGames, parsePage } from "@/lib/services/games";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function Home({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const sp = await searchParams;
  const db = getDb();
  const [mine, calls, open] = await Promise.all([
    listMyCurrentGames(db, session.user.id, { page: parsePage(sp.pm) }),
    listOpenCalls(db, { page: parsePage(sp.pa) }),
    listOpenGames(db, { page: parsePage(sp.po) }),
  ]);
  const mineIds = await listMyCurrentGameIds(db, session.user.id);

  return (
    <main>
      <AutoRefresh />
      <TurnTitle myTurn={mine.items.some((g) => g.isMyTurn)} />
      <Banner title="Exquis" />

      <section aria-labelledby="mes-parties">
        <h2 id="mes-parties">Mes parties en cours</h2>
        {mine.total === 0 ? (
          <Card>
            <p style={{ margin: 0 }}>Aucune partie en cours : rejoignez une partie ci-dessous ou lancez la vôtre.</p>
          </Card>
        ) : (
          <>
            <ul className="cards">
              {mine.items.map((g) => (
                <li key={g.id}>
                  <Card className="game-card">
                    <div className="game-main">
                      <Link href={`/games/${g.id}`} className="game-title">{g.name}</Link>
                      <GameMeta type={g.type} turns={g.turns} turnDurationSeconds={g.turnDurationSeconds} language={g.language} creatorName={g.creatorName} extra={[statusLabel(g.status)]} />
                    </div>
                    {g.isMyTurn && <span className="pill turn">À vous de jouer !</span>}
                  </Card>
                </li>
              ))}
            </ul>
            <Pagination page={mine.page} pageCount={mine.pageCount} param="pm" basePath="/" searchParams={sp} label="mes parties en cours" />
          </>
        )}
      </section>

      {calls.total > 0 && (
        <section aria-labelledby="appels">
          <h2 id="appels"><span role="img" aria-label="Appel à participation">📣</span> Appels à participation</h2>
          <p className="muted">Ces parties attendent un volontaire pour leur dernier tour.</p>
          <ul className="cards">
            {calls.items.map((g) => (
              <li key={g.id}>
                <Card call className="game-card">
                  <div className="game-main">
                    <span className="pill call">Appel à participation</span>
                    <div className="game-title">{g.name}</div>
                    <GameMeta type={g.type} turns={g.turns} turnDurationSeconds={g.turnDurationSeconds} language={g.language} creatorName={g.creatorName} extra={[`tour à jouer ${g.rank}/${g.turns}`]} />
                  </div>
                  <div className="game-side">
                    {mineIds.has(g.id) ? <ButtonLink href={`/games/${g.id}`} variant="secondary">Ouvrir</ButtonLink> : <JoinButton gameId={g.id} claim />}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
          <Pagination page={calls.page} pageCount={calls.pageCount} param="pa" basePath="/" searchParams={sp} label="appels à participation" />
        </section>
      )}

      <section aria-labelledby="ouvertes">
        <div className="section-head">
          <h2 id="ouvertes">Parties à rejoindre</h2>
          {open.total > 0 && <ButtonLink href="/games/new" variant="secondary">Créer une partie</ButtonLink>}
        </div>
        {open.total === 0 ? (
          <Card>
            <p>Aucune partie à rejoindre pour l&apos;instant : lancez-en une et invitez vos amis.</p>
            <ButtonLink href="/games/new">Créer une partie</ButtonLink>
          </Card>
        ) : (
          <>
            <ul className="cards">
              {open.items.map((g) => (
                <li key={g.id}>
                  <Card className="game-card">
                    <div className="game-main">
                      <div className="game-title">{g.name}</div>
                      <GameMeta type={g.type} turns={g.turns} turnDurationSeconds={g.turnDurationSeconds} language={g.language} creatorName={g.creatorName} />
                      <div className="game-action">
                        {mineIds.has(g.id) ? <ButtonLink href={`/games/${g.id}`} variant="secondary">Ouvrir</ButtonLink> : <JoinButton gameId={g.id} />}
                      </div>
                    </div>
                    <div className="game-count">
                      <span className="sr-only">{g.participantCount} inscrit{g.participantCount > 1 ? "s" : ""} sur {g.turns}</span>
                      <span className="count-num" aria-hidden="true">{g.participantCount}/{g.turns}</span>
                      <span className="count-label" aria-hidden="true">inscrits</span>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
            <Pagination page={open.page} pageCount={open.pageCount} param="po" basePath="/" searchParams={sp} label="parties à rejoindre" />
          </>
        )}
      </section>
    </main>
  );
}

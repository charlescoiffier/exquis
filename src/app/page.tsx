import { redirect } from "next/navigation";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Countdown } from "@/components/Countdown";
import { GameMeta } from "@/components/GameMeta";
import { GameTag } from "@/components/GameTag";
import { JoinButton } from "@/components/JoinButton";
import { LeaveButton } from "@/components/LeaveButton";
import { TurnTitle } from "@/components/TurnTitle";
import { Banner } from "@/components/ui/Banner";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/Pagination";
import { getDb } from "@/lib/db/client";
import { listJoinableGames, listMyCurrentGames, parsePage } from "@/lib/services/games";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function Home({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const sp = await searchParams;
  const db = getDb();
  const [mine, joinable] = await Promise.all([
    listMyCurrentGames(db, session.user.id, { page: parsePage(sp.pm) }),
    listJoinableGames(db, { userId: session.user.id, page: parsePage(sp.po) }),
  ]);

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
                      <div className="game-head">
                        <div className="game-title">{g.name}</div>
                        <GameTag kind={g.status === "open" ? "open" : "in_progress"} />
                      </div>
                      <GameMeta type={g.type} turns={g.turns} turnDurationSeconds={g.turnDurationSeconds} language={g.language} creatorName={g.creatorName} />
                    </div>
                    <div className="game-side">
                      {g.isMyTurn ? (
                        <>
                          <ButtonLink href={`/games/${g.id}`}>À vous de jouer !</ButtonLink>
                          {g.myDeadline && <Countdown deadline={g.myDeadline.toISOString()} inline />}
                        </>
                      ) : (
                        <ButtonLink href={`/games/${g.id}`}>Ouvrir</ButtonLink>
                      )}
                      <LeaveButton gameId={g.id} gameName={g.name} inProgress={g.status === "in_progress"} />
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
            <Pagination page={mine.page} pageCount={mine.pageCount} param="pm" basePath="/" searchParams={sp} label="mes parties en cours" />
          </>
        )}
      </section>

      <section aria-labelledby="ouvertes">
        <div className="section-head">
          <h2 id="ouvertes">Parties à rejoindre</h2>
          <ButtonLink href="/games/new">Créer une partie</ButtonLink>
        </div>
        {joinable.total === 0 ? (
          <Card>
            <p style={{ margin: 0 }}>Aucune partie à rejoindre pour l&apos;instant : lancez-en une et invitez vos amis.</p>
          </Card>
        ) : (
          <>
            <ul className="cards">
              {joinable.items.map((g) => {
                const call = g.openCallRank !== null;
                const extra = call ? [`tour à jouer ${g.openCallRank}/${g.turns}`] : [`${g.participantCount}/${g.turns} inscrits`];
                return (
                  <li key={g.id}>
                    <Card call={call} className="game-card">
                      <div className="game-main">
                        <div className="game-head">
                          <div className="game-title">{g.name}</div>
                          <GameTag kind={call ? "call" : "join"} />
                        </div>
                        <GameMeta type={g.type} turns={g.turns} turnDurationSeconds={g.turnDurationSeconds} language={g.language} creatorName={g.creatorName} extra={extra} />
                      </div>
                      <div className="game-side">
                        <JoinButton gameId={g.id} claim={call} />
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
            <Pagination page={joinable.page} pageCount={joinable.pageCount} param="po" basePath="/" searchParams={sp} label="parties à rejoindre" />
          </>
        )}
      </section>
    </main>
  );
}

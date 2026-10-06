import Link from "next/link";
import { redirect } from "next/navigation";
import { JoinButton } from "@/components/JoinButton";
import { getDb } from "@/lib/db/client";
import { formatDuration } from "@/lib/format";
import { listMyGames, listOpenCalls, listOpenGames } from "@/lib/services/games";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login");
  const db = getDb();
  const [open, openCalls, mine] = await Promise.all([listOpenGames(db), listOpenCalls(db), listMyGames(db, session.user.id)]);
  const mineIds = new Set(mine.map((g) => g.id));

  return (
    <main>
      <h1>Mes parties</h1>
      {mine.length === 0 ? <p className="muted">Aucune partie pour l&apos;instant.</p> : (
        <ul>
          {mine.map((g) => (
            <li key={g.id}>
              <Link href={`/games/${g.id}`}>{g.name}</Link> — {g.status}{g.isMyTurn ? " — à vous de jouer !" : ""}
            </li>
          ))}
        </ul>
      )}

      {openCalls.length > 0 && (
        <section aria-label="Appels à participation">
          <h1><span role="img" aria-label="Appel à participation">📣</span> Appels à participation</h1>
          <p className="muted">Ces parties attendent un volontaire pour leur dernier tour.</p>
          <table>
            <thead>
              <tr><th /><th>Nom</th><th>Type</th><th>Tour à jouer</th><th>Durée</th><th>Langue</th><th /></tr>
            </thead>
            <tbody>
              {openCalls.map((g) => (
                <tr key={g.id} style={{ background: "#fff1f2" }}>
                  <td><span role="img" aria-label="Appel à participation">📣</span></td>
                  <td>{g.name}</td>
                  <td>{g.type === "drawing" ? "Dessin" : "Texte"}</td>
                  <td>{g.rank}/{g.turns}</td>
                  <td>{formatDuration(g.turnDurationSeconds)}</td>
                  <td>{g.type === "text" ? g.language : "—"}</td>
                  <td>{mineIds.has(g.id) ? <Link href={`/games/${g.id}`}>Ouvrir</Link> : <JoinButton gameId={g.id} claim />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <h1>Parties ouvertes</h1>
      <p><Link href="/games/new">Créer une partie</Link></p>
      <table>
        <thead>
          <tr><th>Nom</th><th>Type</th><th>Tours</th><th>Durée / tour</th><th>Langue</th><th>Inscrits</th><th /></tr>
        </thead>
        <tbody>
          {open.map((g) => (
            <tr key={g.id}>
              <td>{g.name}</td>
              <td>{g.type === "drawing" ? "Dessin" : "Texte"}</td>
              <td>{g.turns}</td>
              <td>{formatDuration(g.turnDurationSeconds)}</td>
              <td>{g.type === "text" ? g.language : "—"}</td>
              <td>{g.participantCount}/{g.turns}</td>
              <td>{mineIds.has(g.id) ? <Link href={`/games/${g.id}`}>Ouvrir</Link> : <JoinButton gameId={g.id} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

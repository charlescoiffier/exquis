import { redirect } from "next/navigation";
import { AddFriendForm, FriendCode, PersonAction, PersonLine } from "@/components/FriendsPanels";
import { Banner } from "@/components/ui/Banner";
import { Card } from "@/components/ui/Card";
import { getDb } from "@/lib/db/client";
import { ensureFriendCode, listFriendRequests, listFriends, listMetPlayers } from "@/lib/services/friends";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function FriendsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const db = getDb();
  const [code, friends, requests, met] = await Promise.all([
    ensureFriendCode(db, session.user.id),
    listFriends(db, session.user.id),
    listFriendRequests(db, session.user.id),
    listMetPlayers(db, session.user.id),
  ]);
  const shownCode = `${code.slice(0, 4)}-${code.slice(4)}`;
  return (
    <main>
      <Banner title="Mes amis" />

      <section aria-labelledby="mon-code">
        <h2 id="mon-code">Mon code ami</h2>
        <Card>
          <p style={{ marginTop: 0 }}>Donnez ce code à une personne pour qu&apos;elle puisse vous ajouter en ami.</p>
          <FriendCode code={shownCode} />
        </Card>
      </section>

      <section aria-labelledby="ajouter">
        <h2 id="ajouter">Ajouter un ami</h2>
        <Card>
          <AddFriendForm />
        </Card>
      </section>

      {requests.incoming.length > 0 && (
        <section aria-labelledby="recues">
          <h2 id="recues">Demandes reçues</h2>
          <ul className="cards">
            {requests.incoming.map((r) => (
              <li key={r.requestId}>
                <Card><PersonLine person={r}><PersonAction kind="incoming" userId={r.userId} requestId={r.requestId} name={r.name} /></PersonLine></Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="amis">
        <h2 id="amis">Mes amis{friends.length > 0 ? ` (${friends.length})` : ""}</h2>
        {friends.length === 0 ? (
          <Card><p style={{ margin: 0 }} className="muted">Pas encore d&apos;ami : partagez votre code ou ajoutez un joueur rencontré.</p></Card>
        ) : (
          <ul className="cards">
            {friends.map((f) => (
              <li key={f.userId}>
                <Card><PersonLine person={f}><PersonAction kind="friend" userId={f.userId} name={f.name} /></PersonLine></Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {requests.outgoing.length > 0 && (
        <section aria-labelledby="envoyees">
          <h2 id="envoyees">Demandes envoyées</h2>
          <ul className="cards">
            {requests.outgoing.map((r) => (
              <li key={r.requestId}>
                <Card><PersonLine person={r}><PersonAction kind="outgoing" userId={r.userId} name={r.name} /></PersonLine></Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      {met.length > 0 && (
        <section aria-labelledby="rencontres">
          <h2 id="rencontres">Joueurs rencontrés</h2>
          <p className="muted">Des personnes avec qui vous avez partagé une partie.</p>
          <ul className="cards">
            {met.map((m) => (
              <li key={m.userId}>
                <Card><PersonLine person={m}><PersonAction kind="met" userId={m.userId} name={m.name} /></PersonLine></Card>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

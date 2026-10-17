import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminDelete, RoleSelect } from "@/components/AdminActions";
import { Banner } from "@/components/ui/Banner";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/Pagination";
import { getDb } from "@/lib/db/client";
import { formatDate, plural } from "@/lib/format";
import { listCompletedWorks, listUsers } from "@/lib/services/admin";
import { isAdmin } from "@/lib/services/moderation";
import { parsePage } from "@/lib/services/games";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function AdminPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const db = getDb();
  if (!(await isAdmin(db, session.user.id))) notFound();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const [users, works] = await Promise.all([
    listUsers(db, { adminId: session.user.id, q, page: parsePage(sp.pu) }),
    listCompletedWorks(db, { adminId: session.user.id, page: parsePage(sp.pw) }),
  ]);
  return (
    <main>
      <Banner title="Administration" />
      <p className="turn-actions" style={{ marginTop: 0 }}>
        <ButtonLink href="/moderation" variant="secondary">Signalements à traiter</ButtonLink>
      </p>

      <section aria-labelledby="inscrits">
        <h2 id="inscrits">Inscrits ({users.total})</h2>
        <form method="get" className="field-row" role="search" style={{ marginBottom: 12 }}>
          <input name="q" defaultValue={q} placeholder="Rechercher par nom ou adresse" aria-label="Rechercher un inscrit" />
          <button type="submit" className="secondary">Rechercher</button>
        </form>
        {users.items.length === 0 ? (
          <Card><p style={{ margin: 0 }}>Aucun inscrit ne correspond.</p></Card>
        ) : (
          <ul className="cards">
            {users.items.map((u) => {
              const self = u.id === session.user.id;
              return (
                <li key={u.id}>
                  <Card className="game-card">
                    <div className="game-main">
                      <div className="game-title">{u.name}</div>
                      <p className="meta">{u.email} · inscrit le {formatDate(u.createdAt)} · {u.gamesJoined} {plural(u.gamesJoined, "partie", "parties")}</p>
                    </div>
                    <div className="game-side">
                      {u.role === "admin" || self ? (
                        <span className="pill tag">{u.role === "admin" ? "Administrateur" : "Vous"}</span>
                      ) : (
                        <>
                          <RoleSelect userId={u.id} role={u.role} />
                          <AdminDelete url={`/api/admin/users/${u.id}`} title="Supprimer ce compte ?">
                            <p><strong>{u.name}</strong> ({u.email})</p>
                            <p>Le compte, ses sessions, ses amis et ses notifications seront supprimés. Ses contributions aux œuvres restent, sous le nom « Compte supprimé ». Cette action est définitive.</p>
                          </AdminDelete>
                        </>
                      )}
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
        <Pagination page={users.page} pageCount={users.pageCount} param="pu" basePath="/admin" searchParams={sp} label="inscrits" />
      </section>

      <section aria-labelledby="oeuvres">
        <h2 id="oeuvres">Œuvres terminées ({works.total})</h2>
        {works.items.length === 0 ? (
          <Card><p style={{ margin: 0 }}>Aucune œuvre terminée.</p></Card>
        ) : (
          <ul className="cards">
            {works.items.map((w) => (
              <li key={w.id}>
                <Card className="game-card">
                  <div className="game-main">
                    <Link href={`/admin/works/${w.id}`} className="game-title">{w.name}</Link>
                    <p className="meta">
                      {w.type === "drawing" ? "Dessin" : "Texte"} · par {w.creatorName}{w.completedAt ? ` · terminée le ${formatDate(w.completedAt)}` : ""} · {w.comments} {plural(w.comments, "commentaire", "commentaires")}{w.hidden ? " · masquée" : ""}
                    </p>
                  </div>
                  <div className="game-side">
                    <ButtonLink href={`/admin/works/${w.id}`} variant="secondary">Ouvrir</ButtonLink>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
        <Pagination page={works.page} pageCount={works.pageCount} param="pw" basePath="/admin" searchParams={sp} label="œuvres terminées" />
      </section>
    </main>
  );
}

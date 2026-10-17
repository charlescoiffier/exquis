import { notFound, redirect } from "next/navigation";
import { AdminDelete } from "@/components/AdminActions";
import { FinalText } from "@/components/FinalText";
import { Avatar } from "@/components/ui/Avatar";
import { Banner } from "@/components/ui/Banner";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { getDb } from "@/lib/db/client";
import { DomainError } from "@/lib/errors";
import { formatDate, formatDateTime, plural } from "@/lib/format";
import { getWorkForAdmin } from "@/lib/services/admin";
import { isAdmin } from "@/lib/services/moderation";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AdminWorkPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const db = getDb();
  if (!(await isAdmin(db, session.user.id))) notFound();
  const { id } = await params;
  let work;
  try {
    work = await getWorkForAdmin(db, { adminId: session.user.id, gameId: id });
  } catch (e) {
    if (e instanceof DomainError && e.status === 404) notFound();
    throw e;
  }
  return (
    <main>
      <Banner title={work.name} theme={work.theme} meta={`${work.type === "drawing" ? "Dessin" : "Texte"} · par ${work.creatorName}${work.completedAt ? ` · terminée le ${formatDate(work.completedAt)}` : ""}${work.hidden ? " · masquée par la modération" : ""}`} />
      <p className="turn-actions" style={{ marginTop: 0 }}>
        <ButtonLink href="/admin" variant="secondary">Retour à l&apos;administration</ButtonLink>
        <AdminDelete url={`/api/admin/works/${work.id}`} title="Supprimer cette œuvre ?" label="Supprimer l'œuvre" redirectTo="/admin">
          <p><strong>{work.name}</strong></p>
          <p>L&apos;œuvre, ses contributions, ses commentaires et ses images seront supprimés pour tous les participants. Cette action est définitive.</p>
        </AdminDelete>
      </p>

      {work.type === "drawing" ? (
        work.ready ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/moderation/works/${work.id}/image`} alt={`Œuvre « ${work.name} »`} className="final-art" style={{ maxWidth: 520, width: "100%", display: "block", background: "#fff" }} />
        ) : (
          <Card><p style={{ margin: 0 }}>Image non disponible.</p></Card>
        )
      ) : (
        <FinalText contributions={work.contributions.map((c) => ({ ...c, author: c.author }))} />
      )}

      <section aria-labelledby="commentaires" className="final-info">
        <h2 id="commentaires">{work.comments.length} {plural(work.comments.length, "commentaire", "commentaires")}</h2>
        {work.comments.length === 0 ? (
          <Card><p style={{ margin: 0 }} className="muted">Aucun commentaire.</p></Card>
        ) : (
          <ul className="cards comments">
            {work.comments.map((c) => (
              <li key={c.id}>
                <Card className="comment">
                  <div className="comment-head">
                    <Avatar avatar={c.avatar} size={28} />
                    <strong>{c.author}</strong>
                    <span className="muted">{formatDateTime(c.createdAt)}{c.hidden ? " · masqué" : ""}</span>
                    <AdminDelete url={`/api/admin/comments/${c.id}`} title="Supprimer ce commentaire ?" small>
                      <p>« {c.body.slice(0, 160)}{c.body.length > 160 ? "…" : ""} »</p>
                      <p>Le commentaire sera supprimé définitivement.</p>
                    </AdminDelete>
                  </div>
                  <p className="comment-body">{c.body}</p>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

import { notFound, redirect } from "next/navigation";
import { ModerationActions } from "@/components/ModerationActions";
import { Banner } from "@/components/ui/Banner";
import { Card } from "@/components/ui/Card";
import { getDb } from "@/lib/db/client";
import { formatDateTime } from "@/lib/format";
import { reasonLabel } from "@/lib/report-reasons";
import { isModerator, listOpenReports } from "@/lib/services/moderation";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ModerationPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const db = getDb();
  if (!(await isModerator(db, session.user.id))) notFound();
  const reports = await listOpenReports(db);
  return (
    <main>
      <Banner title="Modération" />
      <section aria-labelledby="a-traiter">
        <h2 id="a-traiter">Signalements à traiter{reports.length > 0 ? ` (${reports.length})` : ""}</h2>
        {reports.length === 0 ? (
          <Card><p style={{ margin: 0 }}>Aucun signalement en attente.</p></Card>
        ) : (
          <ul className="cards">
            {reports.map((r) => (
              <li key={r.id}>
                <Card>
                  <p className="meta" style={{ marginTop: 0 }}>
                    {r.targetType === "comment" ? "Commentaire" : "Œuvre"} · « {r.gameName} » · par {r.authorName} · signalé par {r.reporterName} le {formatDateTime(r.createdAt)}
                  </p>
                  <p style={{ margin: "0 0 6px" }}><strong>{reasonLabel(r.reason)}</strong>{r.details ? ` — ${r.details}` : ""}</p>
                  {r.excerpt && <p className="mod-excerpt">{r.excerpt}</p>}
                  {r.isDrawing && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/moderation/works/${r.gameId}/image`} alt={`Œuvre « ${r.gameName} »`} style={{ maxWidth: 320, width: "100%", border: "2px solid var(--line)", background: "#fff", marginBottom: 8 }} />
                  )}
                  <ModerationActions reportId={r.id} targetType={r.targetType} />
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

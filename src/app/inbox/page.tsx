import Link from "next/link";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { Banner } from "@/components/ui/Banner";
import { Card } from "@/components/ui/Card";
import { AutoRefresh } from "@/components/AutoRefresh";
import { InboxActions } from "@/components/InboxActions";
import { InviteButton } from "@/components/InviteButton";
import { getDb } from "@/lib/db/client";
import { profile } from "@/lib/db/schema";
import { NOTIFICATION_LABELS } from "@/lib/notifications/render";
import { listNotifications, type NotificationType } from "@/lib/services/notifications";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const db = getDb();
  const [items, [p]] = await Promise.all([
    listNotifications(db, session.user.id),
    db.select().from(profile).where(eq(profile.userId, session.user.id)),
  ]);
  return (
    <main>
      <AutoRefresh />
      <Banner title="Notifications" />
      <Card>
        <InboxActions emailEnabled={p?.emailEnabled ?? true} />
      </Card>
      <section aria-labelledby="inviter">
        <h2 id="inviter">Inviter des amis</h2>
        <Card>
          <InviteButton />
        </Card>
      </section>
      <section aria-labelledby="avis">
        <h2 id="avis">Avis récents</h2>
        {items.length === 0 ? (
          <Card>
            <p style={{ margin: 0 }}>Rien pour l&apos;instant.</p>
            <p className="hint">Vous serez prévenu(e) ici quand ce sera votre tour ou qu&apos;une œuvre sera prête.</p>
          </Card>
        ) : (
          <ul className="cards">
            {items.map((n) => (
              <li key={n.id}>
                <Card className={`notif${n.readAt ? "" : " notif-unread"}`}>
                  <Link href={`/games/${n.gameId}`} className="notif-link">
                    {!n.readAt && <span className="sr-only">Non lue : </span>}
                    {NOTIFICATION_LABELS[n.type as NotificationType] ?? n.type} — {n.gameName}
                  </Link>
                  <div className="meta">{n.createdAt.toLocaleString("fr-FR")}</div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

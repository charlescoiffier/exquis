import Link from "next/link";
import { redirect } from "next/navigation";
import { Banner } from "@/components/ui/Banner";
import { Card } from "@/components/ui/Card";
import { AutoRefresh } from "@/components/AutoRefresh";
import { InboxActions } from "@/components/InboxActions";
import { getDb } from "@/lib/db/client";
import { NOTIFICATION_LABELS } from "@/lib/notifications/render";
import { listNotifications, type NotificationType } from "@/lib/services/notifications";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const db = getDb();
  const items = await listNotifications(db, session.user.id);
  return (
    <main>
      <AutoRefresh />
      <Banner title="Notifications" />
      <Card>
        <InboxActions />
        <p className="hint">Les préférences d&apos;email se règlent dans <Link href="/account">votre compte</Link>.</p>
      </Card>
      <section aria-labelledby="avis">
        <h2 id="avis">Notifications récentes</h2>
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

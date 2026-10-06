import Link from "next/link";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { InboxActions } from "@/components/InboxActions";
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
      <h1>Notifications</h1>
      <InboxActions emailEnabled={p?.emailEnabled ?? true} />
      {items.length === 0 ? <p className="muted">Rien pour l&apos;instant.</p> : (
        <ul>
          {items.map((n) => (
            <li key={n.id} style={{ fontWeight: n.readAt ? 400 : 700 }}>
              <Link href={`/games/${n.gameId}`}>{NOTIFICATION_LABELS[n.type as NotificationType]} — {n.gameName}</Link>
              <span className="muted"> · {n.createdAt.toLocaleString("fr-FR")}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

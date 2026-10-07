import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { EmailPreference, NameForm } from "@/components/AccountForms";
import { PastGameList } from "@/components/GameList";
import { InviteButton } from "@/components/InviteButton";
import { SignOutButton } from "@/components/SignOutButton";
import { Banner } from "@/components/ui/Banner";
import { Card } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/Pagination";
import { getDb } from "@/lib/db/client";
import { profile } from "@/lib/db/schema";
import { listMyPastGames, parsePage } from "@/lib/services/games";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function AccountPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const sp = await searchParams;
  const db = getDb();
  const [past, [p]] = await Promise.all([
    listMyPastGames(db, session.user.id, { page: parsePage(sp.pp) }),
    db.select().from(profile).where(eq(profile.userId, session.user.id)),
  ]);
  return (
    <main>
      <Banner title="Mon compte" />

      <section aria-labelledby="profil">
        <h2 id="profil">Profil</h2>
        <Card>
          <p className="meta" style={{ marginTop: 0 }}>{session.user.email}</p>
          <NameForm initialName={session.user.name} />
        </Card>
      </section>

      <section aria-labelledby="preferences">
        <h2 id="preferences">Préférences</h2>
        <Card>
          <EmailPreference initial={p?.emailEnabled ?? true} />
        </Card>
      </section>

      <section aria-labelledby="inviter">
        <h2 id="inviter">Inviter des amis</h2>
        <Card>
          <InviteButton />
        </Card>
      </section>

      <section aria-labelledby="anciennes">
        <h2 id="anciennes">Mes anciennes parties</h2>
        {past.total === 0 ? (
          <Card>
            <p style={{ margin: 0 }}>Aucune partie terminée pour l&apos;instant.</p>
            <p className="hint">Vos parties terminées ou annulées apparaîtront ici ; un clic ouvre l&apos;œuvre.</p>
          </Card>
        ) : (
          <>
            <PastGameList games={past.items} />
            <Pagination page={past.page} pageCount={past.pageCount} param="pp" basePath="/account" searchParams={sp} label="anciennes parties" />
          </>
        )}
      </section>

      <section aria-labelledby="session">
        <h2 id="session">Session</h2>
        <Card>
          <SignOutButton />
        </Card>
      </section>
    </main>
  );
}

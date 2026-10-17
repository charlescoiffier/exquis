import { redirect } from "next/navigation";
import { AvatarForm, NameForm, NotificationPreference, ReminderPreference } from "@/components/AccountForms";
import { PastGameList } from "@/components/GameList";
import { SignOutButton } from "@/components/SignOutButton";
import { Banner } from "@/components/ui/Banner";
import { Card } from "@/components/ui/Card";
import { ButtonLink } from "@/components/ui/Button";
import { countOpenReports, isAdmin, isModerator } from "@/lib/services/moderation";
import { Pagination } from "@/components/ui/Pagination";
import { getDb } from "@/lib/db/client";
import { env, pushConfigured } from "@/lib/env";
import { plural } from "@/lib/format";
import { getProfile, getProfileStats } from "@/lib/services/account";
import { listMyPastGames, parsePage } from "@/lib/services/games";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function AccountPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const sp = await searchParams;
  const db = getDb();
  const [past, p, stats, moderator, admin] = await Promise.all([
    listMyPastGames(db, session.user.id, { page: parsePage(sp.pp) }),
    getProfile(db, session.user.id),
    getProfileStats(db, session.user.id),
    isModerator(db, session.user.id),
    isAdmin(db, session.user.id),
  ]);
  const openReports = moderator ? await countOpenReports(db) : 0;
  return (
    <main>
      <Banner title="Mon compte" />

      <section aria-labelledby="profil">
        <h2 id="profil">Profil</h2>
        <Card>
          <p className="meta" style={{ marginTop: 0 }}>{session.user.email}</p>
          <NameForm initialName={session.user.name} />
        </Card>
        <h3>Avatar</h3>
        <Card>
          <AvatarForm initial={p.avatar} />
        </Card>
        <h3>Statistiques</h3>
        <Card>
          <dl className="stats">
            <div><dt>{plural(stats.gamesJoined, "Partie jouée", "Parties jouées")}</dt><dd>{stats.gamesJoined}</dd></div>
            <div><dt>{plural(stats.gamesCompleted, "Terminée", "Terminées")}</dt><dd>{stats.gamesCompleted}</dd></div>
            <div><dt>En cours</dt><dd>{stats.gamesInProgress}</dd></div>
            <div><dt>{plural(stats.gamesCreated, "Créée", "Créées")}</dt><dd>{stats.gamesCreated}</dd></div>
            <div><dt>{plural(stats.turnsPlayed, "Tour joué", "Tours joués")}</dt><dd>{stats.turnsPlayed}</dd></div>
            <div><dt>{plural(stats.drawings, "Dessin", "Dessins")}</dt><dd>{stats.drawings}</dd></div>
            <div><dt>{plural(stats.texts, "Texte", "Textes")}</dt><dd>{stats.texts}</dd></div>
            <div><dt>{plural(stats.commentsWritten, "Commentaire", "Commentaires")}</dt><dd>{stats.commentsWritten}</dd></div>
          </dl>
        </Card>
      </section>

      <section aria-labelledby="preferences">
        <h2 id="preferences">Préférences</h2>
        <Card>
          <NotificationPreference initial={p.notifyMode} pushAvailable={pushConfigured()} publicKey={env().VAPID_PUBLIC_KEY ?? ""} />
          <ReminderPreference initial={p.reminderStage} />
        </Card>
      </section>

      <section aria-labelledby="amis">
        <h2 id="amis">Amis</h2>
        <Card>
          <p style={{ marginTop: 0 }}>Ajoutez des amis avec leur code, puis invitez-les directement à vos parties.</p>
          <ButtonLink href="/friends" variant="secondary">Mes amis</ButtonLink>
        </Card>
      </section>

      {moderator && (
        <section aria-labelledby="moderation">
          <h2 id="moderation">{admin ? "Administration" : "Modération"}</h2>
          <Card>
            <p style={{ marginTop: 0 }}>{openReports > 0 ? `${openReports} ${plural(openReports, "signalement", "signalements")} à traiter.` : "Aucun signalement à traiter."}</p>
            <p className="turn-actions" style={{ margin: 0 }}>
              <ButtonLink href="/moderation" variant="secondary">Ouvrir la modération</ButtonLink>
              {admin && <ButtonLink href="/admin" variant="secondary">Administration : inscrits et œuvres</ButtonLink>}
            </p>
          </Card>
        </section>
      )}

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

import { redirect } from "next/navigation";
import { AutoRefresh } from "@/components/AutoRefresh";
import { FinalText } from "@/components/FinalText";
import { Banner } from "@/components/ui/Banner";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FinalViewer } from "@/components/FinalViewer";
import { getDb } from "@/lib/db/client";
import { DomainError } from "@/lib/errors";
import { formatDate, formatDuration, languageLabel, participantsLabel } from "@/lib/format";
import { getFinal } from "@/lib/services/final-work";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function FinalPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await params;
  let view;
  try {
    view = await getFinal(getDb(), { userId: session.user.id, gameId: id });
  } catch (e) {
    if (e instanceof DomainError) {
      return (
        <main>
          <Banner title="Œuvre indisponible" />
          <Card><p role="alert" className="error">{e.message}</p><ButtonLink href={`/games/${id}`} variant="secondary">Retour à la partie</ButtonLink></Card>
        </main>
      );
    }
    throw e;
  }
  const assembling = view.type === "drawing" && !view.ready;
  return (
    <main>
      {assembling && <AutoRefresh />}
      <Banner title={view.cancelled ? "Œuvre inachevée" : "Œuvre finale"} />
      <h2 className="final-name">{view.name}</h2>
      {view.cancelled && <p role="status" className="notice">Partie annulée : voici ce qui avait été {view.type === "drawing" ? "dessiné" : "écrit"}.</p>}
      {view.contributions.length === 0 && (view.type === "text" || view.ready) ? (
        <Card><p style={{ margin: 0 }}>Aucune contribution n&apos;a été enregistrée.</p></Card>
      ) : view.type === "drawing" ? (
        view.ready ? <FinalViewer gameId={id} direction={view.direction!} width={view.width!} height={view.height!} joints={view.joints} segments={view.segments} /> : (
          <Card><p role="status" style={{ margin: 0 }}>L&apos;œuvre est en cours d&apos;assemblage, revenez dans un instant.</p></Card>
        )
      ) : (
        <FinalText contributions={view.contributions} />
      )}
      <section aria-labelledby="infos" className="final-info">
        <h2 id="infos">À propos de cette partie</h2>
        <Card>
          <dl className="info-list">
            <div><dt>Créée par</dt><dd>{view.info.creatorName}</dd></div>
            {view.info.theme && <div><dt>Thème</dt><dd>{view.info.theme}</dd></div>}
            <div><dt>Commencée le</dt><dd>{formatDate(view.info.createdAt)}</dd></div>
            {view.info.completedAt && <div><dt>Terminée le</dt><dd>{formatDate(view.info.completedAt)}</dd></div>}
            <div><dt>{view.type === "drawing" ? "Dessinateurs" : "Écrivains"}</dt><dd>{view.info.participants.join(", ")}</dd></div>
            <div><dt>Tours</dt><dd>{participantsLabel(view.type, view.info.turns)} · {formatDuration(view.info.turnDurationSeconds)} par tour</dd></div>
            {view.type === "text" && view.info.language && <div><dt>Langue</dt><dd>{languageLabel(view.info.language)}</dd></div>}
          </dl>
        </Card>
      </section>
    </main>
  );
}

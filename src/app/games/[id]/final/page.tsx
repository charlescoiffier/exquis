import { redirect } from "next/navigation";
import { AutoRefresh } from "@/components/AutoRefresh";
import { FinalText } from "@/components/FinalText";
import { Banner } from "@/components/ui/Banner";
import { ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FinalViewer } from "@/components/FinalViewer";
import { getDb } from "@/lib/db/client";
import { DomainError } from "@/lib/errors";
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
      {view.type === "drawing" && (
        <p className="muted final-authors">Auteurs : {view.contributions.map((c) => `${c.rank}. ${c.author}`).join(" · ")}</p>
      )}
    </main>
  );
}

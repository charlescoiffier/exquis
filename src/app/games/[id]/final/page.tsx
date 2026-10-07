import { redirect } from "next/navigation";
import { FinalText } from "@/components/FinalText";
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
    if (e instanceof DomainError) return <main><h1>Œuvre indisponible</h1><p>{e.message}</p></main>;
    throw e;
  }
  return (
    <main>
      <h1>{view.cancelled ? "Œuvre inachevée" : "Œuvre finale"}</h1>
      <h2>{view.name}</h2>
      {view.cancelled && <p role="status" className="muted">Partie annulée : voici ce qui avait été {view.type === "drawing" ? "dessiné" : "écrit"}.</p>}
      {view.contributions.length === 0 && (view.type === "text" || view.ready) ? (
        <p>Aucune contribution n&apos;a été enregistrée.</p>
      ) : view.type === "drawing" ? (
        view.ready ? <FinalViewer gameId={id} direction={view.direction!} width={view.width!} height={view.height!} joints={view.joints} segments={view.segments} /> : <p>L&apos;œuvre est en cours d&apos;assemblage, revenez dans un instant.</p>
      ) : (
        <FinalText contributions={view.contributions} />
      )}
      {view.type === "drawing" && (
        <p className="muted">Auteurs : {view.contributions.map((c) => `${c.rank}. ${c.author}`).join(" · ")}</p>
      )}
    </main>
  );
}

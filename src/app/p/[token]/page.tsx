import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FinalText } from "@/components/FinalText";
import { FinalViewer } from "@/components/FinalViewer";
import { Banner } from "@/components/ui/Banner";
import { Card } from "@/components/ui/Card";
import { ButtonLink } from "@/components/ui/Button";
import { getDb } from "@/lib/db/client";
import { DomainError } from "@/lib/errors";
import { env } from "@/lib/env";
import { formatDate } from "@/lib/format";
import { getPublicFinal } from "@/lib/services/final-work";
import { PUBLIC_TOKEN_PATTERN } from "@/lib/services/sharing";

export const dynamic = "force-dynamic";

async function load(token: string) {
  if (!PUBLIC_TOKEN_PATTERN.test(token)) return null;
  try {
    return await getPublicFinal(getDb(), token);
  } catch (e) {
    if (e instanceof DomainError) return null;
    throw e;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const view = await load(token);
  if (!view) return { title: "Œuvre introuvable" };
  const description = view.info.theme ? `Thème : ${view.info.theme}` : "Une œuvre de cadavre exquis, écrite ou dessinée à tour de rôle.";
  const image = view.type === "drawing" && view.ready ? [`${env().APP_URL}/api/public/${token}/image`] : undefined;
  return { title: `${view.name} — Exquis`, description, openGraph: { title: view.name, description, images: image }, robots: { index: false, follow: false } };
}

/** Œuvre partagée par lien public : lecture seule, sans connexion. */
export default async function PublicWorkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await load(token);
  if (!view) notFound();
  const who = view.type === "drawing" ? "Dessinateurs" : "Écrivains";
  return (
    <main>
      <Banner title={view.name} theme={view.info.theme} />
      {view.type === "drawing" ? (
        view.ready ? (
          <FinalViewer imageSrc={`/api/public/${token}/image`} direction={view.direction!} width={view.width!} height={view.height!} joints={view.joints} segments={view.segments} />
        ) : (
          <Card><p style={{ margin: 0 }}>L&apos;œuvre est en cours d&apos;assemblage, revenez dans un instant.</p></Card>
        )
      ) : (
        <FinalText contributions={view.contributions} />
      )}
      <Card>
        <p style={{ margin: 0 }}>
          <strong>{who} :</strong> {view.info.participants.join(", ")}
          {view.info.completedAt ? ` · terminée le ${formatDate(view.info.completedAt)}` : ""}
        </p>
      </Card>
      <p className="muted">Cette œuvre a été créée sur Exquis, un cadavre exquis en ligne où l&apos;on écrit ou dessine à tour de rôle sans voir ce qui précède.</p>
      <ButtonLink href="/" variant="secondary">Découvrir Exquis</ButtonLink>
    </main>
  );
}

import { ButtonLink } from "@/components/ui/Button";
import { Banner } from "@/components/ui/Banner";
import { Card } from "@/components/ui/Card";

export default function NotFound() {
  return (
    <main className="state-page">
      <Banner title="Page introuvable" />
      <Card>
        <h2 className="card-title">Ce cadavre n&apos;existe pas (ou plus).</h2>
        <p>La page demandée est introuvable. Elle a peut-être été déplacée, ou le lien est incomplet.</p>
        <div className="state-actions">
          <ButtonLink href="/">Retour à l&apos;accueil</ButtonLink>
        </div>
      </Card>
    </main>
  );
}

"use client";
import Link from "next/link";
import { Banner } from "@/components/ui/Banner";
import { Card } from "@/components/ui/Card";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="state-page">
      <Banner title="Une erreur est survenue" />
      <Card>
        <p role="alert">Quelque chose s&apos;est mal passé de notre côté. Vos contributions déjà envoyées ne sont pas perdues.</p>
        <div className="state-actions">
          <button type="button" onClick={() => reset()}>Réessayer</button>
          <Link className="btn secondary" href="/">Retour à l&apos;accueil</Link>
        </div>
      </Card>
    </main>
  );
}

"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { Banner } from "@/components/ui/Banner";
import { Card } from "@/components/ui/Card";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Le message et l'identifiant ne sont jamais affichés : seulement journalisés.
  useEffect(() => {
    console.error("Erreur de rendu", error.digest);
  }, [error]);
  // reset() seul ne rejoue pas le rendu serveur : on rafraîchit d'abord.
  const retry = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });
  return (
    <main className="state-page">
      <Banner title="Une erreur est survenue" />
      <Card>
        <p role="alert">Quelque chose s&apos;est mal passé de notre côté. Vos contributions déjà envoyées ne sont pas perdues.</p>
        <div className="state-actions">
          <button type="button" onClick={retry} disabled={pending}>Réessayer</button>
          <Link className="btn secondary" href="/">Retour à l&apos;accueil</Link>
        </div>
      </Card>
    </main>
  );
}

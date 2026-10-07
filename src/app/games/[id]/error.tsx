"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { Banner } from "@/components/ui/Banner";
import { Card } from "@/components/ui/Card";

/** Frontière propre à la partie : le reste du site (menu, onglets) reste en place. */
export default function GameError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    console.error("Erreur de rendu de la partie", error.digest);
  }, [error]);
  const retry = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });
  return (
    <main>
      <Banner title="Partie indisponible" />
      <Card>
        <p role="alert">Cette page n&apos;a pas pu être affichée pour le moment. Vos contributions déjà envoyées ne sont pas perdues.</p>
        <div className="state-actions">
          <button type="button" onClick={retry} disabled={pending}>Réessayer</button>
          <Link className="btn secondary" href="/">Retour à l&apos;accueil</Link>
        </div>
      </Card>
    </main>
  );
}

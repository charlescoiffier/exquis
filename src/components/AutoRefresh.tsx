"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import { createAutoRefresh } from "@/lib/hooks/auto-refresh";

/** Sondage : relance le rendu serveur de la page toutes les `intervalMs` (en pause onglet masqué). */
export function AutoRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const release = useRef<(() => void) | null>(null);

  // Le rafraîchissement est « en cours » tant que la transition est en attente.
  useEffect(() => {
    if (!isPending && release.current) {
      release.current();
      release.current = null;
    }
  }, [isPending]);

  useEffect(() => {
    const refresh = () =>
      new Promise<void>((resolve) => {
        // Filet de sécurité : ne jamais rester bloqué si la transition ne se règle pas.
        const safety = setTimeout(resolve, 30_000);
        release.current = () => {
          clearTimeout(safety);
          resolve();
        };
        startTransition(() => router.refresh());
      });
    const ar = createAutoRefresh({ intervalMs, refresh, doc: document, win: window, timers: { setInterval: (f, ms) => window.setInterval(f, ms), clearInterval: (id) => window.clearInterval(id as number) } });
    ar.start();
    return () => ar.stop();
  }, [intervalMs, router]);

  return null;
}

"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import { createAutoRefresh } from "@/lib/hooks/auto-refresh";

/** Sondage : relance le rendu serveur de la page toutes les `intervalMs` (en pause onglet masqué). */
export function AutoRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const release = useRef<(() => void) | null>(null);
  const safetyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Le rafraîchissement est « en cours » tant que la transition est en attente.
  useEffect(() => {
    if (!isPending && release.current) {
      release.current();
      release.current = null;
    }
  }, [isPending]);

  useEffect(() => {
    // Si le serveur est injoignable, router.refresh() ferait un rechargement complet (état perdu) : on sonde d'abord.
    const reachable = async () => {
      if (navigator.onLine === false) return false;
      try {
        const res = await fetch("/favicon.ico", { method: "HEAD", cache: "no-store", signal: AbortSignal.timeout(4000) });
        return res.ok;
      } catch {
        return false;
      }
    };
    const refresh = async () => {
      if (!(await reachable())) throw new Error("injoignable");
      return new Promise<void>((resolve) => {
        // Filet de sécurité : ne jamais rester bloqué si la transition ne se règle pas.
        const safety = setTimeout(resolve, 30_000);
        safetyTimer.current = safety;
        release.current = () => {
          clearTimeout(safety);
          resolve();
        };
        startTransition(() => router.refresh());
      });
    };
    const ar = createAutoRefresh({ intervalMs, refresh, doc: document, win: window, timers: { setInterval: (f, ms) => window.setInterval(f, ms), clearInterval: (id) => window.clearInterval(id as number) } });
    ar.start();
    return () => {
      ar.stop();
      if (safetyTimer.current) clearTimeout(safetyTimer.current);
    };
  }, [intervalMs, router]);

  return null;
}

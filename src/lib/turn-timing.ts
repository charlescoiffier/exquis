import { SUBMIT_GRACE_MS } from "@/lib/access";

export type TurnPhase = "open" | "validation" | "expired";

/** Phase du tour : avant l'échéance, fenêtre de validation (échéance + délai de grâce), ou expiré. `nowMs` est déjà corrigé du décalage d'horloge. */
export function turnPhase(deadlineMs: number, nowMs: number, graceMs = SUBMIT_GRACE_MS) {
  const msToDeadline = Math.max(0, deadlineMs - nowMs);
  const msToExpiry = Math.max(0, deadlineMs + graceMs - nowMs);
  const phase: TurnPhase = nowMs < deadlineMs ? "open" : nowMs < deadlineMs + graceMs ? "validation" : "expired";
  return { phase, msToDeadline, msToExpiry };
}

/** Décalage (ms) à ajouter à l'horloge du client pour obtenir l'heure du serveur. */
export function clockOffset(serverNowIso: string | undefined, clientNowMs: number): number {
  const server = serverNowIso ? Date.parse(serverNowIso) : NaN;
  return Number.isFinite(server) ? server - clientNowMs : 0;
}

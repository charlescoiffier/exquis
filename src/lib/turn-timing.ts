import { SUBMIT_GRACE_MS } from "@/lib/access";

export type TurnPhase = "open" | "validation" | "expired";

/** Marge de sécurité : la fenêtre de validation affichée au joueur se termine avant la coupure serveur (latence, horloges, gros PNG). */
export const CLIENT_MARGIN_MS = 5000;
export const CLIENT_GRACE_MS = SUBMIT_GRACE_MS - CLIENT_MARGIN_MS;

/** Phase du tour : avant l'échéance, fenêtre de validation (échéance + délai client), ou expiré. `nowMs` est déjà corrigé du décalage d'horloge. */
export function turnPhase(deadlineMs: number, nowMs: number, graceMs = CLIENT_GRACE_MS) {
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

export type ClockState = { offset: number; serverNowMs: number };

/** Recale l'horloge sur le dernier rendu serveur ; une charge plus ancienne que la dernière vue (navigation arrière…) est ignorée. */
export function nextClock(prev: ClockState, serverNowIso: string | undefined, clientNowMs: number): ClockState {
  const server = serverNowIso ? Date.parse(serverNowIso) : NaN;
  if (!Number.isFinite(server) || server < prev.serverNowMs) return prev;
  return { offset: server - clientNowMs, serverNowMs: server };
}

/**
 * Le tour n'est déclaré perdu côté client qu'une fois expiré, hors envoi en cours, et si le sort de l'envoi n'est pas incertain
 * (échec réseau : la contribution a pu être enregistrée, c'est le rendu serveur qui tranche).
 */
export function shouldLoseTurn(s: { phase: TurnPhase; busy: boolean; uncertain: boolean }): boolean {
  return s.phase === "expired" && !s.busy && !s.uncertain;
}

/** Un rendu serveur lève l'incertitude d'un envoi échoué seulement s'il date d'après l'échec (heure serveur de l'échec, en ms). */
export function clearsUncertainty(failureAtMs: number | null, serverNowIso: string | undefined): boolean {
  if (failureAtMs === null) return false;
  const server = serverNowIso ? Date.parse(serverNowIso) : NaN;
  return Number.isFinite(server) && server > failureAtMs;
}

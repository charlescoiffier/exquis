import { SUBMIT_GRACE_MS } from "@/lib/access";
import { CLIENT_GRACE_MS } from "@/lib/turn-timing";

export const EXPIRED_MESSAGE = "Le temps est écoulé, votre tour a été remis en jeu.";
export const ABANDONED_MESSAGE = "Vous avez abandonné ce tour : il sera remis en jeu dans moins d'une minute.";

/**
 * Marqueur de session (par partie) :
 * - pending : échéance passée, le serveur peut reprendre le tour ;
 * - abandoned : le joueur a abandonné ; expired : fin de fenêtre ou envoi refusé.
 */
export type MarkerKind = "pending" | "abandoned" | "expired";
export type Marker = { kind: MarkerKind; turnKey: string };

export const turnKeyOf = (rank: number, deadlineIso: string) => `${rank}@${deadlineIso}`;
const deadlineOfKey = (turnKey: string) => Date.parse(turnKey.slice(turnKey.indexOf("@") + 1));

export const encodeMarker = (kind: MarkerKind, turnKey: string) => `${kind}|${turnKey}`;
export function parseMarker(raw: string | null): Marker | null {
  if (!raw) return null;
  const i = raw.indexOf("|");
  const kind = raw.slice(0, i);
  if (i < 0 || (kind !== "pending" && kind !== "abandoned" && kind !== "expired")) return null;
  return { kind, turnKey: raw.slice(i + 1) };
}

/** Message à afficher dans la vue « en attente » (aucun tour actif), ou null s'il n'y a rien à dire. */
export function noticeMessage(m: Marker, nowMs: number): string | null {
  const deadline = deadlineOfKey(m.turnKey);
  if (m.kind === "expired") return EXPIRED_MESSAGE;
  if (m.kind === "pending") return nowMs >= deadline + CLIENT_GRACE_MS ? EXPIRED_MESSAGE : null;
  return nowMs >= deadline + SUBMIT_GRACE_MS ? EXPIRED_MESSAGE : ABANDONED_MESSAGE;
}
export const msUntilReassigned = (m: Marker, nowMs: number) => deadlineOfKey(m.turnKey) + SUBMIT_GRACE_MS - nowMs;

const storageKey = (gameId: string) => `exquis:expired:${gameId}`;
const CLEARED = "exquis:expired-cleared";

export function readMarker(gameId: string): Marker | null {
  try {
    return parseMarker(sessionStorage.getItem(storageKey(gameId)));
  } catch {
    return null;
  }
}
export function markExpired(gameId: string, turnKey: string, kind: MarkerKind): void {
  try {
    sessionStorage.setItem(storageKey(gameId), encodeMarker(kind, turnKey));
  } catch {
    // stockage indisponible : le message reste affiché tant que le composant est monté
  }
}
/** Retire le marqueur sans prévenir (message déjà affiché). */
export function consumeExpired(gameId: string): void {
  try {
    sessionStorage.removeItem(storageKey(gameId));
  } catch {
    // ignoré
  }
}
/** Retire le marqueur et prévient un ExpiredNotice déjà monté (envoi réussi in extremis). */
export function clearExpired(gameId: string): void {
  consumeExpired(gameId);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CLEARED));
}
export const onExpiredCleared = (fn: () => void) => {
  window.addEventListener(CLEARED, fn);
  return () => window.removeEventListener(CLEARED, fn);
};

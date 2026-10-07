// Mémoire de session : le tour (turnId + échéance) abandonné ou expiré, pour que la page rechargée affiche le message
// au lieu de rouvrir l'éditeur (le serveur accepte encore l'envoi jusqu'à la fin de la fenêtre de validation).
const key = (gameId: string) => `exquis:expired:${gameId}`;

/** `final` : abandon ou fin de fenêtre (l'éditeur ne doit plus rouvrir). Sinon : échéance passée, tour peut-être déjà repris par le serveur. */
export function markExpired(gameId: string, turnKey: string, final: boolean): void {
  try {
    sessionStorage.setItem(key(gameId), `${final ? "lost" : "pending"}|${turnKey}`);
  } catch {
    // stockage indisponible : le message reste affiché tant que le composant est monté
  }
}
function stored(gameId: string): string | null {
  try {
    return sessionStorage.getItem(key(gameId));
  } catch {
    return null;
  }
}
export const hasExpiredNotice = (gameId: string): boolean => stored(gameId) !== null;
export const isTurnLost = (gameId: string, turnKey: string): boolean => stored(gameId) === `lost|${turnKey}`;
export const isTurnMarked = (gameId: string, turnKey: string): boolean => stored(gameId)?.endsWith(`|${turnKey}`) ?? false;
export function clearExpired(gameId: string): void {
  try {
    sessionStorage.removeItem(key(gameId));
  } catch {
    // ignoré
  }
}

export const EXPIRED_MESSAGE = "Le temps est écoulé, votre tour a été remis en jeu.";

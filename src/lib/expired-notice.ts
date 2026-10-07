// Mémoire de session : le tour (turnId + échéance) abandonné ou expiré, pour que la page rechargée affiche le message
// au lieu de rouvrir l'éditeur (le serveur accepte encore l'envoi jusqu'à la fin de la fenêtre de validation).
const key = (gameId: string) => `exquis:expired:${gameId}`;

export function markExpired(gameId: string, turnKey: string): void {
  try {
    sessionStorage.setItem(key(gameId), turnKey);
  } catch {
    // stockage indisponible : le message reste affiché tant que le composant est monté
  }
}
export function expiredTurnKey(gameId: string): string | null {
  try {
    return sessionStorage.getItem(key(gameId));
  } catch {
    return null;
  }
}
export function clearExpired(gameId: string): void {
  try {
    sessionStorage.removeItem(key(gameId));
  } catch {
    // ignoré
  }
}

export const EXPIRED_MESSAGE = "Le temps est écoulé, votre tour a été remis en jeu.";

/** Logique pure de sauvegarde automatique de brouillon (testable sans DOM). */
export type DraftSaver = { flush: () => Promise<void> };

/**
 * `read` renvoie l'état courant sérialisé, `send` l'envoie et renvoie `true` seulement si le serveur a accepté.
 * Le contenu n'est marqué « enregistré » qu'après un succès ; un envoi à la fois.
 */
export function createDraftSaver(opts: { initial: string; read: () => string; send: (body: string) => Promise<boolean> }): DraftSaver {
  let lastSaved = opts.initial;
  let saving = false;
  return {
    async flush() {
      if (saving) return;
      const body = opts.read();
      if (body === lastSaved) return;
      saving = true;
      try {
        if (await opts.send(body)) lastSaved = body;
      } catch {
        // échec réseau : réessayé au prochain tick
      } finally {
        saving = false;
      }
    },
  };
}

type Timers = {
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (id: never) => void;
};

/** Démarre un intervalle unique ; renvoie la fonction d'arrêt. */
export function startAutosave(saver: DraftSaver, intervalMs: number, timers: Timers = globalThis as unknown as Timers): () => void {
  const id = timers.setInterval(() => void saver.flush(), intervalMs);
  return () => timers.clearInterval(id as never);
}

/** Logique pure du sondage de rafraîchissement automatique (testable sans DOM). */
type Listener = () => void;
type EventTarget_ = {
  addEventListener: (type: string, fn: Listener) => void;
  removeEventListener: (type: string, fn: Listener) => void;
};

const MAX_BACKOFF_MS = 30_000;

export type AutoRefresh = { start: () => void; stop: () => void };

export function createAutoRefresh(opts: {
  intervalMs: number;
  /** Échecs consécutifs avant d'arrêter le sondage jusqu'au prochain focus ou retour du réseau (défaut 6). */
  maxFailures?: number;
  /** Peut renvoyer une promesse : tant qu'elle n'est pas réglée, aucun autre rafraîchissement ne part. */
  refresh: () => Promise<void> | void;
  doc: EventTarget_ & { visibilityState: string };
  win: EventTarget_;
  timers: { setInterval: (fn: () => void, ms: number) => unknown; clearInterval: (id: never) => void };
}): AutoRefresh {
  const { doc, win, timers } = opts;
  let timer: unknown = null;
  let inflight = false;
  let running = false;
  let failures = 0;
  const delay = () => Math.min(opts.intervalMs * 2 ** failures, MAX_BACKOFF_MS);

  const settle = (ok: boolean) => {
    inflight = false;
    const before = delay();
    failures = ok ? 0 : failures + 1;
    if (!running) return;
    // Trop d'échecs consécutifs : on arrête jusqu'au prochain retour de visibilité ou de focus.
    if (failures >= (opts.maxFailures ?? 6)) return clear();
    if (timer !== null && delay() !== before) schedule();
  };

  const run = () => {
    if (inflight) return;
    inflight = true;
    let result: Promise<void> | void;
    try {
      result = opts.refresh();
    } catch {
      inflight = false;
      return void settle(false);
    }
    if (!result) {
      inflight = false;
      return;
    }
    Promise.resolve(result).then(
      () => settle(true),
      () => settle(false),
    );
  };
  const clear = () => {
    if (timer !== null) timers.clearInterval(timer as never);
    timer = null;
  };
  const schedule = () => {
    clear();
    timer = timers.setInterval(run, delay());
  };
  const onVisibility = () => {
    if (doc.visibilityState === "hidden") return clear();
    run();
    schedule();
  };
  const onFocus = () => {
    if (doc.visibilityState === "hidden") return;
    run();
    schedule();
  };

  return {
    start() {
      if (running) return;
      running = true;
      doc.addEventListener("visibilitychange", onVisibility);
      win.addEventListener("focus", onFocus);
      win.addEventListener("online", onFocus);
      if (doc.visibilityState !== "hidden") schedule();
    },
    stop() {
      if (!running) return;
      running = false;
      clear();
      doc.removeEventListener("visibilitychange", onVisibility);
      win.removeEventListener("focus", onFocus);
      win.removeEventListener("online", onFocus);
    },
  };
}

export const TURN_PREFIX = "(1) C'est votre tour · ";
export function pageTitle(myTurn: boolean, base: string): string {
  return myTurn && !base.startsWith(TURN_PREFIX) ? TURN_PREFIX + base : base;
}

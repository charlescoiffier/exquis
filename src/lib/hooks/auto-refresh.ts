/** Logique pure du sondage de rafraîchissement automatique (testable sans DOM). */
type Listener = () => void;
type EventTarget_ = {
  addEventListener: (type: string, fn: Listener) => void;
  removeEventListener: (type: string, fn: Listener) => void;
};

export type AutoRefresh = { start: () => void; stop: () => void };

export function createAutoRefresh(opts: {
  intervalMs: number;
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

  const run = () => {
    if (inflight) return;
    inflight = true;
    let result: Promise<void> | void;
    try {
      result = opts.refresh();
    } catch {
      result = undefined;
    }
    if (!result) {
      inflight = false;
      return;
    }
    Promise.resolve(result)
      .catch(() => {})
      .finally(() => {
        inflight = false;
      });
  };
  const clear = () => {
    if (timer !== null) timers.clearInterval(timer as never);
    timer = null;
  };
  const schedule = () => {
    clear();
    timer = timers.setInterval(run, opts.intervalMs);
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
      if (doc.visibilityState !== "hidden") schedule();
    },
    stop() {
      if (!running) return;
      running = false;
      clear();
      doc.removeEventListener("visibilitychange", onVisibility);
      win.removeEventListener("focus", onFocus);
    },
  };
}

export const BASE_TITLE = "Exquis";
export function pageTitle(myTurn: boolean): string {
  return myTurn ? `(1) C'est votre tour · ${BASE_TITLE}` : BASE_TITLE;
}

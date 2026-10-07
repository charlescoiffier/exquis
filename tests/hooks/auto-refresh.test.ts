import { describe, expect, it, vi } from "vitest";
import { createAutoRefresh, pageTitle } from "@/lib/hooks/auto-refresh";

function setup(opts: { visible?: boolean; refresh?: () => Promise<void> | void } = {}) {
  const listeners: Record<string, Array<() => void>> = {};
  const target = (name: string) => ({
    addEventListener: (t: string, fn: () => void) => void (listeners[`${name}:${t}`] ??= []).push(fn),
    removeEventListener: (t: string, fn: () => void) => {
      listeners[`${name}:${t}`] = (listeners[`${name}:${t}`] ?? []).filter((f) => f !== fn);
    },
  });
  const doc = { visibilityState: opts.visible === false ? "hidden" : "visible", ...target("doc") };
  const win = target("win");
  const ticks = new Map<number, () => void>();
  let nextId = 1;
  const timers = {
    setInterval: (fn: () => void) => { ticks.set(nextId, fn); return nextId++; },
    clearInterval: (id: number) => void ticks.delete(id),
  };
  const refresh = vi.fn(opts.refresh ?? (() => {}));
  const ar = createAutoRefresh({ intervalMs: 5000, refresh, doc, win, timers });
  const tick = () => ticks.forEach((fn) => fn());
  const emit = (key: string) => (listeners[key] ?? []).forEach((f) => f());
  return { ar, refresh, doc, tick, emit, ticks, listeners };
}

describe("createAutoRefresh", () => {
  it("rafraîchit à chaque tick de l'intervalle", () => {
    const s = setup();
    s.ar.start();
    expect(s.refresh).not.toHaveBeenCalled();
    s.tick();
    s.tick();
    expect(s.refresh).toHaveBeenCalledTimes(2);
  });

  it("ne planifie rien quand l'onglet est masqué au démarrage", () => {
    const s = setup({ visible: false });
    s.ar.start();
    expect(s.ticks.size).toBe(0);
  });

  it("se met en pause quand l'onglet est masqué", () => {
    const s = setup();
    s.ar.start();
    (s.doc as { visibilityState: string }).visibilityState = "hidden";
    s.emit("doc:visibilitychange");
    expect(s.ticks.size).toBe(0);
    s.tick();
    expect(s.refresh).not.toHaveBeenCalled();
  });

  it("rafraîchit immédiatement au retour de visibilité et reprend le sondage", () => {
    const s = setup({ visible: false });
    s.ar.start();
    (s.doc as { visibilityState: string }).visibilityState = "visible";
    s.emit("doc:visibilitychange");
    expect(s.refresh).toHaveBeenCalledTimes(1);
    expect(s.ticks.size).toBe(1);
    s.tick();
    expect(s.refresh).toHaveBeenCalledTimes(2);
  });

  it("rafraîchit immédiatement au retour de focus sans doubler l'intervalle", () => {
    const s = setup();
    s.ar.start();
    s.emit("win:focus");
    expect(s.refresh).toHaveBeenCalledTimes(1);
    expect(s.ticks.size).toBe(1);
  });

  it("ne lance jamais deux rafraîchissements simultanés", async () => {
    let release!: () => void;
    const s = setup({ refresh: () => new Promise<void>((r) => { release = r; }) });
    s.ar.start();
    s.tick();
    s.tick();
    s.emit("win:focus");
    expect(s.refresh).toHaveBeenCalledTimes(1);
    release();
    await Promise.resolve();
    await Promise.resolve();
    s.tick();
    expect(s.refresh).toHaveBeenCalledTimes(2);
  });

  it("reprend après un rafraîchissement qui échoue", async () => {
    const s = setup({ refresh: vi.fn().mockRejectedValueOnce(new Error("offline")) });
    s.ar.start();
    s.tick();
    await new Promise((r) => setTimeout(r, 0));
    s.tick();
    expect(s.refresh).toHaveBeenCalledTimes(2);
  });

  it("nettoie timer et écouteurs à l'arrêt", () => {
    const s = setup();
    s.ar.start();
    s.ar.stop();
    expect(s.ticks.size).toBe(0);
    expect(s.listeners["doc:visibilitychange"]).toEqual([]);
    expect(s.listeners["win:focus"]).toEqual([]);
    s.emit("win:focus");
    expect(s.refresh).not.toHaveBeenCalled();
  });
});

describe("pageTitle", () => {
  it("ajoute le badge quand c'est le tour du joueur", () => {
    expect(pageTitle(true)).toBe("(1) C'est votre tour · Exquis");
    expect(pageTitle(false)).toBe("Exquis");
  });
});

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

  it("double le délai à chaque échec consécutif (plafond 30 s) puis revient à la normale après un succès", async () => {
    const delays: number[] = [];
    let fail = true;
    const ticks = new Map<number, () => void>();
    let id = 1;
    const timers = {
      setInterval: (fn: () => void, ms: number) => { delays.push(ms); ticks.set(id, fn); return id++; },
      clearInterval: (i: number) => void ticks.delete(i),
    };
    const noop = { addEventListener() {}, removeEventListener() {} };
    const ar = createAutoRefresh({ intervalMs: 5000, refresh: () => (fail ? Promise.reject(new Error("x")) : Promise.resolve()), doc: { visibilityState: "visible", ...noop }, win: noop, timers });
    ar.start();
    const flush = () => new Promise((r) => setTimeout(r, 0));
    for (let i = 0; i < 4; i++) { ticks.forEach((f) => f()); await flush(); }
    expect(delays).toEqual([5000, 10000, 20000, 30000]);
    fail = false;
    ticks.forEach((f) => f());
    await flush();
    expect(delays.at(-1)).toBe(5000);
  });

  it("arrête le sondage après maxFailures échecs, reprend au focus", async () => {
    const s = setup({ refresh: () => Promise.reject(new Error("offline")) });
    const ar = createAutoRefresh({ intervalMs: 5000, maxFailures: 2, refresh: s.refresh, doc: s.doc as never, win: { addEventListener: (t: string, f: () => void) => void (s.listeners[`win:${t}`] ??= []).push(f), removeEventListener() {} }, timers: { setInterval: (fn: () => void) => { s.ticks.set(99, fn); return 99; }, clearInterval: () => void s.ticks.delete(99) } });
    ar.start();
    const flush = () => new Promise((r) => setTimeout(r, 0));
    s.ticks.get(99)!();
    await flush();
    s.ticks.get(99)!();
    await flush();
    expect(s.ticks.has(99)).toBe(false);
    s.listeners["win:focus"].at(-1)!();
    await flush();
    expect(s.refresh).toHaveBeenCalledTimes(3);
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
    expect(pageTitle(true, "Cadavre exquis")).toBe("(1) C'est votre tour · Cadavre exquis");
    expect(pageTitle(true, "(1) C'est votre tour · X")).toBe("(1) C'est votre tour · X");
    expect(pageTitle(false, "Cadavre exquis")).toBe("Cadavre exquis");
  });
});

describe("reprise sur retour du réseau", () => {
  it("l'événement online relance le sondage arrêté après des échecs", async () => {
    let offline = true;
    const s = setup({ refresh: () => (offline ? Promise.reject(new Error("hors ligne")) : undefined) });
    s.ar.start();
    const flush = () => new Promise((r) => setTimeout(r, 0));
    for (let i = 0; i < 6; i++) {
      s.ticks.forEach((fn) => fn());
      await flush();
    }
    expect(s.ticks.size).toBe(0);
    const calls = s.refresh.mock.calls.length;
    offline = false;
    s.emit("win:online");
    await flush();
    expect(s.refresh.mock.calls.length).toBe(calls + 1);
    expect(s.ticks.size).toBe(1);
  });
});

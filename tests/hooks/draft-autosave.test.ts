import { describe, expect, it, vi } from "vitest";
import { createDraftSaver, startAutosave } from "@/lib/hooks/draft-autosave";

describe("createDraftSaver", () => {
  it("n'envoie rien tant que le contenu n'a pas changé", async () => {
    const send = vi.fn(async () => true);
    const s = createDraftSaver({ initial: "a", read: () => "a", send });
    await s.flush();
    expect(send).not.toHaveBeenCalled();
  });

  it("envoie le dernier contenu puis ne le renvoie pas une fois enregistré", async () => {
    let value = "a";
    const send = vi.fn(async () => true);
    const s = createDraftSaver({ initial: "a", read: () => value, send });
    value = "b";
    await s.flush();
    await s.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("b");
  });

  it("ne marque pas comme enregistré si le serveur refuse (res.ok faux) et réessaie", async () => {
    const send = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const s = createDraftSaver({ initial: "", read: () => "x", send });
    await s.flush();
    await s.flush();
    expect(send).toHaveBeenCalledTimes(2);
    await s.flush();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("ne marque pas comme enregistré si l'envoi échoue (réseau) et réessaie", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(true);
    const s = createDraftSaver({ initial: "", read: () => "x", send });
    await expect(s.flush()).resolves.toBeUndefined();
    await s.flush();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("ne lance pas deux envois en parallèle", async () => {
    let release!: (ok: boolean) => void;
    const send = vi.fn(() => new Promise<boolean>((r) => (release = r)));
    const s = createDraftSaver({ initial: "", read: () => "x", send });
    const first = s.flush();
    await s.flush();
    expect(send).toHaveBeenCalledTimes(1);
    release(true);
    await first;
  });
});

describe("startAutosave", () => {
  it("utilise un seul intervalle stable et l'arrête", () => {
    const flush = vi.fn();
    let tick!: () => void;
    let delay = 0;
    const setIntervalFn = vi.fn((fn: () => void, ms: number) => {
      tick = fn;
      delay = ms;
      return 42;
    });
    const clearIntervalFn = vi.fn();
    const stop = startAutosave({ flush }, 5000, { setInterval: setIntervalFn, clearInterval: clearIntervalFn });
    expect(setIntervalFn).toHaveBeenCalledTimes(1);
    expect(delay).toBe(5000);
    tick();
    tick();
    expect(flush).toHaveBeenCalledTimes(2);
    stop();
    expect(clearIntervalFn).toHaveBeenCalledWith(42);
  });
});

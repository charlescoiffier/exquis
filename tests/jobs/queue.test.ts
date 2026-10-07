import type PgBoss from "pg-boss";
import { describe, expect, it, vi } from "vitest";
import { SUBMIT_GRACE_MS } from "@/lib/access";
import { QUEUES, getBossWith, runEffects, runEffectsWithRetry, type BossSlot } from "@/lib/jobs/queue";

type Sent = { name: string; data: unknown; opts?: { startAfter?: Date; singletonKey?: string; singletonSeconds?: number } };
function fakeBoss(failTimes = 0) {
  const sent: Sent[] = [];
  let fails = failTimes;
  const boss = {
    send: async (name: string, data: unknown, opts?: Sent["opts"]) => {
      if (fails > 0) { fails--; throw new Error("down"); }
      sent.push({ name, data, opts });
    },
  };
  return { boss: boss as unknown as PgBoss, sent };
}

describe("runEffects", () => {
  const FUTURE = Date.now() + 3600_000;
  it("schedule-turn : expiration + un rappel par étape (50, 25 et 10 % du temps restant)", async () => {
    const { boss, sent } = fakeBoss();
    const deadline = new Date(FUTURE);
    await runEffects(boss, [{ kind: "schedule-turn", turnId: "t", deadline, durationSeconds: 3600 }]);
    expect(sent).toHaveLength(4);
    expect(sent[0].name).toBe(QUEUES.expire);
    expect(sent[0].opts!.startAfter).toEqual(new Date(FUTURE + SUBMIT_GRACE_MS));
    expect(sent.slice(1).map((s) => [s.name, (s.data as { stage: number }).stage, s.opts!.startAfter])).toEqual([
      [QUEUES.remind, 50, new Date(FUTURE - 1_800_000)],
      [QUEUES.remind, 25, new Date(FUTURE - 900_000)],
      [QUEUES.remind, 10, new Date(FUTURE - 360_000)],
    ]);
  });
  it("pas de rappel pour 60 s ni pour un rappel passé", async () => {
    const a = fakeBoss();
    await runEffects(a.boss, [{ kind: "schedule-turn", turnId: "t", deadline: new Date(FUTURE), durationSeconds: 60 }]);
    expect(a.sent.map((s) => s.name)).toEqual([QUEUES.expire]);
    const b = fakeBoss();
    await runEffects(b.boss, [{ kind: "schedule-turn", turnId: "t", deadline: new Date(Date.now() + 10_000), durationSeconds: 3600 }]);
    expect(b.sent.map((s) => s.name)).toEqual([QUEUES.expire]);
  });
  it("finalize-game et flush-notifications", async () => {
    const { boss, sent } = fakeBoss();
    await runEffects(boss, [{ kind: "finalize-game", gameId: "g" }, { kind: "flush-notifications" }]);
    expect(sent[0]).toMatchObject({ name: QUEUES.finalize, data: { gameId: "g" } });
    expect(sent[1]).toMatchObject({ name: QUEUES.flush, opts: { singletonKey: "flush", singletonSeconds: 5 } });
  });
});

describe("runEffectsWithRetry", () => {
  it("réussit après deux échecs", async () => {
    const { boss, sent } = fakeBoss(2);
    const logger = vi.fn();
    await runEffectsWithRetry(boss, [{ kind: "flush-notifications" }], { delaysMs: [1, 1], logger });
    expect(sent).toHaveLength(1);
    expect(logger).not.toHaveBeenCalled();
  });
  it("échec final : ne lève pas et journalise les effets", async () => {
    const { boss, sent } = fakeBoss(99);
    const logger = vi.fn();
    await expect(runEffectsWithRetry(boss, [{ kind: "finalize-game", gameId: "g9" }], { delaysMs: [1, 1], logger })).resolves.toBeUndefined();
    expect(sent).toHaveLength(0);
    expect(logger).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logger.mock.calls[0])).toContain("g9");
  });
});

describe("getBossWith", () => {
  it("un démarrage échoué rejette puis le nouvel appel réessaie", async () => {
    const slot: BossSlot = {};
    let starts = 0;
    const make = () =>
      ({
        on: () => {},
        start: async () => { if (++starts === 1) throw new Error("db down"); },
        createQueue: async () => {},
        stop: async () => {},
      }) as unknown as PgBoss;
    await expect(getBossWith(slot, make)).rejects.toThrow("db down");
    await expect(getBossWith(slot, make)).resolves.toBeDefined();
    expect(starts).toBe(2);
    const again = await getBossWith(slot, make);
    expect(starts).toBe(2);
    expect(again).toBeDefined();
  });
});

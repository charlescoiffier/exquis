export type Effect =
  | { kind: "schedule-turn"; turnId: string; deadline: Date; durationSeconds: number }
  | { kind: "finalize-game"; gameId: string }
  | { kind: "flush-notifications" };

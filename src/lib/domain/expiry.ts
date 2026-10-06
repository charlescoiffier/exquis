export const MAX_ATTEMPTS = 2;

export type ExpiryDecision =
  | { kind: "swap"; withTurnId: string }
  | { kind: "open_call" }
  | { kind: "cancel"; reason: "max_attempts" };

export function decideOnExpiry(args: {
  attempts: number;
  pending: { id: string; rank: number }[];
}): ExpiryDecision {
  if (args.pending.length === 0) return { kind: "open_call" };
  if (args.attempts >= MAX_ATTEMPTS) return { kind: "cancel", reason: "max_attempts" };
  const next = [...args.pending].sort((a, b) => a.rank - b.rank)[0];
  return { kind: "swap", withTurnId: next.id };
}

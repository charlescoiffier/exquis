export const SUBMIT_GRACE_MS = 5000;

export function canActOnTurn(
  t: { assignedUserId: string | null; status: string; deadline: Date | null },
  userId: string,
  now: Date,
): boolean {
  return (
    t.assignedUserId === userId &&
    t.status === "active" &&
    t.deadline !== null &&
    now.getTime() <= t.deadline.getTime() + SUBMIT_GRACE_MS
  );
}

export function canViewFinal(game: { status: string }, participantUserIds: string[], userId: string): boolean {
  // Une partie annulée reste consultable : les contributions déjà faites restent visibles (spec §5.4).
  return (game.status === "completed" || game.status === "cancelled") && participantUserIds.includes(userId);
}

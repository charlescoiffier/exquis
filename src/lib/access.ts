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
  return game.status === "completed" && participantUserIds.includes(userId);
}

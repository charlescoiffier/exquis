import type { NotificationType } from "@/lib/services/notifications";

export const NOTIFICATION_LABELS: Record<NotificationType, string> = {
  game_started: "La partie a commencé",
  your_turn: "C'est votre tour",
  turn_reminder: "Rappel : votre tour se termine bientôt",
  turn_reassigned: "Votre tour a été remis en jeu",
  game_completed: "La partie est terminée",
  game_cancelled: "La partie a été annulée",
  work_ready: "L'œuvre finale est prête",
  comment_added: "Nouveau commentaire sous l'œuvre",
};

export function renderEmail(type: NotificationType, ctx: { gameName: string; appUrl: string; gameId: string }) {
  const label = NOTIFICATION_LABELS[type];
  return {
    subject: `${label} — ${ctx.gameName}`,
    text: `${label} (partie « ${ctx.gameName} »).\n\n${ctx.appUrl}/games/${ctx.gameId}`,
  };
}

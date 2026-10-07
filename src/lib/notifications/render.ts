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
  friend_request: "Nouvelle demande d'ami",
  friend_accepted: "Demande d'ami acceptée",
  game_invite: "Invitation à une partie",
  comment_hidden: "Votre commentaire a été masqué par la modération",
  work_hidden: "Une œuvre a été masquée par la modération",
};

export function renderEmail(type: NotificationType, ctx: { gameName: string; appUrl: string; gameId: string }) {
  const label = NOTIFICATION_LABELS[type];
  return {
    subject: `${label} — ${ctx.gameName}`,
    text: `${label} (partie « ${ctx.gameName} »).\n\n${ctx.appUrl}/games/${ctx.gameId}`,
  };
}

/** Texte et lien d'une notification de l'application (certaines mentionnent la personne à l'origine, d'autres la partie). */
export function describeNotification(n: { type: string; gameId: string | null; gameName: string | null; actorName: string | null }): { text: string; href: string } {
  const who = n.actorName ?? "Quelqu'un";
  const game = n.gameName ? `« ${n.gameName} »` : "une partie";
  const gameHref = n.gameId ? `/games/${n.gameId}` : "/";
  switch (n.type) {
    case "friend_request": return { text: `${who} vous a envoyé une demande d'ami`, href: "/friends" };
    case "friend_accepted": return { text: `${who} a accepté votre demande d'ami`, href: "/friends" };
    case "game_invite": return { text: `${who} vous invite à rejoindre ${game}`, href: gameHref };
    case "comment_hidden": return { text: `Votre commentaire sous ${game} a été masqué par la modération`, href: gameHref };
    case "work_hidden": return { text: `L'œuvre ${game} a été masquée par la modération`, href: gameHref };
    default: return { text: `${NOTIFICATION_LABELS[n.type as NotificationType] ?? n.type} — ${n.gameName ?? ""}`.replace(/ — $/, ""), href: gameHref };
  }
}

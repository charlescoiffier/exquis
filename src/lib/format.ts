export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s ? `${m} min ${s} s` : `${m} min`;
  }
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return h ? `${d} j ${h} h` : `${d} j`;
}

const STATUS_LABELS: Record<string, string> = {
  open: "En attente de joueurs",
  in_progress: "En cours",
  completed: "Terminée",
  cancelled: "Annulée",
};

/** Libellé français d'un état de partie (valeur d'énumération brute inconnue : renvoyée telle quelle). */
export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/** Durées de tour proposées à la création (le serveur accepte de 30 s à 7 jours). */
export const DURATION_OPTIONS: [string, number][] = [
  ["1 minute", 60],
  ["5 minutes", 300],
  ["15 minutes", 900],
  ["1 heure", 3600],
  ["1 jour", 86400],
  ["1 semaine", 604800],
];

const LANGUAGE_LABELS: Record<string, string> = { fr: "Français", en: "Anglais" };

/** Nom de langue lisible (« fr » → « Français ») ; code inconnu : en majuscules ; absent : chaîne vide. */
export function languageLabel(code: string | null | undefined): string {
  if (!code) return "";
  return LANGUAGE_LABELS[code.toLowerCase()] ?? code.toUpperCase();
}

/** « 4 dessinateurs » / « 1 écrivain ». */
export function participantsLabel(type: "drawing" | "text", n: number): string {
  const noun = type === "drawing" ? (n > 1 ? "dessinateurs" : "dessinateur") : n > 1 ? "écrivains" : "écrivain";
  return `${n} ${noun}`;
}

/** « Tour 2 sur 4 · Corps » ; sans intitulé : « Tour 2 sur 4 ». */
export function turnTitle(rank: number, total: number, label?: string | null): string {
  const base = `Tour ${rank} sur ${total}`;
  return label && label.trim() ? `${base} · ${label.trim()}` : base;
}

/** Intitulé du tour `rank` (1-based), ou chaîne vide. */
export function turnLabelOf(labels: string[] | null | undefined, rank: number): string {
  return labels?.[rank - 1]?.trim() ?? "";
}

/** « 6 oct. 2026, 14:05 » (fuseau Europe/Paris). */
export function formatDateTime(d: Date | string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" }).format(new Date(d));
}

/** « 6 oct. 2026 » (fuseau Europe/Paris). */
export function formatDate(d: Date | string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeZone: "Europe/Paris" }).format(new Date(d));
}

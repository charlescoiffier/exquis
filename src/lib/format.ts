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

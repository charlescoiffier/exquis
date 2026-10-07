/** Étiquette d'état d'une partie, alignée à droite de sa carte ; une couleur par cas. */
export type GameTagKind = "in_progress" | "open" | "join" | "call" | "completed" | "cancelled";

const LABELS: Record<GameTagKind, string> = {
  in_progress: "En cours",
  open: "En attente",
  join: "À rejoindre",
  call: "À rejoindre",
  completed: "Terminée",
  cancelled: "Annulée",
};

export function GameTag({ kind }: { kind: GameTagKind }) {
  return (
    <span className={`pill tag tag-${kind}`}>
      {kind === "call" && <span role="img" aria-label="Appel à participation">📢 </span>}
      {LABELS[kind]}
    </span>
  );
}

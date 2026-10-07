import { formatDuration, languageLabel, participantsLabel } from "@/lib/format";

/** Ligne d'informations d'une partie, identique dans toutes les listes : type · nombre de joueurs · durée · langue · créateur. */
export function GameMeta({
  type,
  turns,
  turnDurationSeconds,
  language,
  creatorName,
  extra,
}: {
  type: "drawing" | "text";
  turns: number;
  turnDurationSeconds: number;
  language?: string | null;
  creatorName?: string;
  /** Éléments à ajouter à la fin (date, état…). */
  extra?: string[];
}) {
  const parts = [
    type === "drawing" ? "Dessin" : "Texte",
    participantsLabel(type, turns),
    `${formatDuration(turnDurationSeconds)} par tour`,
    ...(type === "text" && language ? [languageLabel(language)] : []),
    ...(creatorName ? [`par ${creatorName}`] : []),
    ...(extra ?? []),
  ];
  return <p className="meta">{parts.join(" · ")}</p>;
}

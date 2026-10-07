import { formatDuration, languageLabel, participantsLabel } from "@/lib/format";

type MetaProps = {
  type: "drawing" | "text";
  turns: number;
  turnDurationSeconds: number;
  language?: string | null;
  creatorName?: string;
  /** Éléments à ajouter à la fin (date, nombre d'inscrits…). */
  extra?: string[];
};

/** Texte d'informations d'une partie : type · nombre de joueurs · durée · langue · créateur. */
export function gameMetaText({ type, turns, turnDurationSeconds, language, creatorName, extra }: MetaProps): string {
  return [
    type === "drawing" ? "Dessin" : "Texte",
    participantsLabel(type, turns),
    `${formatDuration(turnDurationSeconds)} par tour`,
    ...(type === "text" && language ? [languageLabel(language)] : []),
    ...(creatorName ? [`par ${creatorName}`] : []),
    ...(extra ?? []),
  ].join(" · ");
}

/** Ligne d'informations d'une partie, identique dans toutes les listes. */
export function GameMeta(props: MetaProps) {
  return <p className="meta">{gameMetaText(props)}</p>;
}

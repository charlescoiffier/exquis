import { Fragment, type ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
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

/** Joueurs déjà inscrits à une partie qui n'a pas commencé. */
export function PlayersLine({ players }: { players?: string[] }) {
  return players && players.length > 0 ? <p className="meta">Inscrits : {players.join(", ")}</p> : null;
}

/**
 * Informations d'une partie, identiques dans toutes les listes : type (feuille ou pinceau), nombre de joueurs suivi d'un
 * personnage, durée, langue, créateur. Chaque icône est monochrome et porte un libellé accessible.
 */
export function GameMetaItems({ type, turns, turnDurationSeconds, language, creatorName, extra }: MetaProps) {
  const items: ReactNode[] = [
    <Icon key="type" name={type} label={type === "drawing" ? "Dessin" : "Texte"} />,
    <Fragment key="players">
      {turns} <Icon name="person" label={participantsLabel(type, turns).replace(/^\d+ /, "")} />
    </Fragment>,
    `${formatDuration(turnDurationSeconds)} par tour`,
    ...(type === "text" && language ? [languageLabel(language)] : []),
    ...(creatorName ? [`par ${creatorName}`] : []),
    ...(extra ?? []),
  ];
  return (
    <>
      {items.map((item, i) => (
        <Fragment key={i}>
          {i > 0 && " · "}
          {item}
        </Fragment>
      ))}
    </>
  );
}

/** Ligne d'informations d'une partie, suivie de son thème s'il y en a un. */
export function GameMeta({ theme, players, ...props }: MetaProps & { theme?: string | null; players?: string[] }) {
  return (
    <>
      <p className="meta"><GameMetaItems {...props} /></p>
      <PlayersLine players={players} />
      {theme && <p className="meta theme-line">Thème : <strong>{theme}</strong></p>}
    </>
  );
}

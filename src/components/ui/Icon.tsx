import type { ReactNode } from "react";

/** Icônes monochromes (trait de la couleur du texte, comme les outils du dessin) : un dessin par nom, 24 × 24. */
const PATHS: Record<string, ReactNode> = {
  // Feuille à coin replié et lignes de texte
  text: <path d="M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6" />,
  // Pinceau
  drawing: <path d="M4 20c3 0 5-1 5-4l9-9-2-2-9 9c-3 0-3 3-3 6zM15 6l3 3" />,
  // Personnage : tête et épaules
  person: <path d="M12 4a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM5 21v-2c0-3 3-5 7-5s7 2 7 5v2z" />,
  // Drapeau à hampe
  flag: <path d="M6 21V4M6 4h12l-3 4 3 4H6" />,
  // Haut-parleur (appel à participation)
  speaker: <path d="M4 9h4l6-5v16l-6-5H4zM17 9c1.5 1.5 1.5 4.5 0 6M20 6c3 3 3 9 0 12" />,
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, label, size = 16 }: { name: IconName; label?: string; size?: number }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
      strokeLinejoin="miter"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {label && <title>{label}</title>}
      {PATHS[name]}
    </svg>
  );
}

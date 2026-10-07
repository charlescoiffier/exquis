/** Avatars géométriques : formes imposées, couleurs prises dans une palette fixe (jamais d'image envoyée par les joueurs). */
export const AVATAR_SHAPES = [
  { id: "circle", label: "Disque" },
  { id: "square", label: "Carré" },
  { id: "triangle", label: "Triangle" },
  { id: "diamond", label: "Losange" },
  { id: "hexagon", label: "Hexagone" },
  { id: "star", label: "Étoile" },
  { id: "cross", label: "Croix" },
  { id: "ring", label: "Anneau" },
  { id: "half", label: "Demi-disque" },
  { id: "bars", label: "Barres" },
  { id: "dots", label: "Points" },
  { id: "zigzag", label: "Zigzag" },
] as const;

export const AVATAR_COLORS = [
  { id: "ink", label: "Noir", hex: "#101010" },
  { id: "mustard", label: "Moutarde", hex: "#F2B705" },
  { id: "teal", label: "Canard", hex: "#0B7A75" },
  { id: "red", label: "Rouge", hex: "#B3261E" },
  { id: "pine", label: "Sapin", hex: "#08504D" },
  { id: "butter", label: "Beurre", hex: "#FFE58A" },
  { id: "sand", label: "Sable", hex: "#D9D6C8" },
  { id: "cream", label: "Crème", hex: "#FBFAF5" },
] as const;

export type AvatarShape = (typeof AVATAR_SHAPES)[number]["id"];
export type AvatarColor = (typeof AVATAR_COLORS)[number]["id"];
export type AvatarSpec = { shape: AvatarShape; color: AvatarColor; bg: AvatarColor };

export const isAvatarShape = (v: unknown): v is AvatarShape => AVATAR_SHAPES.some((s) => s.id === v);
export const isAvatarColor = (v: unknown): v is AvatarColor => AVATAR_COLORS.some((c) => c.id === v);

/** Une forme et un fond de la même couleur seraient invisibles. */
export const isValidAvatar = (a: { shape: unknown; color: unknown; bg: unknown }): a is AvatarSpec =>
  isAvatarShape(a.shape) && isAvatarColor(a.color) && isAvatarColor(a.bg) && a.color !== a.bg;

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Avatar attribué par défaut, stable pour un compte : forme et couleurs dérivées de son identifiant. */
export function defaultAvatar(userId: string): AvatarSpec {
  const h = hash(userId);
  const shape = AVATAR_SHAPES[h % AVATAR_SHAPES.length].id;
  const color = AVATAR_COLORS[(h >>> 4) % AVATAR_COLORS.length].id;
  let bg = AVATAR_COLORS[(h >>> 9) % AVATAR_COLORS.length].id;
  if (bg === color) bg = AVATAR_COLORS[(AVATAR_COLORS.findIndex((c) => c.id === color) + 3) % AVATAR_COLORS.length].id;
  return { shape, color, bg };
}

/** Avatar choisi par le joueur, ou celui par défaut tant qu'il n'a rien choisi (ou si le choix stocké est invalide). */
export function resolveAvatar(userId: string, row?: { avatarShape: string | null; avatarColor: string | null; avatarBg: string | null } | null): AvatarSpec {
  const chosen = { shape: row?.avatarShape, color: row?.avatarColor, bg: row?.avatarBg };
  return isValidAvatar(chosen) ? chosen : defaultAvatar(userId);
}

export const colorHex = (id: AvatarColor): string => AVATAR_COLORS.find((c) => c.id === id)!.hex;

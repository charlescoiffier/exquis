import type { ReactNode } from "react";
import { colorHex, type AvatarSpec } from "@/lib/avatar";

/** Dessin de chaque forme (viewBox 0–24), rempli ou tracé avec la couleur de l'avatar. */
function shapeOf(shape: AvatarSpec["shape"], c: string): ReactNode {
  switch (shape) {
    case "circle": return <circle cx="12" cy="12" r="7" fill={c} />;
    case "square": return <rect x="5.5" y="5.5" width="13" height="13" fill={c} />;
    case "triangle": return <path d="M12 4.5 20 19H4z" fill={c} />;
    case "diamond": return <path d="M12 3.5 20.5 12 12 20.5 3.5 12z" fill={c} />;
    case "hexagon": return <path d="M12 3.5 19.4 7.75v8.5L12 20.5l-7.4-4.25v-8.5z" fill={c} />;
    case "star": return <path d="m12 3.5 2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.9 6.7 19.9l1.2-6L3.4 9.8l6-.7z" fill={c} />;
    case "cross": return <path d="M9.5 4h5v5.5H20v5h-5.5V20h-5v-5.5H4v-5h5.5z" fill={c} />;
    case "ring": return <circle cx="12" cy="12" r="6.5" fill="none" stroke={c} strokeWidth="3.5" />;
    case "half": return <path d="M4.5 15.5a7.5 7.5 0 0 1 15 0z" fill={c} />;
    case "bars": return <path d="M5 5h3.5v14H5zM10.25 5h3.5v14h-3.5zM15.5 5H19v14h-3.5z" fill={c} />;
    case "dots": return <><circle cx="7" cy="8" r="2.4" fill={c} /><circle cx="17" cy="8" r="2.4" fill={c} /><circle cx="12" cy="16.5" r="2.4" fill={c} /></>;
    case "zigzag": return <path d="M3.5 15.5 8 8.5l4 7 4-7 4.5 7" fill="none" stroke={c} strokeWidth="3" strokeLinejoin="miter" />;
  }
}

/** Avatar géométrique : une forme sur un fond uni, dans le cadre noir de l'application. */
export function Avatar({ avatar, size = 40, label }: { avatar: AvatarSpec; size?: number; label?: string }) {
  return (
    <svg
      className="avatar"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <rect width="24" height="24" fill={colorHex(avatar.bg)} />
      {shapeOf(avatar.shape, colorHex(avatar.color))}
    </svg>
  );
}

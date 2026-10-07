import type { ReactNode } from "react";

/** Bandeau de titre noir (Abril Fatface) avec un emplacement facultatif pour une action et une ligne d'informations. */
export function Banner({ title, action, meta, theme, as: Tag = "h1" }: { title: ReactNode; action?: ReactNode; meta?: ReactNode; theme?: string | null; as?: "h1" | "h2" }) {
  return (
    <header className="banner">
      <div className="banner-text">
        <Tag className="banner-title">{title}</Tag>
        {meta && <p className="banner-meta">{meta}</p>}
        {theme && <p className="banner-theme">Thème : <strong>{theme}</strong></p>}
      </div>
      {action && <div className="banner-action">{action}</div>}
    </header>
  );
}

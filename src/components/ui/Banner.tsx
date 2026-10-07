import type { ReactNode } from "react";

/** Bandeau de titre noir (Abril Fatface) avec un emplacement facultatif pour une action et une ligne d'informations. */
export function Banner({ title, action, meta, as: Tag = "h1" }: { title: ReactNode; action?: ReactNode; meta?: ReactNode; as?: "h1" | "h2" }) {
  return (
    <header className="banner">
      <div className="banner-text">
        <Tag className="banner-title">{title}</Tag>
        {meta && <p className="banner-meta">{meta}</p>}
      </div>
      {action && <div className="banner-action">{action}</div>}
    </header>
  );
}

import type { ReactNode } from "react";

/** Bandeau de titre noir (Abril Fatface) avec un emplacement facultatif pour une action. */
export function Banner({ title, action, as: Tag = "h1" }: { title: ReactNode; action?: ReactNode; as?: "h1" | "h2" }) {
  return (
    <header className="banner">
      <Tag className="banner-title">{title}</Tag>
      {action && <div className="banner-action">{action}</div>}
    </header>
  );
}

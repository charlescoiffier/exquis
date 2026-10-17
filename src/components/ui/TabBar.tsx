"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Parties", match: (p: string) => p === "/" || (p.startsWith("/games") && p !== "/games/new") },
  { href: "/games/new", label: "Créer", match: (p: string) => p === "/games/new" },
  { href: "/inbox", label: "Notifications", match: (p: string) => p.startsWith("/inbox") },
  { href: "/account", label: "Compte", match: (p: string) => p.startsWith("/account") || p.startsWith("/friends") },
] as const;

/** Onglet réservé aux administrateurs : administration (inscrits, œuvres) et modération (signalements). */
const ADMIN_TAB = { href: "/admin", label: "Admin", match: (p: string) => p.startsWith("/admin") || p.startsWith("/moderation") } as const;

/** Barre d'onglets fixe en bas (mobile) ; navigation horizontale en haut à partir de 900 px. */
export function TabBar({ unread, admin = false, reports = 0 }: { unread: number; admin?: boolean; reports?: number }) {
  const pathname = usePathname();
  const tabs = admin ? [...TABS, ADMIN_TAB] : TABS;
  return (
    <nav className="tabbar" aria-label="Navigation principale">
      {tabs.map((t) => {
        const on = t.match(pathname);
        return (
          <Link key={t.href} href={t.href} className={`tab${on ? " on" : ""}`} aria-current={on ? "page" : undefined}>
            {t.label}
            {t.href === "/admin" && reports > 0 && (
              <>
                <span className="badge" aria-hidden="true">{reports > 99 ? "99+" : reports}</span>
                <span className="sr-only"> {reports} signalement{reports > 1 ? "s" : ""} à traiter</span>
              </>
            )}
            {t.href === "/inbox" && unread > 0 && (
              <>
                <span className="badge" aria-hidden="true">{unread > 99 ? "99+" : unread}</span>
                <span className="sr-only"> {unread} non lu{unread > 1 ? "s" : ""}</span>
              </>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

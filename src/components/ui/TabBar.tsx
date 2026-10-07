"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Parties", match: (p: string) => p === "/" || (p.startsWith("/games") && p !== "/games/new") },
  { href: "/games/new", label: "Créer", match: (p: string) => p === "/games/new" },
  { href: "/inbox", label: "Notifications", match: (p: string) => p.startsWith("/inbox") },
  { href: "/account", label: "Compte", match: (p: string) => p.startsWith("/account") },
] as const;

/** Barre d'onglets fixe en bas (mobile) ; navigation horizontale en haut à partir de 900 px. */
export function TabBar({ unread }: { unread: number }) {
  const pathname = usePathname();
  return (
    <nav className="tabbar" aria-label="Navigation principale">
      {TABS.map((t) => {
        const on = t.match(pathname);
        return (
          <Link key={t.href} href={t.href} className={`tab${on ? " on" : ""}`} aria-current={on ? "page" : undefined}>
            {t.label}
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

"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SignOutButton } from "@/components/SignOutButton";

const TABS = [
  { href: "/", label: "Parties", match: (p: string) => p === "/" || (p.startsWith("/games") && p !== "/games/new") },
  { href: "/games/new", label: "Créer", match: (p: string) => p === "/games/new" },
  { href: "/inbox", label: "Avis", match: (p: string) => p.startsWith("/inbox") },
] as const;

/** Barre d'onglets fixe en bas (mobile) ; navigation horizontale en haut à partir de 900 px. */
export function TabBar({ unread, userName }: { unread: number; userName: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Le menu du compte se referme au changement de page, sur Échap et au clic à l'extérieur.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onDown); };
  }, [open]);

  return (
    <nav className="tabbar" aria-label="Navigation principale">
      {TABS.map((t) => {
        const on = t.match(pathname);
        return (
          <Link key={t.href} href={t.href} className={`tab${on ? " on" : ""}`} aria-current={on ? "page" : undefined}>
            {t.label}
            {t.label === "Avis" && unread > 0 && (
              <span className="badge" aria-label={`${unread} non lu${unread > 1 ? "s" : ""}`}>{unread > 99 ? "99+" : unread}</span>
            )}
          </Link>
        );
      })}
      <div className="tab-account" ref={ref}>
        <button type="button" className={`tab${open ? " on" : ""}`} aria-expanded={open} aria-controls="account-menu" onClick={() => setOpen((o) => !o)}>
          Compte
        </button>
        {open && (
          <div id="account-menu" className="account-menu" role="group" aria-label="Compte">
            <p className="account-name">{userName}</p>
            <SignOutButton />
          </div>
        )}
      </div>
    </nav>
  );
}

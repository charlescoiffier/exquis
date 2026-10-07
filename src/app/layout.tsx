import type { Metadata } from "next";
import { Abril_Fatface, Work_Sans } from "next/font/google";
import Link from "next/link";
import { TabBar } from "@/components/ui/TabBar";
import { getDb } from "@/lib/db/client";
import { countUnread } from "@/lib/services/notifications";
import { getSession } from "@/lib/session";
import "./globals.css";

const display = Abril_Fatface({ weight: "400", subsets: ["latin"], variable: "--font-display", display: "swap", fallback: ["Georgia", "serif"] });
const body = Work_Sans({ weight: ["400", "500", "700"], subsets: ["latin"], variable: "--font-body", display: "swap", fallback: ["system-ui", "sans-serif"] });

export const metadata: Metadata = {
  title: "Cadavre exquis",
  description: "Jeu de cadavre exquis collaboratif : dessins et textes à tour de rôle.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getSession().catch(() => null);
  // Pastille « Avis » : un échec de lecture ne doit jamais empêcher d'afficher la page.
  const unread = session ? await countUnread(getDb(), session.user.id).catch(() => 0) : 0;
  return (
    <html lang="fr" className={`${display.variable} ${body.variable}`}>
      <body className={session ? "has-tabbar" : undefined}>
        <header className="site-header">
          <Link href="/" className="brand">Cadavre exquis</Link>
          {session && <TabBar unread={unread} userName={session.user.name} />}
        </header>
        {children}
      </body>
    </html>
  );
}

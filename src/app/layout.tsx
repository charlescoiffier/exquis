import type { Metadata, Viewport } from "next";
import { Abril_Fatface, Work_Sans } from "next/font/google";
import Link from "next/link";
import { NoWheelNumber } from "@/components/NoWheelNumber";
import { TabBar } from "@/components/ui/TabBar";
import { getDb } from "@/lib/db/client";
import { countUnread } from "@/lib/services/notifications";
import { getSession } from "@/lib/session";
import "./globals.css";

const display = Abril_Fatface({ weight: "400", subsets: ["latin", "latin-ext"], variable: "--font-display", display: "swap", fallback: ["Georgia", "serif"] });
const body = Work_Sans({ weight: ["400", "500", "700"], subsets: ["latin", "latin-ext"], variable: "--font-body", display: "swap", fallback: ["system-ui", "sans-serif"] });

export const viewport: Viewport = { viewportFit: "cover" };

export const metadata: Metadata = {
  title: "Exquis",
  description: "Cadavre exquis en ligne : écrivez ou dessinez à tour de rôle, sans voir ce qui précède, et découvrez l'œuvre commune à la fin.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Session et pastille des notifications : aucun échec de lecture (même synchrone) ne doit empêcher d'afficher la page.
  let session: Awaited<ReturnType<typeof getSession>> = null;
  let unread = 0;
  try {
    session = await getSession();
    if (session) unread = await countUnread(getDb(), session.user.id).catch(() => 0);
  } catch {
    session = null;
  }
  return (
    <html lang="fr" className={`${display.variable} ${body.variable}`}>
      <body className={session ? "has-tabbar" : undefined}>
        <header className="site-header">
          <Link href="/" className="brand">Cadavre exquis</Link>
          {session && <TabBar unread={unread} />}
        </header>
        {children}
        <NoWheelNumber />
      </body>
    </html>
  );
}

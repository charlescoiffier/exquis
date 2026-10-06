import type { Metadata } from "next";
import Link from "next/link";
import { SignOutButton } from "@/components/SignOutButton";
import { getSession } from "@/lib/session";
import "./globals.css";

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
  return (
    <html lang="fr">
      <body>
        <nav>
          <Link href="/">Accueil</Link>
          <Link href="/games/new">Nouvelle partie</Link>
          <Link href="/inbox">Boîte de réception</Link>
          {session && <SignOutButton />}
        </nav>
        {children}
      </body>
    </html>
  );
}

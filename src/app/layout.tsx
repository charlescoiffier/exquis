import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cadavre exquis",
  description: "Jeu de cadavre exquis collaboratif : dessins et textes à tour de rôle.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body>
        <nav>
          <Link href="/">Accueil</Link>
          <Link href="/games/new">Nouvelle partie</Link>
          <Link href="/inbox">Boîte de réception</Link>
        </nav>
        {children}
      </body>
    </html>
  );
}

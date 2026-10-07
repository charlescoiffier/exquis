"use client";
import { useId, useState } from "react";

export type FinalContribution = { rank: number; author: string; label?: string; text: string | null };

const PALETTE = 8;

export function FinalText({ contributions }: { contributions: FinalContribution[] }) {
  const [showAuthors, setShowAuthors] = useState(true);
  const id = useId();
  // Une couleur par auteur, attribuée dans l'ordre de première apparition.
  const colorOf = new Map<string, number>();
  for (const c of contributions) if (!colorOf.has(c.author)) colorOf.set(c.author, colorOf.size % PALETTE);
  return (
    <div className={`final-text${showAuthors ? "" : " final-hidden"}`}>
      <div className="final-toolbar">
        <label className="switch" htmlFor={id}>
          <input id={id} type="checkbox" role="switch" checked={showAuthors} onChange={(e) => setShowAuthors(e.target.checked)} />
          <span className="switch-track" aria-hidden="true" />
          <span>Afficher les noms des auteurs</span>
        </label>
      </div>
      <ol>
        {contributions.map((c) => (
          <li key={c.rank} className="contrib" style={{ ["--c" as string]: `var(--a${colorOf.get(c.author)})`, ["--on-c" as string]: `var(--on-a${colorOf.get(c.author)})` }}>
            <div className="contrib-rail" aria-hidden={!showAuthors}>
              <span className="contrib-author" title={c.label ? `${c.author} · ${c.label}` : c.author}>{c.label ? `${c.author} · ${c.label}` : c.author}</span>
            </div>
            <p className="contrib-body">{c.text}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

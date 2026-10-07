"use client";
import { useId, useState } from "react";

export type FinalContribution = { rank: number; author: string; label?: string; text: string | null };

export function FinalText({ contributions }: { contributions: FinalContribution[] }) {
  const [showAuthors, setShowAuthors] = useState(true);
  const id = useId();
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
          <li key={c.rank} className="contrib">
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

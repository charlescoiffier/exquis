"use client";
import { useId, useState } from "react";
import { transmittedRange, type ExcerptRule } from "@/lib/domain/text";

export type FinalContribution = { rank: number; author: string; label?: string; text: string | null };

/**
 * Texte final. Avec « Afficher les noms des auteurs », chaque auteur est repéré par une barre et la partie de sa
 * contribution transmise à l'auteur suivant (la « phrase commune », vue deux fois) est un peu plus claire.
 */
export function FinalText({ contributions, rule }: { contributions: FinalContribution[]; rule?: ExcerptRule }) {
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
        {contributions.map((c, i) => {
          const text = c.text ?? "";
          // La dernière contribution n'est transmise à personne.
          const range = rule && i < contributions.length - 1 && text ? transmittedRange(text, rule) : null;
          return (
            <li key={c.rank} className="contrib">
              <div className="contrib-rail" aria-hidden={!showAuthors}>
                <span className="contrib-author" title={c.label ? `${c.author} · ${c.label}` : c.author}>{c.label ? `${c.author} · ${c.label}` : c.author}</span>
              </div>
              <p className="contrib-body">
                {range ? (
                  <>
                    {text.slice(0, range.start)}
                    <span className="shared">{text.slice(range.start, range.end)}</span>
                    {text.slice(range.end)}
                  </>
                ) : (
                  text
                )}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

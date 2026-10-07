"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";

const DURATIONS: [string, number][] = [["30 secondes", 30], ["5 minutes", 300], ["1 heure", 3600], ["1 jour", 86400], ["1 semaine", 604800]];

export function NewGameForm() {
  const router = useRouter();
  const [type, setType] = useState<"drawing" | "text">("text");
  const [excerptMode, setExcerptMode] = useState<"paragraph" | "words">("paragraph");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const base = {
      type,
      name: String(f.get("name")),
      turns: Number(f.get("turns")),
      turnDurationSeconds: Number(f.get("duration")),
      visibility: String(f.get("visibility")),
    };
    const body =
      type === "drawing"
        ? { ...base, direction: String(f.get("direction")) }
        : {
            ...base,
            language: String(f.get("language")),
            minWords: Number(f.get("minWords")),
            maxWords: Number(f.get("maxWords")),
            excerptMode,
            ...(excerptMode === "words" ? { excerptWords: Number(f.get("excerptWords")) } : {}),
          };
    setError(null);
    try {
      const res = await fetch("/api/games", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data.error ?? "Création impossible.");
      router.push(`/games/${data.gameId}`);
    } catch {
      setError("Création impossible.");
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <fieldset className="form-section">
        <legend>Type</legend>
        <label htmlFor="name">Titre de la partie (facultatif)</label>
        <input id="name" name="name" maxLength={80} placeholder={type === "text" ? "Texte de <votre nom>" : "Dessin de <votre nom>"} aria-describedby="name-hint" />
        <p id="name-hint" className="hint">Laissé vide, un titre est proposé automatiquement.</p>
        <label htmlFor="type">Type</label>
        <select id="type" value={type} onChange={(e) => setType(e.target.value as "drawing" | "text")} aria-describedby="type-hint">
          <option value="text">Texte</option>
          <option value="drawing">Dessin</option>
        </select>
        <p id="type-hint" className="hint">{type === "text" ? "Chacun écrit une suite en ne voyant que la fin du passage précédent." : "Chacun dessine la suite en ne voyant qu'une bande du dessin précédent."}</p>
      </fieldset>

      <fieldset className="form-section">
        <legend>Tours et durée</legend>
        <label htmlFor="turns">Nombre de tours</label>
        <input id="turns" name="turns" type="number" min={2} max={8} defaultValue={4} required aria-describedby="turns-hint" />
        <p id="turns-hint" className="hint">Entre 2 et 8. Un joueur par tour.</p>
        <label htmlFor="duration">Durée d&apos;un tour</label>
        <select id="duration" name="duration" defaultValue={86400} aria-describedby="duration-hint">
          {DURATIONS.map(([l, v]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <p id="duration-hint" className="hint">Temps accordé à chaque joueur pour jouer son tour.</p>
        <label htmlFor="visibility">Visibilité</label>
        <select id="visibility" name="visibility" defaultValue="public" aria-describedby="visibility-hint">
          <option value="public">Publique (listée)</option>
          <option value="invite">Sur invitation (lien)</option>
        </select>
        <p id="visibility-hint" className="hint">Une partie sur invitation n&apos;apparaît pas dans la liste : partagez son lien.</p>
      </fieldset>

      {type === "drawing" ? (
        <fieldset className="form-section">
          <legend>Options du dessin</legend>
          <label htmlFor="direction">Sens de défilement</label>
          <select id="direction" name="direction">
            <option value="down">Vertical (de haut en bas)</option>
            <option value="right">Horizontal (de gauche à droite)</option>
          </select>
          <p className="hint">Sens dans lequel le dessin se prolonge d&apos;un joueur à l&apos;autre.</p>
        </fieldset>
      ) : (
        <fieldset className="form-section">
          <legend>Options du texte</legend>
          <label htmlFor="language">Langue</label>
          <input id="language" name="language" defaultValue="fr" required aria-describedby="language-hint" />
          <p id="language-hint" className="hint">Code de langue du texte, par exemple fr ou en.</p>
          <label htmlFor="minWords">Mots minimum</label>
          <input id="minWords" name="minWords" type="number" min={1} defaultValue={20} required aria-describedby="words-hint" />
          <label htmlFor="maxWords">Mots maximum</label>
          <input id="maxWords" name="maxWords" type="number" min={1} defaultValue={150} required aria-describedby="words-hint" />
          <p id="words-hint" className="hint">Longueur de chaque contribution, en mots. Le joueur doit écrire entre ces deux valeurs.</p>
          <label htmlFor="excerptMode">Texte transmis au suivant</label>
          <select id="excerptMode" value={excerptMode} onChange={(e) => setExcerptMode(e.target.value as "paragraph" | "words")} aria-describedby="excerpt-hint">
            <option value="paragraph">Dernier paragraphe</option>
            <option value="words">Les X derniers mots</option>
          </select>
          <p id="excerpt-hint" className="hint">Ce que le joueur suivant voit de votre contribution.</p>
          {excerptMode === "words" && (
            <>
              <label htmlFor="excerptWords">Nombre de mots transmis</label>
              <input id="excerptWords" name="excerptWords" type="number" min={1} max={150} defaultValue={20} required />
            </>
          )}
        </fieldset>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      <Button type="submit">Créer la partie</Button>
    </form>
  );
}

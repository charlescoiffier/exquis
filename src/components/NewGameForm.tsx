"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

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
      <label htmlFor="name">Nom de la partie</label>
      <input id="name" name="name" required maxLength={80} />
      <label htmlFor="type">Type</label>
      <select id="type" value={type} onChange={(e) => setType(e.target.value as "drawing" | "text")}>
        <option value="text">Texte</option>
        <option value="drawing">Dessin</option>
      </select>
      <label htmlFor="turns">Nombre de tours</label>
      <input id="turns" name="turns" type="number" min={2} max={8} defaultValue={4} required />
      <label htmlFor="duration">Durée d&apos;un tour</label>
      <select id="duration" name="duration" defaultValue={86400}>
        {DURATIONS.map(([l, v]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <label htmlFor="visibility">Visibilité</label>
      <select id="visibility" name="visibility" defaultValue="public">
        <option value="public">Publique (listée)</option>
        <option value="invite">Sur invitation (lien)</option>
      </select>

      {type === "drawing" ? (
        <>
          <label htmlFor="direction">Sens de défilement</label>
          <select id="direction" name="direction">
            <option value="down">Vertical (de haut en bas)</option>
            <option value="right">Horizontal (de gauche à droite)</option>
          </select>
        </>
      ) : (
        <>
          <label htmlFor="language">Langue</label>
          <input id="language" name="language" defaultValue="fr" required />
          <label htmlFor="minWords">Mots minimum</label>
          <input id="minWords" name="minWords" type="number" min={1} defaultValue={20} required />
          <label htmlFor="maxWords">Mots maximum</label>
          <input id="maxWords" name="maxWords" type="number" min={1} defaultValue={150} required />
          <label htmlFor="excerptMode">Texte transmis au suivant</label>
          <select id="excerptMode" value={excerptMode} onChange={(e) => setExcerptMode(e.target.value as "paragraph" | "words")}>
            <option value="paragraph">Dernier paragraphe</option>
            <option value="words">Les X derniers mots</option>
          </select>
          {excerptMode === "words" && (
            <>
              <label htmlFor="excerptWords">Nombre de mots transmis</label>
              <input id="excerptWords" name="excerptWords" type="number" min={1} max={150} defaultValue={20} required />
            </>
          )}
        </>
      )}
      {error && <p className="error">{error}</p>}
      <p><button type="submit">Créer la partie</button></p>
    </form>
  );
}

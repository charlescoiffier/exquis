"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { countWords } from "@/lib/domain/text";
import { useDraftAutosave } from "@/lib/hooks/useDraftAutosave";

type Props = { gameId: string; excerpt?: string; draft: { text?: string } | null; minWords: number; maxWords: number };

export function TextTurn({ gameId, excerpt, draft, minWords, maxWords }: Props) {
  const router = useRouter();
  const [text, setText] = useState(draft?.text ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const words = countWords(text);
  useDraftAutosave(gameId, { text }, { text: draft?.text ?? "" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/games/${gameId}/my-turn/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Envoi impossible.");
        setBusy(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Envoi impossible.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {excerpt !== undefined && (
        <>
          <p className="muted">Fin du texte précédent :</p>
          <blockquote>{excerpt}</blockquote>
        </>
      )}
      <label htmlFor="text">Votre texte</label>
      <textarea id="text" rows={10} value={text} onChange={(e) => setText(e.target.value)} />
      <p className={words < minWords || words > maxWords ? "error" : "muted"}>{words} mot(s) — entre {minWords} et {maxWords}</p>
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy || words < minWords || words > maxWords}>Envoyer</button>
    </form>
  );
}

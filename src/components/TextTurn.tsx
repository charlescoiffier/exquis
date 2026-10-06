"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { countWords } from "@/lib/domain/text";

type Props = { gameId: string; excerpt?: string; draft: { text?: string } | null; minWords: number; maxWords: number };

export function TextTurn({ gameId, excerpt, draft, minWords, maxWords }: Props) {
  const router = useRouter();
  const [text, setText] = useState(draft?.text ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lastSaved = useRef(draft?.text ?? "");
  const words = countWords(text);

  useEffect(() => {
    const id = setInterval(() => {
      if (text !== lastSaved.current) {
        lastSaved.current = text;
        fetch(`/api/games/${gameId}/my-turn/draft`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) }).catch(() => {
          lastSaved.current = "\u0000unsaved";
        });
      }
    }, 5000);
    return () => clearInterval(id);
  }, [text, gameId]);

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

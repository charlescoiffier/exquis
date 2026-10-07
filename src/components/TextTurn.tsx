"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { countWords, sanitizeText, transmittedRange, type ExcerptRule } from "@/lib/domain/text";
import { gaugeState, mirrorSegments } from "@/lib/domain/text-editor";
import { clearExpired } from "@/lib/expired-notice";
import { ExpiryDialog } from "./ExpiryDialog";
import { useDraftAutosave } from "@/lib/hooks/useDraftAutosave";

type Props = { gameId: string; excerpt?: string; draft: { text?: string } | null; minWords: number; maxWords: number; rule: ExcerptRule; validationMsLeft: number | null; onLost: () => void };

export function TextTurn({ gameId, excerpt, draft, minWords, maxWords, rule, validationMsLeft, onLost }: Props) {
  const router = useRouter();
  const [text, setText] = useState(draft?.text ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mirrorRef = useRef<HTMLDivElement>(null);
  // Mêmes règles que le serveur : on normalise d'abord le texte brut pour que les indices correspondent.
  const clean = sanitizeText(text);
  const words = countWords(clean);
  const gauge = gaugeState(words, minWords, maxWords);
  const [before, sent, after] = mirrorSegments(clean, transmittedRange(clean, rule));
  useDraftAutosave(gameId, { text }, { text: draft?.text ?? "" });

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy || !gauge.ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/games/${gameId}/my-turn/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.code === "not_your_turn") {
          onLost();
          return;
        }
        setError(data.error ?? "Envoi impossible.");
        setBusy(false);
        return;
      }
      clearExpired(gameId);
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
      <div className="mirror-wrap">
        <div className="mirror" ref={mirrorRef} aria-hidden="true" data-testid="mirror">
          {before && <span className="mirror-dim">{before}</span>}
          {sent && <mark className="mirror-sent">{sent}</mark>}
          {after && <span className="mirror-dim">{after}</span>}
          {"\n"}
        </div>
        <textarea
          id="text"
          className="mirror-input"
          rows={10}
          value={text}
          aria-describedby="text-gauge text-legend"
          onChange={(e) => setText(e.target.value)}
          onScroll={(e) => {
            if (mirrorRef.current) mirrorRef.current.scrollTop = e.currentTarget.scrollTop;
          }}
        />
      </div>
      <p id="text-legend" className="legend muted">
        <span className="legend-item"><span className="swatch swatch-dim" aria-hidden="true" />non transmis</span>
        <span className="legend-item"><span className="swatch swatch-sent" aria-hidden="true" />vu par le joueur suivant</span>
      </p>
      <div id="text-gauge" className={`gauge gauge-${gauge.status}`} aria-live="polite">
        <div className="gauge-bar" aria-hidden="true">
          <div className="gauge-fill" style={{ width: `${gauge.fillPercent}%` }} />
          <div className="gauge-min" style={{ left: `${gauge.minPercent}%` }} />
        </div>
        <p className="gauge-msg">{gauge.message}<span className="muted"> (entre {minWords} et {maxWords} mots)</span></p>
      </div>
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy || !gauge.ok}>Envoyer</button>
      {validationMsLeft !== null && (
        <ExpiryDialog
          question="Temps écoulé. Envoyer votre texte maintenant ?"
          submitLabel="Envoyer mon texte"
          msLeft={validationMsLeft}
          busy={busy || !gauge.ok}
          error={error ?? (gauge.ok ? null : gauge.message)}
          onSubmit={() => void submit()}
          onAbandon={onLost}
        />
      )}
    </form>
  );
}

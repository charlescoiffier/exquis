"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import type { AvatarSpec } from "@/lib/avatar";
import { formatDateTime } from "@/lib/format";

export type CommentItem = { id: string; authorId: string; author: string; avatar: AvatarSpec; body: string; createdAt: string };

const MAX = 500;

/** Commentaires sous une œuvre terminée : liste, ajout et suppression de ses propres commentaires. */
export function CommentsSection({ gameId, comments, currentUserId }: { gameId: string; comments: CommentItem[]; currentUserId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/games/${gameId}/comments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body }) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Envoi impossible.");
        return;
      }
      setBody("");
      router.refresh();
    } catch {
      setError("Impossible de joindre le serveur, réessayez.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/games/${gameId}/comments/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Suppression impossible.");
        return;
      }
      router.refresh();
    } catch {
      setError("Impossible de joindre le serveur, réessayez.");
    }
  }

  return (
    <section aria-labelledby="commentaires" className="final-info">
      <h2 id="commentaires">Commentaires{comments.length > 0 ? ` (${comments.length})` : ""}</h2>
      {comments.length === 0 ? (
        <Card><p style={{ margin: 0 }} className="muted">Aucun commentaire pour l&apos;instant : soyez le premier.</p></Card>
      ) : (
        <ul className="cards comments">
          {comments.map((c) => (
            <li key={c.id}>
              <Card className="comment">
                <div className="comment-head">
                  <Avatar avatar={c.avatar} size={28} />
                  <strong>{c.author}</strong>
                  <span className="muted">{formatDateTime(c.createdAt)}</span>
                  {c.authorId === currentUserId && (
                    <button type="button" className="secondary comment-delete" onClick={() => remove(c.id)} aria-label={`Supprimer mon commentaire du ${formatDateTime(c.createdAt)}`}>Supprimer</button>
                  )}
                </div>
                <p className="comment-body">{c.body}</p>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={send} className="comment-form">
        <label htmlFor="comment-body">Votre commentaire</label>
        <textarea id="comment-body" value={body} maxLength={MAX} rows={3} onChange={(e) => setBody(e.target.value)} placeholder="Ce que vous avez aimé, une anecdote…" />
        <div className="field-foot">
          <p className="hint">{body.length}/{MAX} · visible des participants de la partie</p>
          <button type="submit" disabled={busy || !body.trim()}>Publier</button>
        </div>
        {error && <p role="alert" className="error">{error}</p>}
      </form>
    </section>
  );
}

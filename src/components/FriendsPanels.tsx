"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { AvatarSpec } from "@/lib/avatar";
import { copyText } from "@/lib/clipboard";

type PersonProps = { userId: string; name: string; avatar: AvatarSpec };

async function call(url: string, method: string, body?: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.ok) return null;
    const data = await res.json().catch(() => ({}));
    return data.error ?? "Action impossible.";
  } catch {
    return "Impossible de joindre le serveur, réessayez.";
  }
}

export function PersonLine({ person, children }: { person: PersonProps; children?: React.ReactNode }) {
  return (
    <div className="person-line">
      <Avatar avatar={person.avatar} size={36} />
      <span className="person-name">{person.name}</span>
      {children && <div className="person-actions">{children}</div>}
    </div>
  );
}

/** Code ami personnel, copiable. */
export function FriendCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <code className="invite-code">{code}</code>
      <div className="turn-actions">
        <button
          type="button"
          className="secondary"
          onClick={async () => setCopied(await copyText(code))}
        >
          Copier mon code
        </button>
        {copied && <span role="status" className="feedback">Copié.</span>}
      </div>
    </div>
  );
}

/** Ajouter un ami avec son code. */
export function AddFriendForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/friends/requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setMessage({ ok: false, text: data.error ?? "Demande impossible." });
      setCode("");
      setMessage({ ok: true, text: data.status === "accepted" ? "Vous êtes maintenant amis." : "Demande envoyée." });
      router.refresh();
    } catch {
      setMessage({ ok: false, text: "Impossible de joindre le serveur, réessayez." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="friend-code">Code ami de la personne</label>
      <div className="field-row">
        <input id="friend-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={20} autoCapitalize="characters" autoComplete="off" placeholder="ABCD-2345" />
        <button type="submit" disabled={busy || !code.trim()}>Envoyer la demande</button>
      </div>
      {message && <p role={message.ok ? "status" : "alert"} className={message.ok ? "feedback" : "error"}>{message.text}</p>}
    </form>
  );
}

/** Actions sur une personne : accepter / refuser une demande reçue, annuler une demande envoyée, retirer un ami, ajouter un joueur rencontré. */
export function PersonAction({ kind, userId, requestId, name }: { kind: "incoming" | "outgoing" | "friend" | "met"; userId: string; requestId?: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  async function run(fn: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    const err = await fn();
    setBusy(false);
    if (err) return setError(err);
    setConfirm(false);
    router.refresh();
  }

  return (
    <>
      {kind === "incoming" && (
        <>
          <Button disabled={busy} onClick={() => run(() => call(`/api/friends/requests/${requestId}`, "POST", { accept: true }))}>Accepter</Button>
          <Button variant="secondary" disabled={busy} onClick={() => run(() => call(`/api/friends/requests/${requestId}`, "POST", { accept: false }))}>Refuser</Button>
        </>
      )}
      {kind === "outgoing" && <Button variant="secondary" disabled={busy} onClick={() => run(() => call(`/api/friends/${userId}`, "DELETE"))}>Annuler</Button>}
      {kind === "met" && <Button variant="secondary" disabled={busy} onClick={() => run(() => call("/api/friends/requests", "POST", { userId }))}>Ajouter</Button>}
      {kind === "friend" && <Button variant="secondary" disabled={busy} onClick={() => setConfirm(true)}>Retirer</Button>}
      {error && <span role="alert" className="error">{error}</span>}
      {confirm && (
        <ConfirmDialog title="Retirer cet ami ?" confirmLabel="Retirer" busy={busy} error={error} onConfirm={() => run(() => call(`/api/friends/${userId}`, "DELETE"))} onCancel={() => setConfirm(false)}>
          <p>{name} ne fera plus partie de vos amis. Vous pourrez toujours lui renvoyer une demande.</p>
        </ConfirmDialog>
      )}
    </>
  );
}

/** Inviter des amis à une partie en attente de joueurs. */
export function InviteFriends({ gameId, friends: initialFriends }: { gameId: string; friends: PersonProps[] }) {
  // Les amis invités quittent la liste sur place (sans rechargement) : le message de confirmation reste affiché.
  const [friends, setFriends] = useState(initialFriends);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => setFriends(initialFriends), [initialFriends]);

  async function send() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/games/${gameId}/invite`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ friendIds: selected }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setMessage({ ok: false, text: data.error ?? "Invitation impossible." });
      setFriends((list) => list.filter((f) => !selected.includes(f.userId)));
      setSelected([]);
      setMessage({ ok: true, text: data.invited > 1 ? `${data.invited} invitations envoyées.` : "Invitation envoyée." });
    } catch {
      setMessage({ ok: false, text: "Impossible de joindre le serveur, réessayez." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <ul className="cards friend-pick">
        {friends.map((f) => (
          <li key={f.userId}>
            <label className="friend-pick-row">
              <input type="checkbox" checked={selected.includes(f.userId)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, f.userId].slice(0, 8) : s.filter((id) => id !== f.userId)))} />
              <Avatar avatar={f.avatar} size={28} />
              <span>{f.name}</span>
            </label>
          </li>
        ))}
      </ul>
      <Button disabled={busy || selected.length === 0} onClick={send}>Inviter{selected.length > 0 ? ` (${selected.length})` : ""}</Button>
      {message && <p role={message.ok ? "status" : "alert"} className={message.ok ? "feedback" : "error"}>{message.text}</p>}
    </div>
  );
}

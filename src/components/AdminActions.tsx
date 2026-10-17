"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

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

/** Bouton de suppression avec confirmation (compte, œuvre ou commentaire). `redirectTo` : page affichée après la suppression. */
export function AdminDelete({
  url, label = "Supprimer", title, children, redirectTo, small = false,
}: { url: string; label?: string; title: string; children: React.ReactNode; redirectTo?: string; small?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    const err = await call(url, "DELETE");
    setBusy(false);
    if (err) return setError(err);
    setOpen(false);
    if (redirectTo) router.push(redirectTo);
    router.refresh();
  }

  return (
    <>
      <button type="button" className={`secondary${small ? " comment-delete" : ""}`} onClick={() => setOpen(true)}>{label}</button>
      {open && (
        <ConfirmDialog title={title} confirmLabel={label} busy={busy} error={error} onConfirm={confirm} onCancel={() => { setOpen(false); setError(null); }}>
          {children}
        </ConfirmDialog>
      )}
    </>
  );
}

/** Valide l'adresse d'un compte (un seul). */
export function VerifyEmailButton({ userId }: { userId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setError(null);
    const err = await call(`/api/admin/users/${userId}/verify`, "POST");
    setBusy(false);
    if (err) return setError(err);
    router.refresh();
  }
  return (
    <>
      <button type="button" onClick={run} disabled={busy}>Valider l&apos;adresse</button>
      {error && <span role="alert" className="error">{error}</span>}
    </>
  );
}

/** Valide d'un coup toutes les adresses non vérifiées, après confirmation. */
export function VerifyAllButton({ count }: { count: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setError(null);
    const err = await call("/api/admin/verify-all", "POST");
    setBusy(false);
    if (err) return setError(err);
    setOpen(false);
    router.refresh();
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Valider toutes les adresses ({count})</button>
      {open && (
        <ConfirmDialog title="Valider toutes les adresses ?" confirmLabel="Valider" busy={busy} error={error} onConfirm={run} onCancel={() => { setOpen(false); setError(null); }}>
          <p>{count} {count > 1 ? "comptes pourront" : "compte pourra"} se connecter sans confirmer leur adresse par email. Aucun message n&apos;est envoyé.</p>
        </ConfirmDialog>
      )}
    </>
  );
}

/** Rôle d'un compte : joueur ou modérateur. */
export function RoleSelect({ userId, role }: { userId: string; role: string }) {
  const router = useRouter();
  const [value, setValue] = useState(role);
  const [error, setError] = useState<string | null>(null);

  async function change(next: string) {
    const previous = value;
    setValue(next);
    setError(null);
    const err = await call(`/api/admin/users/${userId}/role`, "POST", { role: next });
    if (err) {
      setValue(previous);
      setError(err);
    } else {
      router.refresh();
    }
  }

  return (
    <>
      <select aria-label="Rôle" value={value} onChange={(e) => change(e.target.value)} className="role-select">
        <option value="player">Joueur</option>
        <option value="moderator">Modérateur</option>
      </select>
      {error && <span role="alert" className="error">{error}</span>}
    </>
  );
}

export { Button };

"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { AVATAR_COLORS, AVATAR_SHAPES, isValidAvatar, type AvatarSpec } from "@/lib/avatar";

async function saveProfile(patch: { name?: string; emailEnabled?: boolean; reminderStage?: number; avatar?: { shape: string; color: string; bg: string } }): Promise<string | null> {
  try {
    const res = await fetch("/api/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    const data = await res.json().catch(() => ({}));
    return res.ok ? null : (data.error ?? "Enregistrement impossible.");
  } catch {
    return "Impossible de joindre le serveur, réessayez.";
  }
}

/** Changement du nom affiché. */
export function NameForm({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const err = await saveProfile({ name });
    setBusy(false);
    if (err) return setMessage({ ok: false, text: err });
    setMessage({ ok: true, text: "Nom enregistré." });
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit}>
      <label htmlFor="account-name">Nom affiché</label>
      <input id="account-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} required aria-describedby="account-name-hint" />
      <p id="account-name-hint" className="hint">Visible des autres joueurs dans les listes et sur les œuvres.</p>
      {message && <p role={message.ok ? "status" : "alert"} className={message.ok ? "feedback" : "error"}>{message.text}</p>}
      <Button type="submit" disabled={busy || name.trim() === "" || name.trim() === initialName}>Enregistrer</Button>
    </form>
  );
}

/** Préférence d'envoi des notifications par email. */
export function EmailPreference({ initial }: { initial: boolean }) {
  const [email, setEmail] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  async function toggle(v: boolean) {
    const previous = email;
    setEmail(v);
    setError(null);
    const err = await saveProfile({ emailEnabled: v });
    if (err) {
      setEmail(previous);
      setError(err);
    }
  }

  return (
    <div>
      <label className="switch">
        <input type="checkbox" role="switch" checked={email} onChange={(e) => toggle(e.target.checked)} />
        <span className="switch-track" aria-hidden="true" />
        <span>Recevoir les notifications par email</span>
      </label>
      {error && <p role="alert" className="error">{error}</p>}
    </div>
  );
}

const REMINDER_LABELS: [number, string][] = [
  [50, "À la moitié du temps restant"],
  [25, "Au quart du temps restant"],
  [10, "Au dixième du temps restant"],
  [0, "Aucun rappel"],
];

/** Moment du rappel avant la fin d'un tour (envoyé dans l'application et, selon la préférence ci-dessus, par email). */
export function ReminderPreference({ initial }: { initial: number }) {
  const [stage, setStage] = useState(initial);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function change(value: number) {
    const previous = stage;
    setStage(value);
    setMessage(null);
    const err = await saveProfile({ reminderStage: value });
    if (err) {
      setStage(previous);
      setMessage({ ok: false, text: err });
    } else {
      setMessage({ ok: true, text: "Préférence enregistrée." });
    }
  }

  return (
    <div style={{ marginTop: 16 }}>
      <label htmlFor="reminder-stage">Rappel avant la fin de mon tour</label>
      <select id="reminder-stage" value={stage} onChange={(e) => change(Number(e.target.value))}>
        {REMINDER_LABELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {message && <p role={message.ok ? "status" : "alert"} className={message.ok ? "feedback" : "error"}>{message.text}</p>}
    </div>
  );
}

/** Choix de l'avatar : une forme imposée, une couleur de forme et une couleur de fond prises dans la palette. */
export function AvatarForm({ initial }: { initial: AvatarSpec }) {
  const [avatar, setAvatar] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const valid = isValidAvatar(avatar);
  const dirty = avatar.shape !== saved.shape || avatar.color !== saved.color || avatar.bg !== saved.bg;

  async function save() {
    setBusy(true);
    setMessage(null);
    const err = await saveProfile({ avatar });
    setBusy(false);
    if (err) return setMessage({ ok: false, text: err });
    setSaved(avatar);
    setMessage({ ok: true, text: "Avatar enregistré." });
  }

  const swatches = (field: "color" | "bg", legend: string) => (
    <fieldset className="avatar-field">
      <legend>{legend}</legend>
      <div className="avatar-options">
        {AVATAR_COLORS.map((c) => (
          <button
            key={c.id}
            type="button"
            className="palette-swatch"
            style={{ background: c.hex }}
            aria-label={c.label}
            title={c.label}
            aria-pressed={avatar[field] === c.id}
            onClick={() => setAvatar({ ...avatar, [field]: c.id })}
          />
        ))}
      </div>
    </fieldset>
  );

  return (
    <div className="avatar-form">
      <div className="avatar-preview"><Avatar avatar={avatar} size={96} label="Aperçu de votre avatar" /></div>
      <div className="avatar-controls">
        <fieldset className="avatar-field">
          <legend>Forme</legend>
          <div className="avatar-options">
            {AVATAR_SHAPES.map((sh) => (
              <button
                key={sh.id}
                type="button"
                className="avatar-choice"
                aria-label={sh.label}
                title={sh.label}
                aria-pressed={avatar.shape === sh.id}
                onClick={() => setAvatar({ ...avatar, shape: sh.id })}
              >
                <Avatar avatar={{ shape: sh.id, color: avatar.color === avatar.bg ? "ink" : avatar.color, bg: avatar.bg }} size={36} />
              </button>
            ))}
          </div>
        </fieldset>
        {swatches("color", "Couleur de la forme")}
        {swatches("bg", "Couleur du fond")}
        {!valid && <p role="alert" className="error">La forme et le fond doivent avoir des couleurs différentes.</p>}
        {message && <p role={message.ok ? "status" : "alert"} className={message.ok ? "feedback" : "error"}>{message.text}</p>}
        <Button type="button" onClick={save} disabled={busy || !valid || !dirty}>Enregistrer l&apos;avatar</Button>
      </div>
    </div>
  );
}

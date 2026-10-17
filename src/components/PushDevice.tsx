"use client";
import { useEffect, useState } from "react";

/** Clé publique VAPID (base64url) → octets attendus par `pushManager.subscribe`. */
function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type State = "loading" | "unsupported" | "insecure" | "ios" | "denied" | "off" | "on";

/**
 * Notifications sur cet appareil (Web Push) : demande l'autorisation, enregistre le service worker et l'abonnement.
 * Sur iPhone, elles ne fonctionnent que si l'application est ajoutée à l'écran d'accueil.
 */
export function PushDevice({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
      if (!window.isSecureContext) return setState("insecure");
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setState(ios && !standalone ? "ios" : "unsupported");
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  async function enable() {
    setBusy(true);
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
      const json = sub.toJSON();
      const res = await fetch("/api/push/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMessage({ ok: false, text: data.error ?? "Activation impossible." });
        return;
      }
      setState("on");
      setMessage({ ok: true, text: "Notifications activées sur cet appareil." });
    } catch {
      setMessage({ ok: false, text: "Activation impossible sur cet appareil." });
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMessage(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe();
      }
      setState("off");
      setMessage({ ok: true, text: "Notifications désactivées sur cet appareil." });
    } catch {
      setMessage({ ok: false, text: "Désactivation impossible." });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      setMessage(res.ok ? (data.sent > 0 ? { ok: true, text: "Notification de test envoyée." } : { ok: false, text: "Aucun appareil n'a pu être atteint." }) : { ok: false, text: data.error ?? "Envoi impossible." });
    } catch {
      setMessage({ ok: false, text: "Impossible de joindre le serveur, réessayez." });
    } finally {
      setBusy(false);
    }
  }

  const notice: Partial<Record<State, string>> = {
    loading: "Vérification de cet appareil…",
    insecure: "Les notifications sur téléphone exigent une connexion sécurisée (HTTPS).",
    ios: "Sur iPhone et iPad, ajoutez d'abord Exquis à l'écran d'accueil (Partager, puis « Sur l'écran d'accueil »), puis rouvrez-le depuis son icône.",
    unsupported: "Ce navigateur ne prend pas en charge les notifications sur téléphone.",
    denied: "Les notifications sont bloquées pour ce site : autorisez-les dans les réglages du navigateur, puis rechargez la page.",
  };

  return (
    <div className="push-device">
      <p className="hint" style={{ margin: "0 0 8px" }}>Notifications sur cet appareil</p>
      {notice[state] && <p className="muted" style={{ margin: 0 }}>{notice[state]}</p>}
      {state === "off" && <button type="button" onClick={enable} disabled={busy}>Activer sur cet appareil</button>}
      {state === "on" && (
        <div className="turn-actions" style={{ marginTop: 0 }}>
          <span className="pill tag tag-completed">Activées</span>
          <button type="button" className="secondary" onClick={test} disabled={busy}>Envoyer un test</button>
          <button type="button" className="secondary" onClick={disable} disabled={busy}>Désactiver</button>
        </div>
      )}
      {message && <p role={message.ok ? "status" : "alert"} className={message.ok ? "feedback" : "error"}>{message.text}</p>}
    </div>
  );
}

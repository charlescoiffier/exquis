"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await authClient.signOut();
      if (err) {
        setError("Déconnexion impossible, réessayez.");
        return;
      }
      router.push("/login");
      router.refresh();
    } catch {
      setError("Déconnexion impossible, réessayez.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="secondary" onClick={signOut} disabled={busy}>Se déconnecter</button>
      {error && <span role="alert" className="error"> {error}</span>}
    </>
  );
}

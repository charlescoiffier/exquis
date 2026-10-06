import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { DomainError } from "@/lib/errors";

export type SessionUser = { id: string; name: string; email: string };

export async function getSession(): Promise<{ user: SessionUser } | null> {
  const s = await auth.api.getSession({ headers: await headers() });
  return s ? { user: { id: s.user.id, name: s.user.name, email: s.user.email } } : null;
}

export async function requireUser(): Promise<SessionUser> {
  const s = await getSession();
  if (!s) throw new DomainError("unauthorized", "Connexion requise.", 401);
  return s.user;
}

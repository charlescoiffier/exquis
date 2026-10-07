/** Message français pour une erreur de connexion Better Auth (statut HTTP, code et message du serveur). */
export function loginErrorMessage(e: { status?: number; code?: string; message?: string }): string {
  if (e.code === "INVALID_EMAIL_OR_PASSWORD" || e.status === 401) return "Email ou mot de passe incorrect.";
  if (e.code === "EMAIL_NOT_VERIFIED" || e.status === 403) return "Vérifiez votre email avant de vous connecter.";
  if (e.status === 429) return "Trop de tentatives, réessayez plus tard.";
  return e.message || "Connexion impossible.";
}

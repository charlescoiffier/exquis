import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Marque les créations de compte qui passent par /api/register avec une invitation réclamée.
 * `userId` est renseigné par le hook de création quand un compte a réellement été créé.
 */
export const inviteContext = new AsyncLocalStorage<{ code: string; userId?: string }>();

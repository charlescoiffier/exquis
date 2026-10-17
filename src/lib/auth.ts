import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { getDb, fullSchema } from "@/lib/db/client";
import { env, requireEmailVerification } from "@/lib/env";
import { inviteContext } from "@/lib/invite-context";
import { getMailer } from "@/lib/notifications/mailer";
import { profile } from "@/lib/db/schema";

const e = env();

export const auth = betterAuth({
  baseURL: e.APP_URL,
  secret: e.BETTER_AUTH_SECRET,
  database: drizzleAdapter(getDb(), { provider: "pg", schema: fullSchema }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    requireEmailVerification: requireEmailVerification(e),
  },
  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, url }) => {
      await getMailer().send({ to: user.email, subject: "Vérifiez votre email", text: `Bienvenue ! Confirmez votre adresse : ${url}` });
    },
  },
  hooks: {
    // Refus explicite (403) : sans cela, avec la vérification d'email, Better Auth répond
    // par une réponse générique 200 (anti-énumération) quand le hook de création lève un 403.
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/sign-up/email" && e.REGISTRATION_MODE === "invite" && !inviteContext.getStore()) {
        throw new APIError("FORBIDDEN", { message: "Inscription sur invitation uniquement." });
      }
    }),
  },
  databaseHooks: {
    user: {
      create: {
        before: async (u) => {
          if (e.REGISTRATION_MODE === "invite" && !inviteContext.getStore()) {
            throw new APIError("FORBIDDEN", { message: "Inscription sur invitation uniquement." });
          }
          return { data: u };
        },
        after: async (u) => {
          const store = inviteContext.getStore();
          if (store) store.userId = u.id;
          await getDb().insert(profile).values({ userId: u.id }).onConflictDoNothing();
        },
      },
    },
  },
  plugins: [nextCookies()],
});

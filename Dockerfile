FROM node:22-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Valeurs factices, valables uniquement pour l'étape de build : src/lib/auth.ts valide l'environnement à l'import
# et .dockerignore exclut les fichiers .env*. Ces variables n'existent pas dans l'image d'exécution (étape runtime).
ENV DATABASE_URL=postgres://build:build@localhost:5432/build \
    BETTER_AUTH_SECRET=build-time-placeholder-secret \
    STORAGE_SECRET=build-time-placeholder-secret
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json /app/tsconfig.json ./
# Dossier de stockage local, appartenant à l'utilisateur non-root : un volume nommé monté dessus en hérite.
RUN mkdir -p /app/.storage && chown node:node /app/.storage
USER node
EXPOSE 3000
CMD ["node", "server.js"]

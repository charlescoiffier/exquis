# Cadavre exquis

Application web de cadavres exquis collaboratifs (texte ou dessin) : 2 à 8 joueurs, chacun ne voit que la fin de la contribution précédente, l'œuvre complète est révélée à la fin.

Pile : Next.js 15, PostgreSQL, Better Auth, pg-boss (worker), sharp, stockage local ou S3, Resend (emails).

## Prérequis

- Node 22 ou plus
- Une base PostgreSQL 16 : Docker (`docker compose`) **ou** la base embarquée de développement (voir ci-dessous)

## Démarrage local

```bash
npm install
cp .env.example .env.local        # puis adapter les secrets
docker compose up -d db           # PostgreSQL (alternative : npm run db:dev, voir plus bas)
npm run db:migrate
npm run dev                       # http://localhost:3000
npm run worker                    # dans un second terminal
```

`npm run worker` et `npm run db:migrate` chargent automatiquement `.env.local` s'il existe (option `--env-file-if-exists`). En production, ces fichiers sont facultatifs : les vraies variables d'environnement suffisent.

### Alternative sans Docker : base embarquée

```bash
nohup npm run db:dev > .pgdata.log 2>&1 &
```

Lance un PostgreSQL embarqué (données dans `.pgdata/`, port 5432, bases `exquis` et `exquis_test`). Si une base répond déjà sur le port 5432, la commande ne fait rien.

### Worker

Le worker (`npm run worker`, pg-boss) expire les tours, envoie les rappels et les emails, assemble les œuvres finales. Sans lui, les parties n'avancent pas à l'expiration des tours. Il doit tourner en permanence.

## Première invitation

Les inscriptions sont sur invitation par défaut (`REGISTRATION_MODE=invite`). Pour amorcer la première :

```bash
npx tsx scripts/create-invite.ts
```

Le script affiche un code à saisir sur `/register`. Ensuite, chaque joueur peut en générer depuis l'application (bouton « Générer une invitation » sur la page `/inbox`, 5 invitations ouvertes au maximum).

## Modes d'inscription

| `REGISTRATION_MODE` | Effet |
|---|---|
| `invite` (défaut) | un code d'invitation valide est requis |
| `open` | inscription libre |

Google OAuth n'est volontairement pas inclus : en mode invitation, tout compte passe par `/api/register`. À ajouter si l'on passe en `REGISTRATION_MODE=open`.

## Variables d'environnement

| Variable | Rôle |
|---|---|
| `DATABASE_URL` | connexion PostgreSQL (obligatoire) |
| `APP_URL` | URL publique de l'application (défaut `http://localhost:3000`) |
| `BETTER_AUTH_SECRET` | secret d'authentification, 32 caractères aléatoires recommandés (`openssl rand -base64 32`) |
| `STORAGE_SECRET` | secret de signature des URLs de stockage local, 16 caractères minimum |
| `REGISTRATION_MODE` | `invite` ou `open` |
| `REQUIRE_EMAIL_VERIFICATION` | `true` (défaut) ou `false` |
| `STORAGE_DRIVER` | `local` (défaut, dossier `STORAGE_DIR`, `.storage`) ou `s3` |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | stockage S3 compatible (AWS, Cloudflare R2, Backblaze B2) |
| `RESEND_API_KEY`, `MAIL_FROM` | envoi d'emails ; sans clé, les emails sont écrits dans la console |

## Stockage S3 : CORS

L'éditeur de dessin charge la bande précédente avec `img.crossOrigin = "anonymous"` puis exporte le canvas. Avec `STORAGE_DRIVER=s3`, le bucket **doit** donc autoriser les requêtes GET depuis l'origine de l'application, faute de quoi le canvas est « souillé » et l'envoi d'un dessin échoue. C'est une exigence de déploiement. Exemple de règle CORS (adapter `AllowedOrigins` à `APP_URL`) :

```json
[
  {
    "AllowedOrigins": ["https://exquis.example.com"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]
```

(Cloudflare R2 : Settings > CORS policy ; AWS S3 : Permissions > CORS ; Backblaze B2 : règles CORS du bucket.)

Avec le stockage local (`STORAGE_DRIVER=local`), les fichiers sont servis par l'application elle-même (même origine) : pas de CORS. `docker-compose.prod.yml` monte un volume nommé `storage` (`/app/.storage`, `STORAGE_DIR` fixé) partagé par `web` et `worker` : cela fonctionne sur un seul hôte. S3 est **obligatoire** dès que web et worker tournent sur des hôtes différents (le worker assemble les œuvres à partir des PNG écrits par le web).

## Déploiement (Docker)

```bash
cp .env.example .env.production   # renseigner DATABASE_URL, APP_URL, secrets, S3, Resend...
export DB_PASSWORD=...            # même mot de passe que dans DATABASE_URL
docker compose -f docker-compose.prod.yml up -d --build
```

`DATABASE_URL` doit pointer vers l'hôte `db`, par exemple `postgres://exquis:<DB_PASSWORD>@db:5432/exquis`. La base a un healthcheck (`pg_isready`) ; un service one-shot `migrate` applique les migrations, puis `web` (serveur Next.js standalone, `HOSTNAME=0.0.0.0`) et `worker` (tâches de fond) démarrent une fois la migration terminée. Les services redémarrent automatiquement (`unless-stopped`) et l'image s'exécute en utilisateur non-root `node`. Mettre un reverse proxy HTTPS devant le port 3000.

Remarque : le `Dockerfile` et `docker-compose.prod.yml` n'ont pas pu être exécutés lors de leur rédaction (pas de démon Docker disponible) ; seuls la sortie `standalone` et le démarrage de `node .next/standalone/server.js` ont été vérifiés.

### Santé et observabilité

`GET /api/health` renvoie `200` quand la base répond **et** que le worker a terminé un balayage `turn-sweep` il y a moins de 5 minutes ; sinon `503` avec un JSON `{db, worker, lastSweep}` (sans détail d'erreur ; il est journalisé côté serveur). Attention : il renvoie 503 tant que le worker n'a pas fait de balayage, ne pas conditionner le démarrage du worker à cette santé. À brancher sur la supervision (healthcheck, UptimeRobot, etc.). La journalisation se fait sur la sortie console (`docker compose logs`). Sentry est optionnel et n'est pas installé (il demande un compte et un DSN).

### Sauvegardes

Tâche cron quotidienne sur l'hôte :

```bash
0 3 * * * cd /chemin/vers/exquis && docker compose -f docker-compose.prod.yml exec -T db pg_dump -U exquis exquis | gzip > backup-$(date +\%F).sql.gz
```

Penser à sauvegarder aussi le bucket S3 (ou `.storage` en stockage local) et à tester régulièrement une restauration.

## Tests

```bash
npm test               # Vitest ; nécessite PostgreSQL (base exquis_test)
npm run typecheck
npm run lint
npx playwright install chromium   # une fois
npx playwright test    # ou : npm run e2e
```

Le test de bout en bout (`e2e/text-game.spec.ts`, partie de texte à deux joueurs) démarre `npm run dev` via Playwright, lit `.env.local` et force `REQUIRE_EMAIL_VERIFICATION=false`. Il utilise la **base de développement** (migrée au préalable) : les comptes et la partie créés restent en base, avec des noms et emails uniques par exécution.

## Apparence

L'interface suit la direction visuelle « Manifeste » (affiche surréaliste des années 1920 : aplats, bordures noires de 2 px, ombres dures, titres en Abril Fatface, accents moutarde et vert canard, thème clair). Jetons, composants partagés et règles d'usage : [`docs/design/manifeste.md`](docs/design/manifeste.md).

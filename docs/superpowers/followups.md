# Suites à donner (issues des relectures)

Éléments identifiés pendant l'implémentation et volontairement reportés. Aucun n'est bloquant.

## À faire avant une ouverture publique
- Limiter le débit de `/api/register` (et revoir l'énumération d'emails en mode `REGISTRATION_MODE=open`).
- Refuser les secrets d'exemple (`change-me-…`) quand `NODE_ENV=production`.
- Migration `timestamp with time zone` (colonnes `defaultNow()` écrites dans le fuseau de la session Postgres).
- Outils de modération (voir spec §10) et `contribution.hidden_at` (aujourd'hui jamais lu).

## Déploiement
- Construire l'image et lancer `docker-compose.prod.yml` sur une machine avec Docker (jamais exécuté ici) ; vérifier `/api/health` → 200 après le premier balayage, volume `storage` accessible en écriture à l'utilisateur `node`.
- Tester l'éditeur au stylet / tactile et avec `STORAGE_DRIVER=s3` + CORS (non testés).
- Élaguer l'image runtime (devDependencies : `embedded-postgres`, Playwright).
- `playwright.config.ts` : `reuseExistingServer` et base de dev utilisée par l'e2e.
- Une seule instance de worker (outbox d'emails sans `FOR UPDATE SKIP LOCKED`).

## Robustesse / UX
- Un brouillon de dessin > 2 Mo reçoit un 413 sans retour à l'utilisateur.
- Autosave : flush ignoré si une sauvegarde est déjà en cours quand l'onglet se masque ; pas de flush au démontage.
- `game_completed` et `work_ready` envoient deux emails à la fin d'une partie.
- Délai de rappel réglable par l'utilisateur (spec §8) non implémenté ; limite de parties actives en constantes (spec : « configurable »).
- Limites par utilisateur (parties actives / créées par jour) : course possible entre vérification et insertion.
- Parties de dessin annulées avant ce correctif : pas de `final_work` (page « en cours d'assemblage »).
- Petits points de polish UI : `<a>` vs `Link` sur login, `game.status` affiché en anglais, trois `<h1>` sur l'accueil, `maxLength` du nom, type de notification inconnu dans l'inbox.

## Tests
- Contraintes d'unicité (`contribution.turn_id`, `notification.dedupe_key`) non testées directement ; tests d'invitations : chemin « compte créé puis erreur » non testé.
- Pas de test de course submit vs expiration sur le même tour.

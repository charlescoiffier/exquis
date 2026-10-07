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

## Issues des relectures du 2026-10-07 (retours utilisateur et redesign)

### Robustesse
- Le texte tapé n'est pas sauvegardé à l'arrêt de l'éditeur (le brouillon est enregistré toutes les 5 s) : une copie locale (localStorage) éviterait toute perte si la page d'erreur s'affiche.
- Si la lecture du tour échoue de façon inattendue pendant un rafraîchissement, l'éditeur est remplacé par « En attente… » jusqu'au sondage suivant (le texte non enregistré est perdu).
- Pas de `global-error.tsx` (erreurs de la mise en page racine).
- Aucun indice « connexion perdue » quand le sondage s'arrête alors qu'un envoi a échoué.
- Sondage : reprise après 6 échecs uniquement sur focus, retour réseau ou visibilité ; double rafraîchissement possible focus + visibilité.
- Export PNG : repli de réduction d'échelle au-delà de 16 millions de pixels non exercé ; estimation de largeur des libellés par nombre de caractères.
- Abandon d'un tour : purement côté client, le serveur ne remet le tour en jeu qu'à l'échéance + 60 s.

### Accessibilité et interface
- Jointures rouges (`#e11d48`) hors de la palette Manifeste ; traits d'accompagnement du PNG à faible contraste non textuel.
- Pas de repli `forced-colors` pour l'interrupteur ; pastilles de palette de 36 px (< 44 px) ; compte à rebours sans `role="timer"`.
- Partie d'un joueur : pas d'état de chargement dédié (un `loading.tsx` avait rendu l'e2e instable).
- Nombre d'inscrits non rafraîchi entre deux navigations (le sondage couvre accueil, partie et inbox).
- Thème sombre non fourni (Manifeste est clair uniquement).

### Tests
- Aller-retour `sessionStorage` des notices d'expiration, composants `AutoRefresh` / `TurnTitle` et garde HEAD `/favicon.ico` non testés.
- Chemins non exercés dans le navigateur : fenêtre d'expiration côté dessin, bouton « Abandonner », clic « Générer une invitation » et copie, inbox vide, reprise du serveur après échec réseau.
- Construire l'image Docker : toujours jamais exécuté (pas de démon Docker sur cette machine).

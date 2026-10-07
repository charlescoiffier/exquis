# Feuille de route : outils de dessin et fonctionnalités

Décisions du 7 octobre 2026. Ce document ordonne le travail ; chaque lot fera l'objet d'une courte spec puis d'un plan
avant le code.

## Outils de dessin (validés)

| Lot | Contenu | Remarques |
| --- | --- | --- |
| D1 Crayons | crayon fin, moyen, épais ; surligneur translucide (opacité constante sur le trait, pas de surcharge aux croisements) ; aérographe | Chaque trait garde `tool`, `size`, `opacity` dans l'opération. Surligneur : trait dessiné en une passe puis fusionné avec une opacité globale (aperçu : calque d'aperçu à opacité CSS, déjà en place). Aérographe : semis de points déterministe (graine stockée dans l'opération). |
| D2 Formes | ligne, rectangle, ovale ; contour ou rempli | Nouvelle opération `shape` (type, deux coins, contour/rempli, couleur, épaisseur). Aperçu sur le calque d'aperçu, redessiné à chaque image (coût constant). |
| D3 Tout effacer | bouton avec la modale `ConfirmDialog` | Opération `clear` dans l'historique : annulable. |
| ~~D4 Zoom et déplacement~~ | **Abandonné (décision du 8 octobre 2026).** Idée écartée : pincement et glisser à deux doigts, molette sur ordinateur. | Piste envisagée si la question revient : transformation CSS de l'enveloppe qui contient tous les calques (le canvas garde sa résolution), sans contexte de canvas désynchronisé, avec suivi manuel des pointeurs et tracé figé pendant un geste à deux doigts. Risques identifiés : conflit avec le zoom natif du navigateur, mémoire sur iOS. |

## Fonctionnalités

| Priorité | Lot | Contenu | État |
| --- | --- | --- | --- |
| 1 | C Commentaires | Sous les œuvres terminées : table `comment` (partie, auteur, texte, date), notification aux participants. | Fait |
| 1 | P Partage public | Lien public en lecture seule vers une œuvre terminée (jeton aléatoire révocable, page sans connexion, image et noms), vignette de prévisualisation. | Fait |
| 1 | T Thèmes | Thème facultatif à la création (champ `theme` sur la partie), bouton « au hasard » tirant dans une banque d'environ 100 thèmes, distincts pour le texte et le dessin ; affiché dans le bandeau et sur l'écran de tour. | Fait |
| 2 | R Rappels | Relance avant l'échéance d'un tour (délai configurable, par défaut 25 % du temps restant), par email et notification. | Fait (trois étapes programmées, choix du joueur dans « Mon compte ») |
| 2 | Pr Profils | Avatar géométrique imposé (formes et motifs fixes), couleur d'avatar et de fond choisies sur la palette, statistiques (parties jouées, terminées, tours joués, œuvres). | Fait |
| 3 | A Amis | Liste d'amis, invitations ciblées à une partie. | Fait (code ami, invitations ciblées) |
| 3 | M Modération | Signalement d'une œuvre ou d'un commentaire (table `report` déjà présente), file de traitement pour un rôle modérateur, masquage. | Fait (page « Modération », rôle `moderator`) |

## Questions à trancher (réponses par défaut proposées)

- Commentaires : réservés aux participants de la partie, ou à tout utilisateur connecté qui voit l'œuvre ? Par défaut :
  participants seulement, et lecture publique via le lien partagé uniquement si le créateur le choisit.
- Lien public : révocable et désactivé par défaut, activé par un participant ? Par défaut : le créateur de la partie
  l'active, tout participant peut le copier, le créateur peut le révoquer.
- Thèmes : le thème est-il visible de tous les joueurs ? Par défaut oui, dès la création.

## Ordre proposé

1. Diagnostic de la lenteur du dessin sur smartphone : fait (un seul canvas visible, 44 images/s contre 9 mesurées sur un Android ; mesures `?perf=1`).
2. Lots T, C et P : faits.
3. Outils D1 à D3 : faits. D4 (zoom et déplacement) est abandonné.
4. Lots R, Pr, A et M : faits.
5. À venir : déploiement, puis notifications sur téléphone (ci-dessous), puis éventuellement une application Android.

## À venir

### Déploiement sur un serveur dédié

Préalable aux notifications sur téléphone (le Web Push exige HTTPS). Étapes : un VPS Linux avec Docker (2 Go de RAM,
nom de domaine) ; PostgreSQL 16, l'application web et le worker (indispensable : expirations, rappels, emails,
purge) ; stockage compatible S3 à la place du disque (`STORAGE_DRIVER`, CORS décrit dans le README) ; variables
`APP_URL` en https, `BETTER_AUTH_SECRET` et `STORAGE_SECRET` aléatoires d'au moins 32 caractères,
`REQUIRE_EMAIL_VERIFICATION=true` ; fournisseur SMTP ; reverse proxy avec HTTPS automatique (Caddy) ; migrations
(`npm run db:migrate`) à chaque mise à jour ; sauvegardes quotidiennes de PostgreSQL et supervision du point de santé.

### Notifications sur téléphone

| Option | Principe | Avantages | Limites |
| --- | --- | --- | --- |
| **Web Push (recommandé)** | Navigateur et service worker, envoi depuis le serveur avec la bibliothèque `web-push` et des clés VAPID | Gratuit, sans compte tiers, un seul code pour Android et iOS | HTTPS obligatoire ; sur iPhone (iOS 16.4 minimum), seulement si l'application est ajoutée à l'écran d'accueil |
| Firebase Cloud Messaging (FCM) | Service Google, via une coque Android (Capacitor) ou le web | Livraison fiable sur Android, publication possible sur le Play Store | Projet Firebase à créer ; sur iOS, compte développeur Apple en plus (99 $ par an) |
| OneSignal ou Novu | Service qui gère les abonnements et plusieurs canaux (push, email) | Tableau de bord, peu de code | Dépendance à un tiers, données hors de chez nous |
| ntfy.sh ou Pushover | Application de notification dédiée, installée par chaque joueur | Très simple pour un petit groupe d'amis | Une application de plus à installer |
| Email | Déjà en place (Resend) | Aucun travail | Pas instantané |

**Mise en œuvre du Web Push dans le code**

1. Table `push_subscription` (compte, adresse du navigateur, clés) et routes pour s'abonner et se désabonner.
2. Manifeste et service worker (`public/sw.js`) : affichage de la notification, ouverture de la bonne partie au clic.
3. Interrupteur « Notifications sur ce téléphone » dans « Mon compte » (le navigateur ne demande l'autorisation qu'après un clic).
4. Envoi par le worker, comme pour les emails : nouveau canal sur les notifications existantes (« c'est votre tour »,
   rappel, œuvre prête…), avec suppression des abonnements expirés (réponse 410).
5. Génération des clés VAPID, ajoutées aux variables d'environnement.
6. Textes sobres (« C'est votre tour »), sans contenu de partie dans le message.

Test possible sur ordinateur avec `localhost` (contexte sécurisé) ; l'essai sur téléphone demande le déploiement ou un
tunnel HTTPS de test (par exemple Cloudflare Tunnel).

**Ordre conseillé** : déploiement en HTTPS, puis PWA avec Web Push (Android immédiatement, iOS pour ceux qui installent
l'application), puis éventuellement une coque Capacitor avec FCM pour le Play Store.

### Application Android

- **PWA** : manifeste et service worker pour installer l'application depuis Chrome Android ; réutilise presque tout le code ;
  les notifications Web Push fonctionnent. La moins coûteuse.
- **Coque Capacitor ou Trusted Web Activity** : le site emballé dans une application publiable sur le Play Store, avec
  notifications FCM ; compte développeur Google (25 $, une fois) et site en ligne d'abord.
- **Application native (Kotlin) ou React Native** : second projet à maintenir, avec une API mobile (authentification par
  jeton plutôt que par cookie) ; à n'envisager que si la PWA ne suffit pas.

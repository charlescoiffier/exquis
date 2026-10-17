# Cadavre exquis web : spécification de design

Date : 2026-10-06
Statut : à relire

## 1. Contexte et objectifs

Application web de cadavre exquis, dessiné ou textuel, pour utilisateurs inscrits. Les parties sont asynchrones : un joueur par tour, durée de tour de 30 secondes à 7 jours.

- Public initial : projet personnel / entre amis, **inscription sur invitation**.
- Évolution prévue : ouverture publique avec communauté et modération. Les choix coûteux à changer (modèle de données, filtrage serveur, rôles) sont faits dès la v1.

Critères de succès v1 :
1. Un utilisateur invité peut créer une partie de dessin ou de texte, la rejoindre, y jouer son tour et voir l'œuvre finale.
2. Aucun joueur ne peut accéder à plus que ce qui lui est destiné avant la fin de la partie.
3. Les tours non joués sont remis en jeu automatiquement.
4. Hébergeable pour quelques euros par mois.

Hors périmètre v1 : modération active (outils d'interface), Web Push, démarrage anticipé d'une partie, formes géométriques et palette étendue dans l'éditeur, application mobile native.

## 2. Règles de jeu

- Une partie compte 2 à 8 participants, un participant par tour, donc autant de tours que de participants.
- Types : `drawing` ou `text`.
- Paramètres choisis à la création : nom, type, nombre de tours, durée d'un tour (30 s à 7 jours), visibilité (`public` dans la liste ou `invite` par lien), et :
  - dessin : sens de défilement ;
  - texte : langue, minimum et maximum de mots, taille de l'extrait transmis (dernier paragraphe ou X derniers mots).
- La partie démarre lorsqu'elle est pleine. L'ordre de jeu est tiré au sort au démarrage.
- Pendant la partie, un joueur ne voit que la bande (dessin) ou l'extrait (texte) du tour précédent, sans connaître l'auteur.
- À la fin, tous les participants voient l'œuvre entière et les auteurs sont révélés.
- Un joueur peut participer à plusieurs parties à la fois, avec une limite configurable (8 parties actives par défaut). Un joueur peut quitter une partie : en attente, il se désinscrit ; en cours, ses tours à venir deviennent des appels à participation et ses contributions déjà envoyées restent dans l'œuvre.
- Les œuvres finales sont privées (participants uniquement) par défaut. Les participants pourront ensuite les rendre publiques.

## 3. Pile technique

- TypeScript monolithique : Next.js ou SvelteKit (choix final au démarrage du plan d'implémentation), un seul dépôt.
- PostgreSQL avec Drizzle ou Prisma (migrations versionnées).
- Authentification : Better Auth (ou Auth.js), email + mot de passe (argon2) et connexion Google. Vérification de l'email.
- Stockage objet compatible S3 (Cloudflare R2 ou Backblaze B2), **privé**, accès par URL signées de courte durée.
- Jobs et minuteurs : pg-boss ou Graphile Worker (pas de Redis).
- Traitement d'images : `sharp`.
- Email : Resend. Suivi d'erreurs : Sentry.
- Déploiement : Docker, deux processus (application web et worker), sur un VPS ou Fly.io.

## 4. Modèle de données

- `user` : identité, rôle (`player` ou `moderator`), préférences de notification, date d'invitation/inscription.
- `invitation` : code ou jeton, créé par, utilisé par, expiration. Sert à l'inscription sur invitation.
- `game` : créateur, nom, type, nombre de tours, durée de tour, sens de défilement, langue, paramètres texte, visibilité, statut (`open`, `in_progress`, `completed`, `cancelled`).
- `participant` : partie, utilisateur, rang (tiré au démarrage), `left_at` (joueur ayant quitté la partie : ses contributions restent).
- `turn` : partie, rang, participant assigné (nul pendant un appel à participation), `deadline`, statut (`pending`, `active`, `done`, `expired`, `open_call`), nombre de tentatives.
- `contribution` : tour, texte ou clé de l'image, clé de la bande de transition, date, `hidden_at` (pour la modération future). Une contribution par tour.
- `draft` : tour, liste de traits (JSON) ou texte en cours, date de mise à jour.
- `notification` : utilisateur, type, partie (facultative), personne à l'origine (`actor_id`), tour, lue ou non, clé de déduplication unique.
- `profile` : rôle, préférence d'email, moment du rappel (`reminder_stage`), avatar (forme, couleur, fond), code ami.
- `comment`, `friendship`, `game_invitation` : voir « Compléments du 2026-10-08 ».
- `report` : cible (commentaire ou œuvre), motif, précisions, auteur du signalement, statut, modérateur et date de traitement.
- `final_work` : partie, clé de l'image assemblée, positions des jointures, date de génération.

## 5. Cycle de vie d'une partie

`open` → `in_progress` → `completed`. `cancelled` possible depuis `open` et en cas d'échecs répétés sur un tour qui n'est pas le dernier.

1. À la prise du dernier siège : tirage de l'ordre, tour 1 `active` avec échéance, job d'expiration et rappel planifiés, joueur notifié.
2. À la soumission : tour `done`, tour suivant `active` avec son échéance et ses jobs, joueur suivant notifié.
3. À l'échéance : le job passe le tour à `expired`. Le tour est **remis en jeu** : un autre inscrit qui n'a pas encore joué est assigné, avec une nouvelle échéance.
4. Plafond de remises en jeu par tour : 2. Au-delà, si des tours restent en attente, la partie est `cancelled` et les contributions déjà faites restent visibles aux participants.
5. **Dernier tour expiré** : la partie n'est pas annulée. Le tour passe en `open_call` (appel à participation, sans joueur assigné ni échéance). La partie apparaît en tête de la liste « Parties à rejoindre », avec l'étiquette « 📢 À rejoindre » et une carte de couleur distincte. Tout utilisateur non participant peut reprendre le tour (nouvelle échéance, ajout comme participant). Si le volontaire laisse aussi expirer, l'appel est relancé, sans limite de tentatives.
6. Après le dernier tour `done` : partie `completed`, œuvre finale assemblée.

## 6. Flux de tour et filtrage serveur

Principe : le client ne reçoit jamais l'œuvre en cours. `GET /games/:id/my-turn` renvoie uniquement ce que le joueur a le droit de voir, après vérification que le tour lui est assigné, qu'il est `active` et que l'échéance n'est pas dépassée.

### Dessin
- Canvas de taille fixe (ex. 1200×1600 px). Tour 1 : une ligne pointillée à 90 %. Tours intermédiaires : lignes à 10 % et 90 %. Dernier tour : une ligne à 10 %.
- Le serveur stocke le PNG complet de chaque contribution dans le stockage privé, puis génère avec `sharp` la **bande de transition** (environ 10 %), stockée à part. Seule cette bande est transmise au joueur suivant (URL signée de courte durée). Le sens de défilement détermine l'origine de la bande.
- La logique de découpe est isolée dans un module unique (`strip`), testé avec des images fixtures.
- Validation à la soumission : dimensions exactes, type MIME, taille maximale, et ~~intégrité de la zone héritée~~ (supprimée : voir « Révisions du 2026-10-07 »).

### Texte
- Le serveur calcule l'extrait (dernier paragraphe ou X derniers mots) et ne renvoie que celui-ci.
- Le nombre de mots est validé entre minimum et maximum. Comptage identique côté client (aide) et serveur (référence). Texte nettoyé, sans HTML.

### Soumission et concurrence
- Transaction unique : vérification du statut du tour, insertion de la contribution, tour `done`, activation du suivant, planification des jobs. Verrou de ligne sur `turn` pour éviter la course avec l'expiration.
- Le job d'expiration revérifie l'état à l'exécution (idempotent).
- Soumission acceptée avec une ~~tolérance de quelques secondes~~ **fenêtre de validation de 60 s** (voir « Révisions du 2026-10-07 ») après l'échéance tant que le job n'a pas encore marqué le tour `expired`.

### Œuvre finale
- À `completed`, le serveur assemble l'œuvre en une image unique **propre** (zones héritées retirées, sans guides), la met en cache et conserve les segments.
- Le serveur enregistre les positions des jointures dans `final_work`.
- L'affichage propose un interrupteur « Afficher les jointures » : un calque SVG pointillé est superposé, sans modifier l'image.
- L'export PNG accepte `?guides=1`. Les deux variantes sont générées à la demande et mises en cache.
- Les guides pointillés ne sont jamais incrustés dans les images stockées.
- Texte : concaténation des contributions avec les auteurs révélés.

## 7. Éditeur de dessin (client)

- Canvas HTML5 en trois calques :
  1. bande héritée, ~~lecture seule~~ repeignable (voir « Révisions du 2026-10-07 ») ;
  2. calque de dessin, éditable, seul envoyé au serveur ;
  3. calque de guides (lignes pointillées), visuel et exclu de l'export.
- Pointer Events (souris, tactile, stylet avec pression). Traits lissés par courbes quadratiques (sans bibliothèque). Canvas maison, pas de bibliothèque de scène (tldraw, Konva, Fabric).
- Outils : crayon (fin, moyen, épais), surligneur, aérographe, gomme, pot de peinture, formes (ligne, rectangle, ovale), annuler/rétablir, tout effacer (voir « Compléments du 2026-10-07 »). Le zoom et le déplacement du canvas, prévus à l'origine, sont abandonnés (décision du 8 octobre 2026).
- Les traits sont conservés sous forme de liste d'opérations (annulation fiable). Le PNG est rasterisé à la soumission. Pendant le geste, le tracé est dessiné directement sur le canvas visible (voir « Compléments du 2026-10-08 »).
- Brouillon sauvegardé automatiquement (JSON, toutes les quelques secondes), repris tant que l'échéance n'est pas dépassée, supprimé à la soumission.
- Compte à rebours visible avec avertissement proche de l'échéance.

## 8. Notifications

- Événements : partie démarrée, « c'est ton tour », rappel avant l'échéance (à la moitié, au quart ou au dixième du temps restant selon la préférence du joueur ; aucun rappel sous 2 minutes), tour remis en jeu, partie terminée, œuvre prête.
- Canaux v1 : email et boîte de réception dans l'application. Web Push reporté.
- Les rappels sont des jobs planifiés avec le job d'expiration, annulés à la soumission.
- Préférences utilisateur : désactiver l'email, choisir le moment du rappel (ou aucun).
- Notifications dans l'application seulement (jamais par email) : commentaires, demandes d'ami, invitations, décisions de modération.
- Pour les tours très courts, seule l'alerte dans l'application s'applique ; aucun email n'est envoyé si la durée du tour est inférieure à 5 minutes.

## 9. Sécurité et autorisations

- Sessions en cookie `HttpOnly`, `Secure`, `SameSite=Lax`, protection CSRF sur les mutations.
- **Inscription sur invitation** : un code ou lien d'invitation est requis. Un réglage de configuration permet d'ouvrir les inscriptions plus tard. Les parties `invite` sont rejointes via un jeton signé et expirant.
- Fonctions de contrôle d'accès uniques côté serveur : `canViewTurn`, `canSubmit`, `canViewFinal`. Aucun accès direct au stockage depuis le client, uniquement des URL signées de quelques minutes.
- Limites de débit : inscription, connexion, création de parties, soumission. Limites de parties actives et de parties créées par jour.
- Taille maximale des PNG et des textes, validation stricte des entrées, échappement à l'affichage.

## 10. Modération

- Exposée : rôle `moderator`, bouton « Signaler » sur les commentaires et les œuvres, page « Modération », masquage (voir « Compléments du 2026-10-08 »). La colonne `contribution.hidden_at`, prévue à l'origine, n'est pas utilisée : le masquage porte sur le commentaire ou l'œuvre entière.
- Plus tard : bannissement, floutage, détection automatique de contenu explicite.
- Ouverture publique : mentions légales, conditions d'utilisation, RGPD (export et suppression de compte, avec anonymisation des contributions plutôt que suppression).

## 11. Déploiement et exploitation

- Deux conteneurs Docker : application web et worker de jobs (même code).
- PostgreSQL avec sauvegardes quotidiennes, stockage objet R2 ou B2, secrets par variables d'environnement, environnement de préproduction minimal.
- Journalisation structurée, Sentry, page d'état vérifiant que les jobs tournent.
- Budget visé : quelques euros par mois.

## 12. Stratégie de test

- Unitaires : machine à états, découpe de bande, composition de la retouche de la bande héritée (voir § 14), comptage de mots, calcul de l'extrait texte.
- Intégration : soumission et expiration concurrentes, remise en jeu, plafond de tentatives, règles d'autorisation (un joueur ne lit pas l'œuvre en cours, ne soumet pas hors de son tour, ne lit pas une œuvre non terminée).
- Bout en bout (peu nombreux) : inscription sur invitation, créer, rejoindre, jouer, révéler.

## 13. Questions laissées à la phase de plan

- Choix final Next.js ou SvelteKit, Drizzle ou Prisma, Better Auth ou Auth.js, pg-boss ou Graphile Worker.
- Dimensions exactes du canvas et couleurs/outils de la palette v1.
- ~~Valeur exacte de la tolérance après l'échéance~~ : fixée à 60 s de fenêtre de validation (voir § 14).

## 14. Révisions du 2026-10-07

Ces révisions remplacent les règles correspondantes ci-dessus.

| Règle d'origine | Règle révisée |
|---|---|
| Intégrité de la zone héritée vérifiée à la soumission (§ 6, Dessin) ; bande héritée en lecture seule (§ 7) | Le joueur peut repeindre la bande du prédécesseur : plus de contrôle d'intégrité, et l'assemblage final compose la retouche par-dessus. |
| Tolérance de quelques secondes après l'échéance (§ 6, Soumission) | Fenêtre de validation de 60 s après l'échéance, avec une fenêtre de confirmation côté client (marge de sécurité avant la coupure serveur). |
| Nombre de mots (§ 6, Texte) | Un mot est un jeton contenant au moins une lettre ou un chiffre. |
| Extrait du texte précédent (§ 6, Texte) | Un paragraphe est chaque ligne non vide ; en mode paragraphe, l'extrait est la dernière ligne contenant un mot, limitée à 150 mots. |
| Nom de partie obligatoire | Le titre est facultatif : un nom est généré lorsqu'il est laissé vide. |
| Mise à jour de la page de partie à la demande | Rafraîchissement automatique toutes les 5 s (en pause onglet masqué, reprise au focus et au retour du réseau). |
| Habillage visuel | Design « Manifeste », thème clair uniquement (voir docs/design/manifeste.md). |

### Compléments du 2026-10-07 (ajustements d'interface)

| Règle d'origine | Règle révisée |
|---|---|
| Canvas de 1200×1600 (vertical) ou 1600×1200 (horizontal) | Zone carrée de 1600×1600 pour les deux sens ; la bande de transition reste de 160 px. |
| Bande héritée repeinte librement | Le joueur peut dessiner par-dessus la bande du prédécesseur mais ne peut pas l'effacer : la gomme n'agit que sur ses propres traits et le pot de peinture ne remplit jamais la bande. |
| Tours sans nom | Intitulés de tours facultatifs à la création (tête, corps, jambes…), affichés sur l'éditeur, la page de partie et l'œuvre. |
| Durées proposées : 30 s, 5 min, 1 h, 1 jour, 1 semaine | 1 min, 5 min, 15 min, 1 h, 1 jour, 1 semaine (le serveur accepte toujours de 30 s à 7 jours). |
| Langue saisie en code (fr, en) | Langue choisie dans une liste : Français ou Anglais. |
| Listes de parties sur l'accueil et boîte « Avis » | L'accueil montre « Mes parties en cours » (tour à jouer d'abord, bouton « À vous de jouer ! » avec le temps restant) et les parties à rejoindre (appels à participation en tête), 8 par page, les plus récentes d'abord ; chaque carte porte une étiquette d'état à droite (« En cours », « À rejoindre », « Terminée »…). Les parties terminées ou annulées sont dans « Mon compte » (8 par page, les plus récentes d'abord) et un clic mène directement à l'œuvre. Chaque liste indique le créateur, le nombre de joueurs (dessinateurs ou écrivains) et la langue. |
| Boîte de réception « Avis » | Renommée « Notifications » ; la déconnexion, le nom affiché, la préférence d'email et la génération d'invitations sont dans la page « Mon compte ». |
| Œuvre finale | Rappel de la partie (créateur, dates, participants, nombre de tours, durée, langue) ; présentation des auteurs unifiée entre dessin et texte (trait de couleur fin et nom) ; jointures du dessin plus discrètes ; plus de liste « Auteurs » sous l'œuvre. |
| Thème de partie | Champ facultatif `game.theme` (120 caractères), saisi à la création avec un bouton « Au hasard » qui tire dans une banque d'environ 100 thèmes (50 texte, 50 dessin, distincts). Affiché dans le bandeau de la partie, pendant le tour, dans les listes et sur la page de l'œuvre. |
| Outils de dessin | Crayon (fin 3 px, moyen 8 px, épais 20 px), surligneur (opacité 40 % appliquée une fois au trait entier), aérographe (grains déterministes à partir d'une graine, répartis par pas le long du geste), gomme, pot de peinture, formes (ligne, rectangle, ovale ; contour ou remplie) et « tout effacer » (opération `clear` annulable, confirmation par modale). Le trait est lissé par courbes quadratiques ; l'aperçu en direct est incrémental et identique au résultat final. Le zoom et le déplacement du canvas sont abandonnés. |
| Amis et invitations ciblées | Tables `friendship` (une ligne par paire, `pending` puis `accepted`) et `game_invitation` ; code ami dans `profile.friend_code` (8 caractères sans ambiguïté) ; notifications `friend_request`, `friend_accepted`, `game_invite` (`notification.game_id` devient facultatif, `actor_id` désigne la personne à l'origine). Une invitation ciblée donne accès à une partie sur invitation (vue, inscription, reprise d'un tour). |
| Modération et signalement | Table `report` (cible `comment` ou `work`, motif, précisions, un signalement par personne et par cible), rôle `profile.role = moderator`, masquage par `comment.hidden_at` / `game.hidden_at` (le lien public d'une œuvre masquée est retiré), notifications `comment_hidden` et `work_hidden`. |

### Compléments du 2026-10-08

| Règle d'origine | Règle révisée |
|---|---|
| Œuvre visible des seuls participants | Le créateur d'une partie terminée peut activer un **lien public** en lecture seule (`game.public_token`, 24 octets aléatoires, révocable ; la réactivation crée un nouveau lien). La page `/p/[token]` et l'image `/api/public/[token]/image` s'ouvrent sans compte, sans les commentaires ; l'afficheur propose « jointures et noms » comme pour les participants. |
| Pas de commentaires | Table `comment` : les participants commentent une œuvre terminée (500 caractères, suppression par l'auteur) ; les autres participants sont notifiés dans l'application. |
| Rappel unique à 75 % du temps écoulé | Le worker programme trois rappels par tour (50, 25, 10 % du temps restant) ; seul celui qui correspond à `profile.reminder_stage` envoie une notification (0 : aucun). Défaut : 25 %. |
| Profil limité au nom et à l'email | Avatar géométrique : 12 formes imposées, 8 couleurs de palette pour la forme et le fond (différentes), avatar par défaut dérivé du compte ; statistiques (parties jouées, terminées, en cours, créées, tours, dessins, textes, commentaires). |
| Pas d'amis | Code ami (`profile.friend_code`), table `friendship` (une ligne par paire, `pending` puis `accepted`, demandes croisées acceptées d'office), ajout par code ou depuis les joueurs rencontrés ; aucun annuaire. Table `game_invitation` : un participant invite ses amis à une partie en attente ; l'invitation donne accès à une partie sur invitation. `notification.game_id` devient facultatif. |
| Pas de signalement | Table `report` (cible `comment` ou `work`, un signalement par personne et par cible). Un modérateur masque (`comment.hidden_at`, `game.hidden_at` avec retrait du lien public) ou rejette ; les personnes concernées sont notifiées. Rôle donné par `npm run role`. |
| Quitter une partie impossible | Un participant quitte une partie : en attente, il est désinscrit (partie annulée s'il était le dernier) ; en cours, ses tours à venir sont libérés, son tour actif devient un appel à participation, ses contributions restent (`participant.left_at`). Une partie sans joueur restant est annulée. |
| Parties abandonnées conservées | Chaque heure, le worker supprime les parties jamais lancées et celles en cours sans activité depuis 7 jours (démarrage, tour joué ou brouillon enregistré). Limite portée à 8 parties actives par joueur. |
| Aperçu du tracé sur des calques superposés | Un seul canvas visible : le crayon opaque et l'aérographe ajoutent les nouveaux points ; le crayon translucide, le surligneur, la gomme et les formes restaurent la zone touchée depuis une copie du canvas puis se redessinent en une passe. Mesure sur un smartphone Android : 44 images/s contre 9 avec des calques d'aperçu. `?perf=1` affiche et envoie des mesures de fluidité. |
| Copie dans le presse-papiers par l'API moderne | Repli sur une copie via un champ temporaire hors contexte sécurisé (essai en HTTP sur le réseau local). |
| Zoom et déplacement du canvas | Abandonnés (voir la feuille de route). |

### Compléments du 2026-10-17

| Règle d'origine | Règle révisée |
|---|---|
| Inscription sur invitation (`REGISTRATION_MODE=invite` par défaut) | Inscription libre par défaut (`open`) ; la page d'inscription ne demande un code qu'en mode `invite`. L'outil de génération d'invitations d'inscription est retiré de « Mon compte » (le script `create-invite.ts` reste pour le mode `invite`). Vérification d'adresse : valeur explicite de `REQUIRE_EMAIL_VERIFICATION`, sinon exigée seulement si un service d'email est configuré. |
| Emails par Resend uniquement ; échec silencieux sans clé | SMTP (`SMTP_HOST`…) ou Resend, `MAIL_FROM` ; le worker ne déclare plus « envoyés » des emails qui n'ont fait que passer dans les journaux (ils restent en attente, 24 h au plus) ; erreur Resend détaillée ; `npm run mail:test` ; `/api/health` indique le service utilisé. |
| Canal d'email seul | Choix du canal dans « Mon compte » : email, téléphone, les deux ou aucune (`profile.email_enabled` et `profile.notify_push`). **Web Push** : table `push_subscription` (un compte, plusieurs appareils), service worker `public/sw.js`, manifeste d'application installable, clés VAPID (`npm run vapid`), envoi par le worker (`notification.push_pending` / `pushed_at`, abandon au-delà de 24 h, oubli des abonnements périmés 404/410), notification de test. Hors HTTPS ou sur iPhone non installé : message d'explication. |
| Administration absente | Rôle `admin` (ou `ADMIN_EMAILS`), qui inclut la modération : liste et recherche des inscrits, passage en modérateur, suppression d'un compte (données personnelles effacées, places libérées, contributions et commentaires conservés sous « Compte supprimé »), toutes les œuvres terminées avec leurs commentaires (suppression d'un commentaire ou de l'œuvre et de ses images), signalements. |
| Zoom et déplacement du canvas abandonnés (2026-10-08) | Zoom ajouté pour le téléphone : pincement à deux doigts (×1 à ×5), déplacement à deux doigts, boutons « − », « + » et « Vue entière » ; transformation CSS de la scène (canvas et guides), sans coût de dessin ; un deuxième doigt pendant un trait l'annule. |
| Quitter une partie à tout moment | Impossible après y avoir joué. |
| Liste « Parties à rejoindre » | Exclut les parties où l'on a une invitation (elles sont dans « Invitations reçues ») ; une partie en attente indique combien de joueurs manquent ; « Créer une partie » en bas de page. |
| Texte final sans repère des phrases communes | Avec « Afficher les noms des auteurs », la partie transmise de chaque contribution (vue par l'auteur suivant) est un peu plus claire. |
| Pluriels | Accord à la française par `plural()` : 0 et 1 au singulier (statistiques, compteurs). |
| Session PostgreSQL | Fuseau UTC imposé à la connexion : les colonnes `timestamp` alimentées par `now()` sont lues de la même façon quel que soit le fuseau du serveur. |
| Mot de passe masqué | Bouton « Afficher / Masquer » sur les champs de mot de passe (connexion, inscription). |
| Mention « invitation requise » toujours affichée | Affichée seulement si `REGISTRATION_MODE=invite`. |
| Comptes existants bloqués par la vérification d'adresse | Validation des adresses par script (`npm run verify-users`) ou depuis « Administration » (par compte ou toutes d'un coup) ; renvoi de l'email de confirmation depuis la page de connexion. |
| Administration accessible depuis « Mon compte » | Onglet « Admin » dans le menu principal, visible des seuls administrateurs (badge : signalements à traiter) ; la modération est accessible depuis cette page. Les modérateurs non administrateurs gardent un lien dans « Mon compte ». |
| Listes de parties : seul le nombre d'inscrits | Les parties en attente de joueurs (listes, invitations reçues, page de la partie) indiquent aussi les noms des inscrits, par ordre d'inscription ; une fois la partie lancée, seuls ses participants voient les noms de leurs co-joueurs (« Mes parties en cours », page de la partie) ; les autres, y compris dans les appels à participation, ne les voient qu'avec l'œuvre finale. |

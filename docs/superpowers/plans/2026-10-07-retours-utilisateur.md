# Retours utilisateur (2026-10-07) : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corriger et compléter l'application après les premiers essais : mises à jour automatiques, règles de texte, mode dessin, titre facultatif. Le redesign visuel fait l'objet d'un plan séparé, après choix d'une piste.

**Architecture:** Même monolithe Next.js. Les règles métier restent dans `src/lib/**` (testées sur la vraie base) ; les composants client reprennent les conventions existantes (fetch durcis, `busy` remis à zéro sur tout échec).

**Tech Stack:** inchangée (Next.js 15, Drizzle/PostgreSQL, pg-boss, sharp, Vitest, Playwright).

**Spec:** `docs/superpowers/specs/2026-10-06-cadavre-exquis-design.md` (complétée par les décisions ci-dessous).

## Décisions (rulings du contrôleur, issues des retours)

- Un **mot** est un jeton séparé par des espaces qui contient au moins une lettre ou un chiffre Unicode (`\p{L}` ou `\p{N}`). La ponctuation seule et les emoji seuls ne comptent pas.
- Un **paragraphe** est chaque ligne non vide : chaque saut de ligne sépare deux paragraphes. Le plafond de 150 mots sur l'extrait en mode « dernier paragraphe » reste.
- Le **délai de validation après l'échéance** passe de 5 s à **60 s** (`SUBMIT_GRACE_MS`), avec une fenêtre de confirmation côté joueur. Les jobs d'expiration partent à `deadline + SUBMIT_GRACE_MS`.
- Le joueur peut **dessiner par-dessus la bande héritée**. Le serveur ne vérifie plus l'intégrité de cette bande (les dimensions et le format restent vérifiés). L'assemblage superpose la bande retouchée de chaque tour à l'emplacement de la bande sortante du tour précédent. La bande transmise au joueur suivant reste la seule partie de l'image qu'il reçoit.
- L'**export PNG** de l'œuvre finale est calculé **dans le navigateur** (canvas) pour refléter l'option « Afficher avec jointures et noms » ; les routes serveur `guides=1` restent.
- Le **titre de la partie** (champ `name`) devient facultatif ; s'il est vide, il est généré : « Texte de <nom du créateur> » ou « Dessin de <nom du créateur> ».
- Le rafraîchissement automatique est un **sondage** (`router.refresh()` toutes les 5 s, en pause quand l'onglet est masqué, immédiat au retour de focus).

## Global Constraints

- Les messages de commit se terminent par `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Tests Vitest sur la vraie base PostgreSQL ; la suite complète (`npx vitest run`), `npm run typecheck`, `npm run lint` et `npm run build` doivent passer à la fin de chaque tâche.
- Aucun joueur ne reçoit jamais plus que la bande sortante (dessin) ou l'extrait (texte) du tour précédent avant la fin de la partie.
- Interface en français ; libellés existants conservés quand ils ne sont pas explicitement changés (le test e2e Playwright s'appuie sur eux : « Nom de la partie » devient « Titre de la partie (facultatif) » et l'e2e doit être mis à jour en conséquence).
- Les composants client suivent les conventions existantes : `res.json().catch(() => ({}))`, try/catch autour des fetch, `busy` remis à zéro sur tout échec, message de repli en français.

## Review Focus

1. Un texte fait uniquement de ponctuation ou d'emoji compte 0 mot et est refusé en dessous du minimum.
2. Un texte avec un seul saut de ligne simple transmet bien uniquement la dernière ligne.
3. Une soumission de dessin arrivée après `deadline + 60 s` est refusée avec un message compréhensible ; l'éditeur ne montre plus l'ancien brouillon quand le tour est reparti à quelqu'un d'autre.
4. Un dessin repeint dans la bande héritée est accepté, et l'œuvre assemblée montre la retouche à l'emplacement de la jointure.
5. Le rafraîchissement automatique ne réinitialise ni le texte en cours, ni le dessin en cours, ni le brouillon.

---

### Task 1: Règles de texte (mot, paragraphe) et titre facultatif

**Files:**
- Modify: `src/lib/domain/text.ts`, `src/lib/domain/game-rules.ts`, `src/lib/services/games.ts` (génération du titre), `src/components/NewGameForm.tsx`, `src/app/api/games/route.ts` si nécessaire, `e2e/text-game.spec.ts`
- Test: `tests/domain/text.test.ts`, `tests/domain/game-rules.test.ts`, `tests/services/games.test.ts`

**Interfaces:**
- Produces: `countWords(text)` (nouvelle définition), `extractExcerpt(text, rule)` (paragraphe = ligne non vide), `transmittedRange(text, rule): { start: number; end: number }` (indices de caractères de la partie transmise dans `text` ; `start === end` si rien n'est transmis) utilisée par l'éditeur (Task 4) pour griser le reste ; `createGame` accepte `name` absent ou vide et génère le titre ; le schéma `gameParamsSchema` rend `name` facultatif (0 à 80 caractères après trim).

- [ ] **Step 1:** Écrire les tests (RED) : `countWords("Bonjour , monde !")` = 2 ; `countWords("... — !!")` = 0 ; `countWords("🎄 🎄")` = 0 ; `countWords("été à Noël 🎄 ok")` = 4 ; `countWords("l'été, c'est-à-dire")` = 2 ; `extractExcerpt("a\nb\nc", {mode:"paragraph"})` = `"c"` ; lignes vides ignorées ; mode `words` inchangé ; plafond de 150 mots conservé ; `transmittedRange` : texte à 3 lignes → plage de la dernière ligne ; mode `words` count=2 → plage couvrant les deux derniers mots (début au premier de ces mots, fin à la fin du dernier mot) ; texte vide → `{start:0,end:0}` ; `createGame` sans nom → titre généré pour un texte et pour un dessin (avec le nom du créateur), avec nom → conservé, nom d'espaces → généré.
- [ ] **Step 2:** Lancer les tests : FAIL attendu.
- [ ] **Step 3:** Implémenter. Le titre généré utilise le nom de l'utilisateur (table `user`) ; il est stocké dans `game.name` (colonne inchangée, toujours non nulle).
- [ ] **Step 4:** Formulaire : le champ devient « Titre de la partie (facultatif) », sans `required`, avec un `placeholder` indiquant le titre qui sera généré ; clarifier les libellés « Mots minimum » / « Mots maximum » en gardant ces deux libellés comme début de texte (le e2e s'en sert) et en ajoutant une aide : « Longueur de chaque contribution, en mots. Le joueur doit écrire entre ces deux valeurs. » ; mettre à jour `e2e/text-game.spec.ts` (nouveau libellé du titre).
- [ ] **Step 5:** Suite complète + typecheck + lint, puis commit.

### Task 2: Mise à jour automatique des pages

**Files:**
- Create: `src/components/AutoRefresh.tsx`, `src/components/TurnTitle.tsx` (ou équivalent pour le titre d'onglet)
- Modify: `src/app/page.tsx` (accueil), `src/app/games/[id]/page.tsx`, `src/app/inbox/page.tsx`
- Test: logique pure du sondage dans `src/lib/hooks/auto-refresh.ts` + `tests/hooks/auto-refresh.test.ts`

**Interfaces:**
- Produces: `<AutoRefresh intervalMs={5000} />` composant client qui appelle `router.refresh()` à intervalle fixe, se met en pause quand `document.visibilityState === "hidden"`, rafraîchit au retour de focus/visibilité, ne lance jamais deux rafraîchissements simultanés, nettoie ses timers au démontage.

- [ ] **Step 1:** Extraire la logique (planification, pause, retour au premier plan) dans une fonction pure testable avec horloge et document injectés ; tests (RED) : appels à intervalle, pause en arrière-plan, reprise avec rafraîchissement immédiat, pas de chevauchement.
- [ ] **Step 2:** Implémenter le composant et l'ajouter : accueil, page de partie (dans tous les états sauf `completed` et `cancelled`), boîte de réception.
- [ ] **Step 3:** Titre de l'onglet : quand c'est le tour du joueur (accueil : au moins une partie avec `isMyTurn` ; page de partie : tour actif), `document.title` devient « (1) C'est votre tour · Exquis » ; sinon « Exquis » ; remis à l'état normal au démontage.
- [ ] **Step 4:** Vérifier que le rafraîchissement ne réinitialise pas l'éditeur de texte ni l'éditeur de dessin en cours (les composants client gardent leur état tant que leur `key` ne change pas ; `TurnEditor` reçoit une `key` basée sur `turnId`) : à vérifier dans le navigateur avec deux comptes (joueur 1 rejoint, la partie démarre chez le joueur 2 sans rechargement manuel ; fin de tour de l'autre joueur détectée).
- [ ] **Step 5:** Suite complète + typecheck + lint + build, puis commit.

### Task 3: Éditeur de texte (jauge, grisage) et affichage du texte final

**Files:**
- Modify: `src/components/TextTurn.tsx`, `src/components/NewGameForm.tsx` (libellés si besoin), `src/app/games/[id]/final/page.tsx`
- Create: `src/components/FinalText.tsx`
- Test: `tests/domain/text.test.ts` (complément éventuel pour `transmittedRange`)

**Interfaces:**
- Consumes: `countWords`, `transmittedRange`, `extractExcerpt` (Task 1).
- Produces: `TextTurn` reçoit en plus la règle d'extrait (`excerptMode`, `excerptWords`) via `TurnEditor` (props sérialisées, pas de texte précédent supplémentaire) ; `FinalText({ contributions })`.

- [ ] **Step 1:** Jauge de progression : barre de 0 à `maxWords` avec repère du minimum, coche verte et texte « ✓ N mots, longueur suffisante » quand `min ≤ N ≤ max`, « Encore X mots pour atteindre le minimum » sous le minimum, « X mots en trop » au-dessus du maximum ; `aria-live="polite"` ; le bouton « Envoyer » reste désactivé hors bornes.
- [ ] **Step 2:** Grisage : sous le champ de saisie, la partie qui ne sera pas transmise est grisée et la partie transmise surlignée, en utilisant exactement `transmittedRange` (mêmes règles que le serveur). Technique : textarea à texte transparent superposé à une couche miroir de même police, mêmes marges et même défilement (synchroniser `scrollTop`), caret visible ; légende « non transmis / vu par le joueur suivant ». Si l'alignement miroir s'avère fragile, repli accepté : un aperçu juste sous le champ « Ce que le joueur suivant verra » (à justifier dans le rapport).
- [ ] **Step 3:** Texte final : `FinalText` affiche chaque contribution avec, à gauche, une ligne verticale colorée par auteur et le nom écrit verticalement le long du texte ; une case « Afficher les noms des auteurs » (cochée par défaut) masque tout le dispositif ; couleurs distinctes par auteur, contraste suffisant en thème clair et sombre ; mise en page responsive.
- [ ] **Step 4:** Vérification dans le navigateur (partie de texte à deux joueurs, saisie de plusieurs lignes, ponctuation seule, passage de seuil min/max, grisage cohérent avec ce que le second joueur reçoit réellement) ; suite complète + typecheck + lint + build ; commit.

### Task 4: Règles du dessin : repeindre la bande, délai de validation, brouillon fantôme

**Files:**
- Modify: `src/lib/access.ts` (`SUBMIT_GRACE_MS`), `src/lib/services/turns.ts` (suppression de la vérification d'intégrité de la bande héritée), `src/lib/images/strip.ts` (assemblage avec superposition de la bande retouchée), `src/components/DrawingEditor.tsx`, `src/components/TurnEditor.tsx`, `src/components/Countdown.tsx`
- Create: `src/components/ExpiryDialog.tsx`
- Test: `tests/images/strip.test.ts`, `tests/services/turns-drawing.test.ts`, `tests/services/turns-expiry.test.ts`, `tests/access.test.ts`, `tests/drawing/ops.test.ts`

- [ ] **Step 1 (RED):** Tests : (a) `submitDrawing` accepte une image dont la bande héritée a été repeinte (l'ancien test « zone héritée modifiée → refus » devient « acceptée ») mais refuse toujours un mauvais format / de mauvaises dimensions ; (b) `assembleDrawing` : avec une bande retouchée par le tour 2, le pixel retouché apparaît dans l'image finale à l'emplacement de la bande sortante du tour 1, pour les sens `down` et `right` ; sans retouche l'image est identique à avant ; (c) `SUBMIT_GRACE_MS` = 60 000 et les tests de bordure existants suivent la constante ; (d) l'éditeur : `isInsideOwnZone` autorise toute la surface (pointeur dans la bande héritée inclus) ; le remplissage n'est plus borné à la zone propre.
- [ ] **Step 2:** Implémenter côté serveur : retirer `inheritedZoneIntact` de la soumission (le garder exporté et testé s'il est utile ailleurs, sinon le supprimer proprement) ; l'assemblage superpose, pour chaque tour `i ≥ 2`, sa zone `inheritedRect` à la position de la bande sortante du tour `i-1` (offset de la zone propre du tour `i` moins `BAND_SIZE`), après la pose des zones propres.
- [ ] **Step 3:** Éditeur : plus de clip sur la zone propre ; dessin et remplissage sur toute la surface ; la bande héritée reste affichée comme fond (couche de base) et peut être repeinte ; la gomme repeint en blanc sur toute la surface (note dans le rapport : elle ne restaure pas la bande héritée, un annuler le fait).
- [ ] **Step 4:** Délai de validation : au passage de l'échéance, `ExpiryDialog` s'affiche (« Temps écoulé. Valider votre dessin maintenant ? » avec compte à rebours des 60 s restantes, boutons « Envoyer mon dessin » et « Abandonner ce tour »). Au bout des 60 s ou sur « Abandonner » : message « Le temps est écoulé, votre tour a été remis en jeu », vidage de l'état local de l'éditeur et rechargement de la page. Si l'envoi reçoit `not_your_turn`, même traitement (plus de simple erreur « Ce n'est pas votre tour »). Même comportement pour `TextTurn` (fenêtre « Temps écoulé. Envoyer votre texte maintenant ? »).
- [ ] **Step 5:** Brouillon fantôme : `TurnEditor` reçoit une `key` basée sur `turnId` et l'échéance (`deadline`) pour que l'état local ne survive jamais à une remise en jeu ; après expiration confirmée, le brouillon local du composant est vidé. Ajouter un test serveur : après remise en jeu, `getMyTurn` du joueur suivant ne renvoie pas le brouillon de l'ancien joueur (déjà couvert, le conserver) ; le comportement client est vérifié dans le navigateur (deux comptes, durée de tour 30 s : laisser expirer, observer la fenêtre puis le message ; vérifier qu'aucun ancien dessin ne réapparaît).
- [ ] **Step 6:** Suite complète + typecheck + lint + build ; vérification navigateur du dessin sur la bande ; commit.

### Task 5: Éditeur de dessin (couleur) et œuvre finale (noms, jointures, export)

**Files:**
- Modify: `src/components/DrawingEditor.tsx`, `src/components/FinalViewer.tsx`, `src/app/games/[id]/final/page.tsx`, `src/lib/services/final-work.ts` (fournir les segments par auteur : rang, nom, début et fin le long de l'axe), `src/lib/images/geometry.ts` (calcul des segments)
- Test: `tests/images/geometry.test.ts`, `tests/services/final-work.test.ts`

**Interfaces:**
- Produces: `authorSegments(total: number): { rank: number; start: number; end: number }[]` dans `geometry.ts` (zone effectivement dessinée de chaque tour le long de l'axe de l'image finale : tour 1 de 0 à `joint1.start`, tour `k` de `joint(k-1).end` à `joint(k).start`, dernier tour jusqu'à la fin) ; `FinalView` expose `segments` avec le nom de l'auteur de chaque rang.

- [ ] **Step 1 (RED):** Tests : `authorSegments(3)` donne trois segments contigus sans chevauchement qui couvrent exactement les zones entre jointures ; `getFinal` renvoie les segments avec les noms (partie dessin) ; cas 2 tours.
- [ ] **Step 2:** Éditeur : le sélecteur de couleur devient un grand bouton-pastille (au moins 40 × 40 px) avec libellé « Couleur » et une palette rapide de 12 couleurs cliquables, plus l'entrée `type="color"` pour les couleurs libres ; la couleur active est clairement indiquée.
- [ ] **Step 3:** Œuvre finale (dessin) : le noms des auteurs s'affichent le long de l'image, à gauche pour le sens `down` (texte vertical centré sur la zone dessinée de chaque auteur, avec une ligne verticale colorée) et au-dessus pour le sens `right` (texte horizontal centré) ; l'unique case à cocher devient « Afficher avec jointures et noms » (jointures pointillées et noms ensemble) ; l'ancien lien « avec jointures » est supprimé.
- [ ] **Step 4:** Export : un seul bouton « Télécharger en PNG » qui construit l'image dans un canvas côté navigateur : image propre, plus, si la case est cochée, les jointures pointillées et la marge de noms ; téléchargement via `<a download>` sur un `blob:` ; si le chargement de l'image échoue, afficher un message. Les routes serveur existantes restent utilisables.
- [ ] **Step 5:** Suite complète + typecheck + lint + build ; vérification navigateur (partie de dessin à deux ou trois joueurs, sens `down` et sens `right`) ; mise à jour de `README.md` si les options changent ; commit.

---

## Self-review (spec ↔ plan)

| Retour | Tâche |
|---|---|
| Min/max incompris | 1 (libellés et aide) |
| Rien ne bouge à l'inscription du dernier joueur / le second joueur n'est pas prévenu / après validation | 2 |
| Pas de confirmation visuelle du nombre de mots | 3 |
| Griser les parties non transmises | 3 (+ `transmittedRange` en 1) |
| Retours à la ligne = paragraphes | 1 |
| Ponctuation seule comptée comme mot | 1 |
| Texte final avec barre verticale, nom vertical, option masquer | 3 |
| Mêmes problèmes d'actualisation en dessin, liste des parties | 2 |
| Couleur plus grande | 5 |
| Dessiner sur la bande du prédécesseur | 4 |
| Fenêtre de validation à l'échéance | 4 |
| Envoi refusé puis brouillon visible | 4 |
| Noms le long du dessin, centrés sur la zone | 5 |
| « Afficher avec jointures et noms » + export PNG fidèle | 5 |
| Titre facultatif | 1 |
| Revue de design (3-4 pistes) | Artefact publié ; plan de redesign séparé après choix |

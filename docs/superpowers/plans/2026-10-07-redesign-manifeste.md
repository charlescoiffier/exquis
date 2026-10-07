# Redesign « Manifeste » : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Habiller toute l'application dans la direction visuelle « Manifeste » choisie par l'utilisateur après la revue de pistes (affiche surréaliste années 1920 : aplats, grosses bordures noires, ombres dures, titres en Didone, accents moutarde et vert canard, navigation en onglets).

**Architecture:** Un seul fichier de styles global fondé sur des variables CSS (jetons), quelques composants de mise en page partagés (bandeau, barre d'onglets, carte), puis restylage page par page. Aucun changement de logique métier ni d'API.

**Tech Stack:** Next.js 15 (App Router), CSS global + CSS Modules si utile, `next/font/google` pour Abril Fatface et Work Sans (auto-hébergées au build), pas de nouvelle dépendance.

**Spec:** `docs/superpowers/specs/2026-10-06-cadavre-exquis-design.md`. Référence visuelle : l'artefact de revue de designs (piste 2, « Manifeste »), publié sur claude.ai/artifact/WELXftLcTb7ts5tetRky5v.

**Prérequis :** le plan `2026-10-07-retours-utilisateur.md` est terminé (les composants fonctionnels sont définitifs avant l'habillage).

## Jetons de design (valeurs exactes)

| Jeton | Valeur |
|---|---|
| `--bg` | `#FBFAF5` |
| `--surface` | `#FFFFFF` |
| `--fg` | `#101010` |
| `--muted` | `#4C4C4C` |
| `--line` | `#101010` (bordures de 2 px) |
| `--accent` (moutarde) / `--on-accent` | `#F2B705` / `#101010` |
| `--accent2` (canard) / `--on-accent2` | `#0B7A75` / `#FFFFFF` |
| `--ok` | `#0B7A75` |
| `--hl` (surlignage du texte transmis) | `#FFE58A` |
| `--dim` (texte grisé non transmis) | `#9B9B94` |
| `--danger` | `#B3261E` |
| `--radius` | `0` |
| `--shadow-btn` | `3px 3px 0 #101010` |
| `--shadow-card` | `4px 4px 0 #101010` |
| Police titres | Abril Fatface (repli : Georgia, serif) |
| Police texte | Work Sans 400/500/700 (repli : system-ui, sans-serif) |

Thème : **clair uniquement** pour cette version (`color-scheme: light`). La piste est fidèle au papier imprimé ; un thème sombre sera étudié plus tard.

## Global Constraints

- Les libellés visibles utilisés par le test e2e (Playwright) ne changent pas ; si un libellé doit changer, mettre à jour `e2e/text-game.spec.ts` dans la même tâche.
- Accessibilité : contraste du texte courant ≥ 4,5:1 (moutarde uniquement avec texte noir) ; focus clavier visible (contour 3 px moutarde + noir) sur tous les contrôles ; zones cliquables ≥ 44 px de haut sur mobile ; `prefers-reduced-motion` respecté ; aucun texte en image.
- Responsive : mobile d'abord (barre d'onglets fixe en bas, avec `env(safe-area-inset-bottom)`), à partir de 900 px la barre devient une navigation horizontale en haut ; pas de défilement horizontal de la page ; gouttière latérale ≥ 16 px.
- La suite complète (`npx vitest run`), `npm run typecheck`, `npm run lint`, `npm run build` et l'e2e doivent passer à la fin de chaque tâche. Vérification visuelle dans le navigateur (mobile 390 px et bureau 1280 px) avec captures.
- Les messages de commit se terminent par `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Aucun contenu n'est masqué ou tronqué sur mobile (titres longs, noms de parties de 80 caractères, noms d'auteurs verticaux).
2. L'éditeur de dessin reste utilisable (canvas à 100 % de la largeur disponible, outils accessibles, ombres dures n'empiètent pas sur la zone de dessin).
3. Le contraste des états (désactivé, erreur, succès, texte grisé) reste lisible.

---

### Task 1: Fondations (jetons, polices, styles globaux, composants partagés)

**Files:**
- Modify: `src/app/globals.css`, `src/app/layout.tsx`
- Create: `src/components/ui/Banner.tsx`, `src/components/ui/TabBar.tsx`, `src/components/ui/Card.tsx`, `src/components/ui/Button.tsx` (ou classes utilitaires dans `globals.css` si plus simple), `docs/design/manifeste.md` (jetons, composants, règles d'usage)

- [ ] **Step 1:** Charger Abril Fatface et Work Sans avec `next/font/google` (pas de requête externe à l'exécution), définir les jetons du tableau ci-dessus dans `:root`, `color-scheme: light`.
- [ ] **Step 2:** Styles de base : corps de page, titres (Abril Fatface), liens, formulaires (champs à bordure 2 px noire, sans arrondi, focus visible), boutons (primaire moutarde avec bordure et ombre dure ; secondaire transparent à bordure ; désactivé grisé ; état `:active` enfonce l'ombre de 2 px), tableaux et listes, messages d'erreur / succès / information.
- [ ] **Step 3:** Mise en page globale : bandeau de titre (fond noir, texte `--bg`, titre en Abril Fatface, slot pour une action), barre d'onglets (Parties, Créer, Avis avec pastille du nombre de notifications non lues, Compte avec « Se déconnecter »), contenu avec marge basse pour la barre fixe ; la navigation reste pilotée par la session (visible seulement si connecté) comme aujourd'hui.
- [ ] **Step 4:** `docs/design/manifeste.md` : jetons, composants et exemples d'usage, règles (une seule action primaire par écran, appel à participation en carte canard).
- [ ] **Step 5:** Suite complète + typecheck + lint + build ; capture mobile et bureau de `/login` et `/` ; commit.

### Task 2: Accueil, création de partie, authentification

**Files:**
- Modify: `src/app/page.tsx`, `src/components/NewGameForm.tsx`, `src/components/JoinButton.tsx`, `src/app/login/page.tsx`, `src/app/register/page.tsx`, `src/app/games/new/page.tsx`

- [ ] **Step 1:** Accueil : section « Appels à participation » en cartes canard pleine largeur avec 📣 conservé, bouton « Reprendre le tour » ; « Mes parties » avec pastille « À vous de jouer ! » en moutarde ; « Parties ouvertes » en cartes (titre en Abril Fatface, métadonnées type · tours · durée · langue, compteur d'inscrits en grand à droite, bouton « Rejoindre »). Libellés d'état en français (plus de valeur d'énumération brute).
- [ ] **Step 2:** Formulaire de création : sections claires (Type, Durée et tours, Texte ou Dessin), aides sous les champs, un seul bouton primaire « Créer la partie ».
- [ ] **Step 3:** Pages de connexion et d'inscription dans le même style (carte centrée, bandeau, erreurs lisibles).
- [ ] **Step 4:** Vérification navigateur mobile + bureau, e2e, suite complète ; commit.

### Task 3: Page de partie, tour de texte, tour de dessin

**Files:**
- Modify: `src/app/games/[id]/page.tsx`, `src/components/TurnEditor.tsx`, `src/components/TextTurn.tsx`, `src/components/DrawingEditor.tsx`, `src/components/Countdown.tsx`, `src/components/ExpiryDialog.tsx` (créé par le plan précédent), `src/components/Countdown.tsx`

- [ ] **Step 1:** Page de partie : bandeau avec titre et statut en français, bloc d'état (attente de joueurs avec compteur, c'est votre tour, en attente, appel à participation, annulée, terminée) en cartes ; compte à rebours bien visible (chiffres tabulaires, passe au rouge sous 1 minute).
- [ ] **Step 2:** Éditeur de texte : champ à bordure épaisse, partie non transmise grisée (`--dim`), partie transmise surlignée (`--hl`), jauge de mots, bouton « Envoyer » primaire ; fenêtre « Temps écoulé » dans le style (cadre noir, ombre dure).
- [ ] **Step 3:** Éditeur de dessin : boîte à outils en barre à bordure noire (boutons carrés 44 px, outil actif en moutarde, pastille de couleur 40 px et palette rapide), canvas encadré, boutons annuler/rétablir/envoyer ; sur mobile la boîte à outils défile horizontalement dans son propre conteneur.
- [ ] **Step 4:** Vérification navigateur mobile + bureau (dessin à la souris), e2e, suite complète ; commit.

### Task 4: Œuvre finale, boîte de réception, états vides, finitions

**Files:**
- Modify: `src/app/games/[id]/final/page.tsx`, `src/components/FinalViewer.tsx`, `src/components/FinalText.tsx`, `src/app/inbox/page.tsx`, `src/components/InboxActions.tsx`, `src/components/InviteButton.tsx`, `src/components/SignOutButton.tsx`, `README.md` (capture ou description du style)

- [ ] **Step 1:** Œuvre finale : image dans un cadre noir à ombre dure, interrupteur « Afficher avec jointures et noms » et bouton « Télécharger en PNG » dans une barre d'outils, rail des auteurs (dessin) et barre verticale (texte) dans les couleurs de la palette (alternance noir / moutarde / canard avec bon contraste du nom), message d'attente d'assemblage et partie annulée dans le style.
- [ ] **Step 2:** Boîte de réception : liste de notifications en cartes (non lues en gras avec liseré moutarde), préférence email, génération d'invitation.
- [ ] **Step 3:** États vides, erreurs, chargement, page 404, favicon et titre : tous dans le style ; vérifier toutes les pages à 390 px et 1280 px, contraste (outil d'audit ou calcul), navigation au clavier.
- [ ] **Step 4:** Suite complète + typecheck + lint + build + e2e ; commit.

---

## Self-review

| Exigence | Tâche |
|---|---|
| Palette, polices, ombres, bordures de la piste | 1 |
| Organisation : bandeau + onglets (mobile d'abord) | 1 |
| Accueil avec appels à participation, création, authentification | 2 |
| Page de partie, éditeurs texte et dessin | 3 |
| Œuvre finale, boîte de réception, finitions, accessibilité | 4 |

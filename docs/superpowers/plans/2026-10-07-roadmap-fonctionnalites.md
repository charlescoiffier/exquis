# Feuille de route : outils de dessin et fonctionnalités

Décisions du 7 octobre 2026. Ce document ordonne le travail ; chaque lot fera l'objet d'une courte spec puis d'un plan
avant le code.

## Outils de dessin (validés)

| Lot | Contenu | Remarques |
| --- | --- | --- |
| D1 Crayons | crayon fin, moyen, épais ; surligneur translucide (opacité constante sur le trait, pas de surcharge aux croisements) ; aérographe | Chaque trait garde `tool`, `size`, `opacity` dans l'opération. Surligneur : trait dessiné en une passe puis fusionné avec une opacité globale (aperçu : calque d'aperçu à opacité CSS, déjà en place). Aérographe : semis de points déterministe (graine stockée dans l'opération). |
| D2 Formes | ligne, rectangle, ovale ; contour ou rempli | Nouvelle opération `shape` (type, deux coins, contour/rempli, couleur, épaisseur). Aperçu sur le calque d'aperçu, redessiné à chaque image (coût constant). |
| D3 Tout effacer | bouton avec la modale `ConfirmDialog` | Opération `clear` dans l'historique : annulable. |
| D4 Zoom et déplacement | pincement à deux doigts, glisser à deux doigts, molette sur ordinateur | Transformation CSS du cadre uniquement (le canvas garde sa résolution) : aucun coût de dessin. Les coordonnées du pointeur tiennent compte de la transformation. À faire après la résolution de la lenteur sur smartphone. |

## Fonctionnalités

| Priorité | Lot | Contenu |
| --- | --- | --- |
| 1 | C Commentaires | Sous les œuvres terminées : table `comment` (partie, auteur, texte, date), notification aux participants. |
| 1 | P Partage public | Lien public en lecture seule vers une œuvre terminée (jeton aléatoire révocable, page sans connexion, image et noms), vignette de prévisualisation. |
| 1 | T Thèmes | Thème facultatif à la création (champ `theme` sur la partie), bouton « au hasard » tirant dans une banque d'environ 100 thèmes, distincts pour le texte et le dessin ; affiché dans le bandeau et sur l'écran de tour. |
| 2 | R Rappels | Relance avant l'échéance d'un tour (délai configurable, par défaut 25 % du temps restant), par email et notification. |
| 2 | Pr Profils | Avatar géométrique imposé (formes et motifs fixes), couleur d'avatar et de fond choisies sur la palette, statistiques (parties jouées, terminées, tours joués, œuvres). |
| 3 | A Amis | Liste d'amis, invitations ciblées à une partie. |
| 3 | M Modération | Signalement d'une œuvre ou d'un commentaire (table `report` déjà présente), file de traitement pour un rôle modérateur, masquage. |

## Questions à trancher (réponses par défaut proposées)

- Commentaires : réservés aux participants de la partie, ou à tout utilisateur connecté qui voit l'œuvre ? Par défaut :
  participants seulement, et lecture publique via le lien partagé uniquement si le créateur le choisit.
- Lien public : révocable et désactivé par défaut, activé par un participant ? Par défaut : le créateur de la partie
  l'active, tout participant peut le copier, le créateur peut le révoquer.
- Thèmes : le thème est-il visible de tous les joueurs ? Par défaut oui, dès la création.

## Ordre proposé

1. Diagnostic de la lenteur du dessin sur smartphone (mesures `?perf=1`).
2. Lot T (thèmes), puis C (commentaires), puis P (partage public).
3. Outils D1 à D3, puis D4 (zoom) une fois la fluidité acquise.
4. Lots R et Pr (priorité 2), puis A et M (priorité 3).

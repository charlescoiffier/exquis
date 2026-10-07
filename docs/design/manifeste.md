# Direction visuelle « Manifeste »

Affiche surréaliste des années 1920 : aplats, bordures noires de 2 px, ombres dures, titres en Didone, accents moutarde et vert canard. Thème **clair uniquement** (`color-scheme: light`).

## Jetons (`:root` dans `src/app/globals.css`)

| Jeton | Valeur | Usage |
|---|---|---|
| `--bg` / `--surface` | `#FBFAF5` / `#FFFFFF` | fond de page / cartes, champs |
| `--fg` / `--muted` | `#101010` / `#4C4C4C` | texte / texte secondaire (4,5:1 minimum) |
| `--line` | `#101010` | toutes les bordures (2 px) ; les lignes de repérage des auteurs (rail) sont en couleur, jamais noires |
| `--accent` / `--on-accent` | `#F2B705` / `#101010` | action primaire, onglet actif ; texte noir uniquement |
| `--accent2` / `--on-accent2` | `#0B7A75` / `#FFFFFF` | liens, pastilles, carte d'appel à participation |
| `--ok` / `--danger` | `#0B7A75` / `#B3261E` | succès / erreur |
| `--hl` | `#FFE58A` | surlignage du texte transmis |
| `--dim` | `#9B9B94` | décor seulement (contraste insuffisant pour du texte) |
| `--radius` | `0` | aucun arrondi (sauf pastilles) |
| `--shadow-btn` / `--shadow-card` | `3px 3px 0 #101010` / `4px 4px 0 #101010` | ombres dures |

Polices : Abril Fatface (`--font-display`, titres, repli Georgia) et Work Sans 400/500/700 (`--font-body`, repli system-ui), chargées par `next/font/google` (auto-hébergées au build, aucune requête externe à l'exécution).

## Styles de base

- Titres `h1`–`h3` en Abril Fatface. Liens vert canard soulignés.
- Champs : bordure 2 px noire, sans arrondi, hauteur minimale 44 px.
- Boutons : `button` ou `.btn` = primaire moutarde, bordure 2 px, ombre dure ; `.secondary` = transparent à bordure ; `:disabled` grisé ; `:active` enfonce l'ombre de 2 px.
- Focus clavier : contour noir 3 px + anneau moutarde, sur tous les contrôles.
- Messages : `.error`, `.success`/`.ok`, `.info`, `.muted`, `.notice` (encadré), `.hint`, `.pill` / `.pill.call`.
- Un tableau trop large défile dans son cadre (`main table`), jamais la page.

## Composants partagés (`src/components/ui`)

```tsx
<Banner title="À vous d'écrire" action={<Countdown ... />} />   // bandeau noir, titre Abril Fatface
<Card>…</Card>                                                  // bordure 2 px + ombre dure
<Card call>…</Card>                                             // carte canard : appel à participation
<Button>Envoyer</Button> <Button variant="secondary">Annuler</Button>
<ButtonLink href="/games/new">Créer une partie</ButtonLink>
<TabBar unread={n} userName="…" />                              // posé par le layout, ne pas réutiliser
```

Navigation : le layout (`src/app/layout.tsx`) affiche, seulement si une session existe, la barre d'onglets Parties, Créer, Avis (pastille du nombre de notifications non lues, calculé côté serveur par `countUnread`) et Compte (menu avec « Se déconnecter »). Mobile : barre fixe en bas (`env(safe-area-inset-bottom)`), contenu avec marge basse. À partir de 900 px : navigation horizontale dans l'en-tête noir.

## Règles d'usage

1. **Une seule action primaire (moutarde) par écran** ; les autres actions sont `.secondary`. Exception : le bouton primaire d'une carte de liste (Rejoindre / Reprendre le tour) est l'action principale de la carte ; en dehors des listes, un seul bouton primaire par écran.
2. **Un appel à participation est une carte canard** (`<Card call>` + `.pill.call`).
3. Moutarde uniquement avec texte noir ; jamais de texte en `--dim`.
4. Cibles tactiles ≥ 44 px ; gouttière latérale ≥ 16 px ; pas de défilement horizontal de la page.
5. L'éditeur de texte garde une typographie identique sur ses deux couches (`.mirror`, `.mirror-input`) : modifier les deux ensemble.
6. `prefers-reduced-motion` désactive les transitions des boutons.

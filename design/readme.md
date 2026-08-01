# Hygie Design System

Hygie (déesse grecque de la santé) est une application web self-hosted, open source (AGPL-3.0), qui donne accès à l'intégralité des données Apple Santé sur grand écran — desktop-first, pensée pour un 27" 5K. C'est un **instrument de mesure, pas un coach** : pas de gamification, pas de marketing. Multi-comptes (un foyer, invitation par magic link, jamais d'inscription publique), sync via une app iOS compagnon « Hygie Sync » — la fraîcheur des données est un citoyen de première classe. Données réelles de référence : 7,24 M de mesures sur 14 ans, 97 types, 961 séances de sport, 18 304 segments de sommeil, sources multiples (Apple Watch, iPhone, Withings, Garmin, HealthFit, capteurs BT). Cible technique : Next.js, composants HTML/CSS propres synchronisés via design-sync.

Le différenciateur produit : **navigation temporelle totalement flexible** (du jour unique à l'all-time, presets, plages custom, comparaisons de périodes) — composant central et omniprésent.

## Content fundamentals

- Langue : bilingue FR/EN (l'app suit la locale du navigateur). Les specimens sont rédigés en français.
- Ton : factuel, précis, calme. On décrit la donnée, on ne félicite pas. Jamais d'exclamation, jamais d'emoji.
- Vouvoiement en français ; phrases courtes ; verbes d'action pour les boutons (« Synchroniser », « Inviter un membre », « Révoquer »).
- Casse : sentence case partout. Labels de données en capitales micro (`.hy-label`, 11px, letter-spacing 0.05em).
- Nombres : format local (virgule décimale en FR, espace fine pour milliers), unités séparées par une espace (« 10,2 km », « 52 bpm », « 4:52 /km »).
- Règle d'or : **pas de donnée ≠ zéro**. Une valeur absente s'affiche « — » (tuiles), pointillés (barres/heatmap), trou (courbes), jamais 0.

## Visual foundations

- **Thème** : clair et sombre, suit `prefers-color-scheme` ; forçage via `data-theme="light|dark"` sur `<html>`. Clair = blancs chauds (teinte 80), sombre = gris-bleu froids (teinte 255). Tous les tokens existent dans les deux thèmes.
- **Couleur** : accent produit teal `--accent` (oklch h178). Palette sémantique stable par famille de mesure : `--data-heart` (rouge), `--data-energy` (orange), `--data-power` (jaune), `--data-activity` (vert), `--data-distance` (bleu), `--data-sleep` (violet), `--data-water` (cyan), `--data-neutral`. Chroma modéré (~0,12) ; variante saturée via `[data-palette="vivid"]`. États : `--ok/--warn/--danger` + fonds `-soft`.
- **Type** : IBM Plex Sans (UI, 400–700) + IBM Plex Mono (axes, timestamps, valeurs techniques). Chiffres tabulaires obligatoires (`.tnum`). Échelle 10→44px, corps 13px — densité assumée.
- **Espacement** : échelle 4px (`--sp-1`…`--sp-9`), contrôles 26/32px. Rayons discrets : 4 (badges), 6 (contrôles), 10 (cartes). Pas de pilules décoratives.
- **Cartes** : `--surface` + bordure 1px `--border`, rayon 10, padding 12–14px. Pas d'ombre portée au repos (`--shadow-1` réservé aux éléments posés type segmented, `--shadow-2` aux overlays).
- **Charts** = composants de premier rang : traits 1,5px, grille horizontale fine `--chart-grid`, axes mono 10px `--chart-axis`, aires ≤12 % d'opacité. Série comparée = même couleur en pointillés.
- **Tendances — vocabulaire systématique.** Chaque métrique doit répondre à « ça s'améliore ou ça se dégrade ? » :
  - delta signé `TrendChip` (± % vs période précédente) — la couleur encode la **qualité** de la tendance, pas la direction : `invert` pour les métriques où baisser est bon (FC repos, allure, poids). |Δ| < 0,5 % = gris neutre ;
  - sparkline (delta MetricCard + `TrendChip data=`) pour la forme récente ;
  - moyenne glissante : `LineChart` `avg:n` → brut en fin translucide + glissante en trait épais (trajectoire) ;
  - comparaison de périodes : série pointillée, même couleur ;
  - la règle vaut aussi pour les records (courbe de progression dans le temps) et le sommeil (tendance de régularité).
- **Animation** : sobre et rapide — 120ms `--ease`, transitions de fond/filtre uniquement. Shimmer pour les skeletons, spin pour la sync. Aucun rebond.
- **Hover** : boutons pleins `brightness(1.07)`, éléments ghost/lignes fond `--surface-2`. Press : `brightness(0.95)`.
- **Interdits** : gradients décoratifs, emoji, look « fitness gamifiée », SVG illustratifs dessinés à la main.

## Iconography

Material Symbols Outlined (weight 300, opsz 20), chargé par `tokens/fonts.css`, rendu par ligature via le composant `Icon` (`<Icon name="bedtime"/>`) ou la classe `.msym`. Les icônes héritent de la couleur du texte ; icônes de donnée dans la couleur de leur famille. Sports : `directions_run`, `directions_bike`, `fitness_center`, `rowing`, `self_improvement`, `sports_tennis`, `pool`, `hiking`. Système : `monitoring`, `sync`, `watch`, `smartphone`, `group`, `devices`, `ecg_heart`. Pas d'emoji, pas de SVG dessinés à la main. Logo : `assets/logo.svg` (marque 3 barres, `currentColor`) + wordmark « Hygie » en Plex Sans 600 — composant `Logo`.

## Index

- `styles.css` → `tokens/` : `fonts.css`, `colors.css`, `typography.css`, `spacing.css`, `base.css`
- `assets/logo.svg` — marque seule (currentColor)
- `templates/ecran-hygie/` — template « Écran Hygie » pour projets consommateurs (sidebar + TimeNav + cartes + chart)
- `guidelines/` — cards specimen (couleurs, type, espacements, iconographie, logo, états vides & chargement)
- `components/core/` — Button, IconButton, Icon, Input, Select, Switch, Tabs (+ SegmentedControl), Badge
- `components/data/` — MetricCard, StatTile, DataTable, SessionRow, SourceBadge, SyncBadge, TrendChip, EmptyState, Skeleton
- `components/time/` — TimeNav (PRESETS), TimeScrubber
- `components/charts/` — LineChart, BarChart, CalendarHeatmap, Gauge, Sparkline
- `components/navigation/` — Sidebar, Logo

### Components

Badge, BarChart, Button, CalendarHeatmap, DataTable, EmptyState, Gauge, Icon, IconButton, Input, LineChart, Logo, MetricCard, SegmentedControl, Select, SessionRow, Sidebar, Skeleton, SourceBadge, Sparkline, StatTile, Switch, SyncBadge, Tabs, TimeNav, TimeScrubber, TrendChip.

**Les tendances sont un principe transversal** : toute valeur affichée avec un historique porte sa tendance (delta MetricCard, `TrendChip`, sparkline, série comparée pointillée). Un chiffre sans contexte temporel est une anomalie de design.

### Intentional additions

Aucune source de composants n'a été fournie (design system créé from scratch) ; l'inventaire ci-dessus découle des livrables du brief (navigation temporelle, cartes de métriques, tuiles, tableaux, listes de séances, badges source/sync, états vides/chargement) + primitives de formulaire nécessaires aux écrans login/onboarding/admin. Checkbox/Radio/Dialog/Toast volontairement absents de la v1 — à ajouter quand un écran les exigera.

### Écrans

`ui_kits/app/index.html` — board interactif complet, 12 écrans : Dashboard, Sport, Détail de séance, Records, Sommeil, État de sync, Login magic link, Onboarding, Membres (admin, frontière de confidentialité), Appareils, Réglages de compte — navigation réelle entre tous (logout → login, invitation → onboarding, sync → appareils…).

# Hygie : dashboard web self-hosted pour données Apple Santé

App Next.js 16 (App Router, TypeScript strict, output standalone) + Postgres, EN PRODUCTION
sur Railway (projet `hygie`, https://app-production-e6f9.up.railway.app). AGPL-3.0, repo privé
mais open-source-ready : jamais de donnée de santé ni de secret dans le repo (même en fixture),
config 100 % par variables d'environnement (`.env.example` = contrat).

## À lire avant de toucher au code

1. `docs/architecture.md` : LE contrat (identité accounts/subjects/grants/devices, règle des
   deux régimes de données, pipeline d'ingestion à états, rollups, sécurité). Issu de 4 revues
   adverses ; toute dérogation se discute.
2. `db/migrations/0001_init.sql` : le schéma. Migrations forward-only via `npm run migrate`,
   JAMAIS auto au boot, discipline expand/contract.
3. `docs/hae-mapping.md` : le protocole Health Auto Export mesuré (mapping, unités, pièges).
4. `design/readme.md` puis `design/` : le design system complet (tokens, 24 composants de
   référence, 11 écrans maquettés). Les tokens CSS sont déjà branchés (`src/app/globals.css`).
   Le JSX de `design/` est une RÉFÉRENCE de rendu : les composants applicatifs se réécrivent
   proprement (sémantique, a11y, états, i18n), on ne copie pas tel quel.
5. La carte de chantier : `~/Letmiko/vault/board/hygie.md` (état vivant, décisions datées).
   Journal du cadrage : `~/Letmiko/vault/journal/2026-08-01-hygie-cadrage.md`.

## Règles non négociables

- Multi-sujet partout : aucune requête de lecture sans subject_id issu des grants de la session.
  L'admin ne voit jamais les données de santé des membres.
- « Pas de donnée ≠ zéro » dans toute UI et toute requête.
- Tendances en citoyen de première classe : chaque valeur affichée porte direction/amplitude
  (la couleur encode la QUALITÉ de la tendance, pas la direction : baisser peut être bien).
- Rollups uniquement pour all-time/multi-années (mesuré : le brut répond < 200 ms ailleurs).
  Budget p95 : 500 ms, à vérifier par EXPLAIN ANALYZE sur les données réelles.
- Journées calculées dans le fuseau du sujet ; unités canoniques en base, affichage par l'UI.
- i18n dès le premier composant (base EN, FR première langue). Pas de nouvelle dépendance
  sans justification écrite.
- Jamais de valeur de santé dans les logs.

## Environnement

- Déploiement : push sur `main` = build + deploy Railway automatiques (watch patterns : src/,
  db/, scripts/, public/, Dockerfile, configs). Commits en anglais, un commit une intention.
- Postgres de production : accessible uniquement depuis le réseau privé Railway ;
  administration ponctuelle via `railway ssh --service app` (script + `NODE_PATH=/app/node_modules`).
- Base de DEV avec les données réelles complètes : conteneur Docker local `hygie-pgbench`,
  `postgres://postgres:<mdp local, voir ~/Letmiko/work/hygie/bench/>@127.0.0.1:5433/hygie_dev`
  (6,48 M observations réelles importées). S'en servir pour développer et mesurer.
- Scripts : `npm run migrate` / `seed` / `backfill`. Tests manuels : harnais dans
  `~/Letmiko/work/hygie/test-ingest/` et `test-auth/`.
- `~/Letmiko/work/hygie/` contient des données de santé réelles : exclu de git, ne jamais
  committer quoi que ce soit qui en provient.

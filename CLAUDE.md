# Hygie : dashboard web self-hosted pour données Apple Santé

App Next.js 16 (App Router, TypeScript strict, output standalone) + Postgres, EN PRODUCTION
sur Railway (projet `hygie`, https://hygie.letmiko.app). AGPL-3.0, repo privé
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
- Rollups au-delà de 31 jours de fenêtre, brut en deçà et pour la journée en cours (règle
  mesurée, documentée en tête de `src/lib/queries/series.ts`). Budget p95 : 500 ms, à vérifier
  par EXPLAIN ANALYZE sur les données réelles.
- Journées calculées dans le fuseau du sujet ; unités canoniques en base, affichage par l'UI.
- i18n dès le premier composant (base EN, FR première langue). Pas de nouvelle dépendance
  sans justification écrite.
- Jamais de valeur de santé dans les logs.

## Environnement

- Déploiement : push sur `main` = build + deploy Railway automatiques (watch patterns : src/,
  db/, scripts/, public/, Dockerfile, configs). Commits en anglais, un commit une intention.
- Postgres de production : accessible uniquement depuis le réseau privé Railway ;
  administration ponctuelle via `railway ssh --service app` (script + `NODE_PATH=/app/node_modules`).
- Base de DEV sur le Mac : conteneur Docker `hygie-demo-pg` (Postgres 17, port 5434, volume nommé
  `hygie-demo-pg`, redémarre avec Docker Desktop), base `hygie_demo` remplie par le jeu synthétique
  (`npm run synthetic`, sujet « Camille », deux ans, 443 837 observations, rollups faits le
  2026-09-04). Le `.env` local du repo (ignoré par git) pointe dessus, avec
  `HYGIE_MAIL_CAPTURE_DIR` : `npm run build && npm start`, puis demander un magic link pour
  `demo@hygie.invalid` sur http://localhost:3000/login et ouvrir le lien trouvé dans le JSON du
  dossier de capture. Pour repartir de zéro : `docker rm -f hygie-demo-pg && docker volume rm
  hygie-demo-pg`, relancer le conteneur, `npm run migrate && npm run seed`, `npm run synthetic --
  --email demo@hygie.invalid --days 730 --yes`, `npm run rollups -- --subject <uuid affiché>`.
  Plus de base à données réelles ici (`hygie-pgbench` a disparu, constaté 2026-09-01) : les
  captures du README viennent du jeu synthétique, jamais de vraies valeurs dans le repo public.
- Scripts : `npm run migrate` / `seed` / `backfill` / `backfill:series` (anneaux, audiogrammes,
  GPX et CSV d'ECG du même export, à lancer APRÈS `backfill`) / `rollups` (reconstruction de
  `rollup_hourly`, à lancer après tout backfill XML). Tests manuels : harnais dans
  `~/Letmiko/work/hygie/test-ingest/` et `test-auth/`.
- `~/Letmiko/work/hygie/` contient des données de santé réelles : exclu de git, ne jamais
  committer quoi que ce soit qui en provient.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

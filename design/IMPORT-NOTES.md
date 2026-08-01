# Import scope — Claude Design project "Hygie"

Synced by hand from claude.ai/design (project id `70a31567-836b-4d9b-b996-876f810a2da7`) on 2026-08-02.

## Imported (the design reference proper)

- `readme.md` — the design system charter: content rules, visual foundations, trend vocabulary, iconography, component index. **Read this first.**
- `tokens/` + `styles.css` — colors (light/dark, data palette, vivid variant), typography, spacing, fonts.
- `assets/logo.svg` — the mark.
- `components/` — 24 reference components (core, data, time, charts, navigation) as JSX.
- `ui_kits/app/` — the 11 interactive screens + `data.js` (synthetic data) + `index.html` (navigable board).
- `templates/ecran-hygie/EcranHygie.dc.html` — the screen template.

## Deliberately not imported (Design System pane plumbing, regenerable)

- `_ds_bundle.js` (compiled bundle exposing `window.Hygie_70a315`), `_ds_manifest.json`,
  `templates/ecran-hygie/ds-base.js` + `support.js`, `thumbnail.html`, `.thumbnail`,
  `_adherence.oxlintrc.json`, `SKILL.md`.
- `guidelines/*.html` specimen cards and per-component `.d.ts` / `.prompt.md` / `*.card.html`
  files: their substance is summarized in `readme.md`; fetch on demand from Claude Design
  if a specific spec is needed.

Consequence: `ui_kits/app/index.html` will not render standalone from this folder (it loads
`_ds_bundle.js`). View the interactive board in Claude Design, or fetch the bundle later.

## Status of this folder

Visual source of truth and token source. NOT application code: app components will be
rewritten properly (semantics, accessibility, states, i18n, tests) against these renderings.

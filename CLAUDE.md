# CLAUDE.md

Tiny project. Read `DESIGN.md` first — it sets the premise (music theory **is** orbital mechanics) that every feature should serve. Don't bolt on UI/economy mechanics that don't connect to that isomorphism.

## Commands

- `npm install` — once
- `npm run dev` — local server
- `npm run build` — typecheck + production build
- `npm run lint` — eslint

Run `npm run build` and `npm run lint` before claiming a change works. The visuals (canvas animation, future audio) can't be verified from a CLI — if you can't open a browser, say so explicitly rather than claim success.

## Branch & deploy gotchas

- Default branch is **`Main`** (capital M), not `main`.
- `.github/workflows/deploy.yml` triggers on `main` (lowercase). Git refs are case-sensitive, so pushes to the actual default branch do **not** auto-deploy. Use the workflow's `workflow_dispatch` until the trigger is fixed.
- Live site: https://aureliaar.github.io/Orbital-idle/
- `vite.config.ts` sets `base: '/Orbital-idle/'` — keep it; Pages needs it to resolve assets.

## Stack

Vite + React 19 + TypeScript. Canvas for visuals, WebAudio is the planned next layer. No router or state library yet — keep it minimal until a feature in `DESIGN.md` actually demands one.

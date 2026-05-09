# CLAUDE.md

Tiny project. Read `DESIGN.md` first — it sets the premise (music theory **is** orbital mechanics) that every feature should serve. Don't bolt on UI/economy mechanics that don't connect to that isomorphism.

## Commands

- `npm install` — once
- `npm run dev` — local server
- `npm run build` — typecheck + production build
- `npm run lint` — eslint

Run `npm run build` and `npm run lint` before claiming a change works. The visuals (canvas animation, future audio) can't be verified from a CLI — if you can't open a browser, say so explicitly rather than claim success.

## Branch & deploy gotchas

- Default branch is **`Main`** (capital M), not `main`. `.github/workflows/deploy.yml` triggers on `Main` to match. Git refs are case-sensitive — if you ever rename the branch, update the trigger too.
- Live site: https://aureliaar.github.io/Orbital-idle/
- Cloudflare also deploys this repo as a static-assets Worker (config in `wrangler.jsonc`). Production lands at `orbital.jacopo-sinigaglia.workers.dev`; non-production branches get preview URLs at `*-orbital.jacopo-sinigaglia.workers.dev`.
- `vite.config.ts` switches `base` between `/Orbital-idle/` (GitHub Actions) and `/` (everywhere else) so both hosts resolve assets correctly. If you ever drop one host, simplify the base.

## Stack

Vite + React 19 + TypeScript. Canvas for visuals, WebAudio is the planned next layer. No router or state library yet — keep it minimal until a feature in `DESIGN.md` actually demands one.

# CLAUDE.md

Tiny project. Read `DESIGN.md` first — it sets the premise (music theory **is** orbital mechanics) that every feature should serve. Don't bolt on UI/economy mechanics that don't connect to that isomorphism.

## Commands

- `npm install` — once
- `npm run dev` — local server
- `npm run build` — typecheck + production build
- `npm run lint` — eslint
- `npm run preview` — local Workers preview via `wrangler dev`
- `npm run deploy` — `wrangler deploy` to Cloudflare Workers

Run `npm run build` and `npm run lint` before claiming a change works. The visuals (canvas animation, future audio) can't be verified from a CLI — if you can't open a browser, say so explicitly rather than claim success.

## Branch & deploy gotchas

- Default branch is `main` (lowercase). `.github/workflows/deploy.yml` triggers on `main`. Git refs are case-sensitive — if you ever rename the branch, update the trigger.
- GitHub Pages: https://aureliaar.github.io/Orbital-idle/ (auto-deploys on push to `main`).
- Cloudflare Workers: production at https://orbital.jacopo-sinigaglia.workers.dev/, branch previews at `https://<branch-slug>-orbital.jacopo-sinigaglia.workers.dev/` (slashes in branch names become hyphens, lowercased). Worker name `orbital` is set in `wrangler.jsonc`.
- `vite.config.ts` sets `base: './'` so the same `dist/` works at both `/Orbital-idle/` (Pages) and `/` (Workers). Don't hard-code an absolute base unless you're abandoning one of the two deploys.

## Stack

Vite + React 19 + TypeScript. Canvas for visuals, WebAudio is the planned next layer. No router or state library yet — keep it minimal until a feature in `DESIGN.md` actually demands one.

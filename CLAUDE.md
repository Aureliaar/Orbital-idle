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
- Cloudflare also deploys this repo as a static-assets Worker (config in `wrangler.jsonc`). Production lands at `orbital.jacopo-sinigaglia.workers.dev` and only updates when the configured production branch gets a push (build runs `wrangler deploy`). Every other branch push creates a preview Worker Version with two URLs under the `*-orbital.jacopo-sinigaglia.workers.dev` wildcard:
  - **Version URL** — `<8-char-version-id>-orbital.jacopo-sinigaglia.workers.dev`. Pinned to that exact build forever; old versions keep working.
  - **Branch alias** — `<sanitized-branch-name>-orbital.jacopo-sinigaglia.workers.dev` (slashes → dashes, lowercased). Auto-updates to the latest build of that branch. Use this for sharing previews — it survives across pushes.
  - Both are shown in Cloudflare dash → Workers & Pages → orbital → Deployments → Version History → tap a row.
- `vite.config.ts` switches `base` between `/Orbital-idle/` (GitHub Actions) and `/` (everywhere else) so both hosts resolve assets correctly. If you ever drop one host, simplify the base.

## Stack

Vite + React 19 + TypeScript. Canvas for visuals, WebAudio is the planned next layer. No router or state library yet — keep it minimal until a feature in `DESIGN.md` actually demands one.

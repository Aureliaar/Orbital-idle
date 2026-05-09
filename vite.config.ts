import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves under /Orbital-idle/; Cloudflare Workers serves
// from the domain root. Detect the GH Actions runner so Pages builds
// get the subpath and every other build (Cloudflare, local dev) stays
// at /.
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/Orbital-idle/' : '/',
  plugins: [react()],
})

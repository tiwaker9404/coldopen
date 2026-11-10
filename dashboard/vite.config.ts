import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// VITE_DEMO=1 builds the demo: the real app answered from recorded data (src/demo/), served
// from GitHub Pages under /coldopen/demo/. Every other build compiles the demo branch away.
const demo = process.env.VITE_DEMO === '1'

export default defineConfig({
  root: import.meta.dirname,
  base: demo ? '/coldopen/demo/' : '/',
  define: { __DEMO__: JSON.stringify(demo) },
  plugins: [react()],
  build: { outDir: demo ? 'dist-demo' : 'dist', emptyOutDir: true },
  server: { proxy: { '/v1': 'http://127.0.0.1:8080', '/f': 'http://127.0.0.1:8080' } },
})

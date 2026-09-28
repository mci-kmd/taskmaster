import { builtinModules } from 'module'
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {},
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          // Sandboxed guest preload for the project preview; must stay a single self-contained file.
          preview: resolve('src/preload/preview.ts')
        },
        // electron-vite's preload defaults are dropped once `input` is set, so restate them.
        external: ['electron', /^electron\/.+/, ...builtinModules.flatMap((m) => [m, `node:${m}`])],
        output: {
          format: 'cjs',
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name]-[hash].js'
        }
      }
    }
  },
  renderer: {
    build: {
      minify: true
    },
    server: {
      port: 5175,
      strictPort: true
    },
    preview: {
      port: 5175,
      strictPort: true
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})

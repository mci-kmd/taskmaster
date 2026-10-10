import { builtinModules } from 'module'
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import packageJson from './package.json'

// Node built-ins and Electron stay external to every Node-side bundle.
const runtimeExternals = [
  'electron',
  /^electron\/.+/,
  ...builtinModules.flatMap((m) => [m, `node:${m}`])
]
// The main process loads its npm dependencies from node_modules at runtime.
const dependencyExternals = Object.keys(packageJson.dependencies).map(
  (name) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/.*)?$`)
)

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          // Forked as a utility process so installing a Copilot SDK never stalls the window.
          'sdk-install': resolve('src/main/copilot/sdk-install-process.ts')
        },
        // Setting `input` drops electron-vite's main defaults, so restate them.
        external: [...runtimeExternals, ...dependencyExternals],
        output: {
          format: 'cjs',
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name]-[hash].js'
        }
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          // Sandboxed guest preload for the project preview; must stay a single self-contained file.
          preview: resolve('src/preload/preview.ts')
        },
        // electron-vite's preload defaults are dropped once `input` is set, so restate them.
        external: runtimeExternals,
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

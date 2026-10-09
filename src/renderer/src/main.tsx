import './styles/index.css'

import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { initializeTheme } from './lib/theme'

initializeTheme()

// Dev-only UI gallery; `import.meta.env.DEV` keeps it out of production builds.
const Gallery =
  import.meta.env.DEV && window.location.hash.startsWith('#gallery')
    ? lazy(() => import('./gallery/Gallery'))
    : null

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {Gallery ? (
      <Suspense>
        <Gallery />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>
)

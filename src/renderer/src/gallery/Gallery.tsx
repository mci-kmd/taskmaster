import { useEffect, useState } from 'react'
import { THEMES, isThemeId } from '../../../shared/themes'
import { setTheme, useTheme } from '../lib/theme'
import SegmentedControl from '../components/ui/SegmentedControl'
import type { GallerySection } from './gallery-section'

// Each file in ./sections default-exports a GallerySection.
const modules = import.meta.glob<{ default: GallerySection }>('./sections/*.tsx', { eager: true })
const SECTIONS = Object.values(modules)
  .map((module) => module.default)
  .sort((left, right) => left.order - right.order)

/** `#gallery?theme=slate&section=session` selects a theme and narrows to one section. */
function readHash(): { theme: string | null; section: string | null } {
  const query = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
  return { theme: query.get('theme'), section: query.get('section') }
}

/**
 * Dev-only UI gallery (open the app with `#gallery`). Renders every section in the active
 * theme so surfaces and states can be reviewed, and screenshotted, without live data.
 */
export default function Gallery(): React.JSX.Element {
  const theme = useTheme()
  const [hash, setHash] = useState(readHash)

  useEffect(() => {
    const update = (): void => setHash(readHash())
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])

  useEffect(() => {
    if (isThemeId(hash.theme)) setTheme(hash.theme, { animate: false })
  }, [hash.theme])

  const sections = hash.section
    ? SECTIONS.filter((section) => section.id === hash.section)
    : SECTIONS

  return (
    <div className="h-screen overflow-y-auto bg-bg text-fg">
      <header className="sticky top-0 z-20 flex items-center gap-4 border-b border-border bg-bg/90 px-6 py-3 backdrop-blur">
        <h1 className="text-[14px] font-semibold">UI gallery</h1>
        <div className="w-[480px]">
          <SegmentedControl
            ariaLabel="Theme"
            onChange={(id) => setTheme(id)}
            options={THEMES.map((item) => ({ value: item.id, label: item.label }))}
            value={theme.id}
          />
        </div>
        <nav className="ml-auto flex gap-3 text-[12px] text-fg-subtle">
          {SECTIONS.map((section) => (
            <a className="hover:text-fg" href={`#gallery?section=${section.id}`} key={section.id}>
              {section.title}
            </a>
          ))}
        </nav>
      </header>
      <main className="flex flex-col gap-10 p-6">
        {sections.map(({ id, title, Component }) => (
          <section data-gallery-section={id} key={id}>
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.09em] text-fg-subtle">
              {title}
            </h2>
            <Component />
          </section>
        ))}
      </main>
    </div>
  )
}

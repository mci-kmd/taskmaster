import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { promptPreview, type RailPrompt } from './prompt-rail'
import { useLastValue, usePresence } from '../../lib/motion'

/** Distance in px over which magnification falls off around the pointer. */
const SPREAD = 40
/** Vertical room a preview label needs so neighbouring labels never overlap. */
const LABEL_HEIGHT = 24
/** Neighbouring labels shown on each side of the nearest bar. */
const LABEL_NEIGHBOURS = 2
const MIN_LABEL_WEIGHT = 0.12
/** Where in the viewport a prompt counts as the one being read. */
const READING_LINE = 0.3

interface Magnification {
  nearest: number
  weights: number[]
  labels: { index: number; top: number; weight: number }[]
}

const center = (element: Element | null | undefined): number => {
  const box = element?.getBoundingClientRect()
  return box ? box.top + box.height / 2 : 0
}

const reducedMotion = (): boolean =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/**
 * A narrow stack of bars at the left edge of the transcript, one per user prompt. Hovering
 * magnifies the bars near the pointer and previews their prompts; clicking scrolls to one.
 */
export default function PromptRail({
  prompts,
  scrollRef,
  onNavigate
}: {
  prompts: RailPrompt[]
  scrollRef: React.RefObject<HTMLElement | null>
  /** Called before the rail scrolls the transcript, e.g. to stop following new output. */
  onNavigate?: () => void
}): React.JSX.Element | null {
  const railRef = useRef<HTMLDivElement>(null)
  const bars = useRef<(HTMLButtonElement | null)[]>([])
  const pointerY = useRef<number | null>(null)
  const focused = useRef<number | null>(null)
  /** Clicking focuses a bar too, but only keyboard focus should keep its preview open. */
  const pointerFocus = useRef(false)
  /** Set by a jump so smooth scrolling past other prompts keeps the target highlighted. */
  const pinned = useRef<{ index: number; settled: boolean } | null>(null)
  const [active, setActive] = useState(0)
  const [magnified, setMagnified] = useState<Magnification | null>(null)
  const previews = useMemo(() => prompts.map(promptPreview), [prompts])
  const ids = prompts.map((prompt) => prompt.id).join('\n')
  const visible = prompts.length >= 2
  const rail = usePresence(visible)
  const labels = usePresence(magnified !== null)
  // Labels keep their last positions while they fade out after the pointer leaves.
  const shownLabels = useLastValue(magnified)

  const promptElements = useCallback((): Map<string, HTMLElement> => {
    const elements = new Map<string, HTMLElement>()
    scrollRef.current?.querySelectorAll<HTMLElement>('[data-prompt-id]').forEach((element) => {
      if (element.dataset.promptId) elements.set(element.dataset.promptId, element)
    })
    return elements
  }, [scrollRef])

  // Highlight the last prompt above the reading line, or the last visible one at the very end.
  useEffect(() => {
    const container = scrollRef.current
    if (!container || !visible) return
    const order = ids.split('\n')
    const update = (): void => {
      if (pinned.current && !pinned.current.settled) return setActive(pinned.current.index)
      pinned.current = null
      const elements = promptElements()
      const box = container.getBoundingClientRect()
      const atEnd = container.scrollHeight - container.scrollTop - container.clientHeight < 2
      const line = atEnd ? box.bottom - 24 : box.top + box.height * READING_LINE
      let next = 0
      order.forEach((id, index) => {
        const element = elements.get(id)
        if (element && element.getBoundingClientRect().top <= line) next = index
      })
      setActive(next)
    }
    // The jump target stays highlighted where it landed until the next scroll.
    const settle = (): void => {
      if (pinned.current) pinned.current.settled = true
    }
    update()
    container.addEventListener('scroll', update, { passive: true })
    container.addEventListener('scrollend', settle)
    return () => {
      container.removeEventListener('scroll', update)
      container.removeEventListener('scrollend', settle)
    }
  }, [scrollRef, ids, visible, promptElements])

  // Magnify around the pointer, or around the keyboard-focused bar when the pointer is away.
  const magnify = useCallback((): void => {
    const count = prompts.length
    const index = focused.current
    const y =
      pointerY.current ?? (index !== null && index < count ? center(bars.current[index]) : null)
    if (y === null || !railRef.current) return setMagnified(null)
    const centers = Array.from({ length: count }, (_, i) => center(bars.current[i]))
    let nearest = index !== null && pointerY.current === null ? index : 0
    if (pointerY.current !== null)
      centers.forEach((value, i) => {
        if (Math.abs(value - y) < Math.abs(centers[nearest] - y)) nearest = i
      })
    const weights = centers.map((value) => Math.exp(-(((value - y) / SPREAD) ** 2)))
    const pitch = count > 1 ? Math.abs(centers[1] - centers[0]) : 0
    const step = pitch ? Math.max(1, Math.ceil(LABEL_HEIGHT / pitch)) : 1
    const railTop = railRef.current.getBoundingClientRect().top
    const labels: Magnification['labels'] = []
    for (let offset = -LABEL_NEIGHBOURS; offset <= LABEL_NEIGHBOURS; offset++) {
      const i = nearest + offset * step
      if (i < 0 || i >= count) continue
      const weight = offset === 0 ? 1 : weights[i]
      if (weight >= MIN_LABEL_WEIGHT) labels.push({ index: i, top: centers[i] - railTop, weight })
    }
    setMagnified({ nearest, weights, labels })
  }, [prompts.length])

  const jump = (index: number): void => {
    const container = scrollRef.current
    const element = promptElements().get(prompts[index]?.id)
    if (!container || !element) return
    onNavigate?.()
    const offset = element.getBoundingClientRect().top - container.getBoundingClientRect().top
    const top = Math.max(0, offset + container.scrollTop - 16)
    const reachable = Math.min(top, container.scrollHeight - container.clientHeight)
    // Without any scrolling to do, no scrollend arrives to settle the pin.
    pinned.current = { index, settled: Math.abs(reachable - container.scrollTop) < 1 }
    setActive(index)
    container.scrollTo({ top, behavior: reducedMotion() ? 'auto' : 'smooth' })
  }

  const moveFocus = (event: React.KeyboardEvent, index: number): void => {
    const target = {
      ArrowUp: index - 1,
      ArrowDown: index + 1,
      Home: 0,
      End: prompts.length - 1
    }[event.key]
    if (target === undefined) return
    event.preventDefault()
    bars.current[Math.max(0, Math.min(prompts.length - 1, target))]?.focus()
  }

  if (!rail.mounted) return null
  const current = magnified?.nearest ?? active

  return (
    <div
      className="tm-prompt-rail"
      ref={railRef}
      data-expanded={magnified ? '' : undefined}
      data-motion="fade"
      data-state={rail.state}
    >
      <nav
        className="tm-prompt-rail-list"
        aria-label="Prompts in this thread"
        onPointerMove={(event) => {
          pointerY.current = event.clientY
          magnify()
        }}
        onPointerLeave={() => {
          pointerY.current = null
          pointerFocus.current = false
          magnify()
        }}
        onPointerDown={() => {
          pointerFocus.current = true
        }}
        onKeyDown={() => {
          pointerFocus.current = false
        }}
        onScroll={magnify}
      >
        {prompts.map((prompt, index) => (
          <button
            key={prompt.id}
            ref={(element) => {
              bars.current[index] = element
            }}
            type="button"
            className="tm-prompt-rail-bar"
            tabIndex={index === current ? 0 : -1}
            aria-label={`Prompt ${index + 1} of ${prompts.length}: ${previews[index].slice(0, 160) || 'Empty prompt'}`}
            aria-current={index === active ? 'location' : undefined}
            data-nearest={magnified?.nearest === index ? '' : undefined}
            style={
              {
                '--tm-rail-length': Math.min(1, prompt.content.length / 600).toFixed(2),
                '--tm-rail-weight': (magnified?.weights[index] ?? 0).toFixed(3)
              } as React.CSSProperties
            }
            onClick={() => jump(index)}
            onKeyDown={(event) => moveFocus(event, index)}
            onFocus={() => {
              if (pointerFocus.current) return
              focused.current = index
              magnify()
            }}
            onBlur={() => {
              focused.current = null
              magnify()
            }}
          />
        ))}
      </nav>
      {labels.mounted && shownLabels ? (
        <div
          className="tm-prompt-rail-labels"
          aria-hidden="true"
          data-motion="fade"
          data-state={labels.state}
        >
          {shownLabels.labels.map(({ index, top, weight }) => (
            <div
              key={prompts[index]?.id ?? index}
              className="tm-prompt-rail-label"
              data-nearest={index === shownLabels.nearest ? '' : undefined}
              style={{ top, opacity: weight }}
            >
              <span className="tm-prompt-rail-label-number">{index + 1}</span>
              <span className="tm-prompt-rail-label-text">{previews[index] || 'Empty prompt'}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

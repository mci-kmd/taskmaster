// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import PromptRail from './PromptRail'
import { promptPreview, type RailPrompt } from './prompt-rail'

afterEach(cleanup)

const prompts: RailPrompt[] = [
  { id: 'p1', content: 'Explain   the\nproject layout' },
  { id: 'p2', content: 'Fix the bug in [📎 log.txt] please', attachments: ['log.txt'] },
  { id: 'p3', content: 'Write tests' },
  { id: 'p4', content: 'Ship it' }
]

const rect = (top: number, height: number): DOMRect =>
  ({ top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top }) as DOMRect

function Harness({
  items,
  onNavigate
}: {
  items: RailPrompt[]
  onNavigate?: () => void
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  return (
    <div>
      <div data-testid="timeline" ref={scrollRef}>
        {items.map((item) => (
          <article key={item.id} data-prompt-id={item.id}>
            {item.content}
          </article>
        ))}
      </div>
      <PromptRail prompts={items} scrollRef={scrollRef} onNavigate={onNavigate} />
    </div>
  )
}

/** Lays prompts out 400px apart in a 300px-tall timeline and bars 12px apart in the rail. */
function layOut(scrollTop = 0): HTMLElement {
  const timeline = screen.getByTestId('timeline')
  Object.defineProperties(timeline, {
    scrollTop: { value: scrollTop, configurable: true },
    scrollHeight: { value: 2000, configurable: true },
    clientHeight: { value: 300, configurable: true }
  })
  timeline.getBoundingClientRect = () => rect(0, 300)
  timeline.querySelectorAll<HTMLElement>('[data-prompt-id]').forEach((element, index) => {
    element.getBoundingClientRect = () => rect(index * 400 - scrollTop, 100)
  })
  screen.getAllByRole('button').forEach((bar, index) => {
    bar.getBoundingClientRect = () => rect(100 + index * 12, 12)
  })
  return timeline
}

it('hides the rail when the thread has fewer than two prompts', () => {
  render(<Harness items={prompts.slice(0, 1)} />)
  expect(screen.queryByRole('navigation')).toBeNull()
})

it('previews prompts on one line with attachments named', () => {
  expect(promptPreview(prompts[0])).toBe('Explain the project layout')
  expect(promptPreview(prompts[1])).toBe('Fix the bug in 📎 log.txt please')
})

it('labels a bar per prompt and highlights the prompt in view as you scroll', () => {
  render(<Harness items={prompts} />)
  const bars = within(
    screen.getByRole('navigation', { name: 'Prompts in this thread' })
  ).getAllByRole('button')
  expect(bars.map((bar) => bar.getAttribute('aria-label'))).toEqual([
    'Prompt 1 of 4: Explain the project layout',
    'Prompt 2 of 4: Fix the bug in 📎 log.txt please',
    'Prompt 3 of 4: Write tests',
    'Prompt 4 of 4: Ship it'
  ])
  const timeline = layOut(820)
  fireEvent.scroll(timeline)
  expect(bars[2].getAttribute('aria-current')).toBe('location')
  expect(bars.filter((bar) => bar.hasAttribute('aria-current'))).toHaveLength(1)
  // Only the highlighted bar is in the tab order.
  expect(bars.map((bar) => bar.tabIndex)).toEqual([-1, -1, 0, -1])
})

it('scrolls the timeline to a prompt when its bar is clicked', () => {
  const onNavigate = vi.fn()
  render(<Harness items={prompts} onNavigate={onNavigate} />)
  const timeline = layOut(0)
  const scrollTo = vi.fn()
  timeline.scrollTo = scrollTo as typeof timeline.scrollTo
  fireEvent.click(screen.getByRole('button', { name: /^Prompt 3 of 4/ }))
  expect(onNavigate).toHaveBeenCalledOnce()
  expect(scrollTo).toHaveBeenCalledWith({ top: 784, behavior: 'smooth' })
  const current = (): string | undefined =>
    screen
      .getAllByRole('button')
      .find((bar) => bar.hasAttribute('aria-current'))
      ?.getAttribute('aria-label')
      ?.slice(0, 13)
  expect(current()).toBe('Prompt 3 of 4')
  // Smooth scrolling passes prompt 2 on the way without moving the highlight.
  layOut(390)
  fireEvent.scroll(timeline)
  expect(current()).toBe('Prompt 3 of 4')
  // Once the scroll has ended, later scrolling tracks the prompt in view again.
  layOut(784)
  fireEvent.scroll(timeline)
  fireEvent(timeline, new Event('scrollend'))
  expect(current()).toBe('Prompt 3 of 4')
  layOut(400)
  fireEvent.scroll(timeline)
  expect(current()).toBe('Prompt 2 of 4')
})

it('jumps without animation when reduced motion is preferred', () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }))
  try {
    render(<Harness items={prompts} />)
    const timeline = layOut(0)
    const scrollTo = vi.fn()
    timeline.scrollTo = scrollTo as typeof timeline.scrollTo
    fireEvent.click(screen.getByRole('button', { name: /^Prompt 2 of 4/ }))
    expect(scrollTo).toHaveBeenCalledWith({ top: 384, behavior: 'auto' })
  } finally {
    vi.unstubAllGlobals()
  }
})

it('magnifies bars near the pointer and previews the nearby prompts', () => {
  const { container } = render(<Harness items={prompts} />)
  layOut(0)
  const rail = container.querySelector<HTMLElement>('.tm-prompt-rail')!
  rail.getBoundingClientRect = () => rect(90, 60)
  const nav = screen.getByRole('navigation')
  const bars = within(nav).getAllByRole('button')
  // Bar centres are at 106, 118, 130 and 142; point at the second bar.
  fireEvent.pointerMove(nav, { clientY: 118 })
  const weights = bars.map((bar) => Number(bar.style.getPropertyValue('--tm-rail-weight')))
  expect(weights[1]).toBe(1)
  expect(weights[0]).toBeGreaterThan(weights[2] - 0.001)
  expect(weights[2]).toBeGreaterThan(weights[3])
  expect(weights[3]).toBeLessThan(1)
  expect(bars[1].hasAttribute('data-nearest')).toBe(true)
  // Labels need 24px each, so with 12px bars only every other prompt is previewed.
  const labels = [...container.querySelectorAll<HTMLElement>('.tm-prompt-rail-label')]
  expect(labels.map((label) => label.textContent)).toEqual([
    '2Fix the bug in 📎 log.txt please',
    '4Ship it'
  ])
  expect(labels[0].hasAttribute('data-nearest')).toBe(true)
  expect(labels[0].style.top).toBe('28px')
  expect(Number(labels[1].style.opacity)).toBeLessThan(1)

  fireEvent.pointerLeave(nav)
  expect(container.querySelectorAll('.tm-prompt-rail-label')).toHaveLength(0)
  expect(bars.every((bar) => Number(bar.style.getPropertyValue('--tm-rail-weight')) === 0)).toBe(
    true
  )
})

it('shows the focused prompt and moves between prompts with the arrow keys', () => {
  const { container } = render(<Harness items={prompts} />)
  layOut(0)
  const bars = within(screen.getByRole('navigation')).getAllByRole('button')
  act(() => bars[0].focus())
  const label = (): string | null | undefined =>
    container.querySelector('.tm-prompt-rail-label[data-nearest]')?.textContent
  expect(label()).toBe('1Explain the project layout')
  fireEvent.keyDown(bars[0], { key: 'ArrowDown' })
  expect(document.activeElement).toBe(bars[1])
  expect(label()).toBe('2Fix the bug in 📎 log.txt please')
  fireEvent.keyDown(bars[1], { key: 'End' })
  expect(document.activeElement).toBe(bars[3])
  fireEvent.keyDown(bars[3], { key: 'ArrowDown' })
  expect(document.activeElement).toBe(bars[3])
  fireEvent.keyDown(bars[3], { key: 'Home' })
  expect(document.activeElement).toBe(bars[0])
  act(() => bars[0].blur())
  expect(label()).toBeUndefined()

  // Focus from clicking a bar does not keep its preview open once the pointer leaves.
  const nav = screen.getByRole('navigation')
  fireEvent.pointerDown(nav)
  act(() => bars[2].focus())
  fireEvent.pointerLeave(nav)
  expect(label()).toBeUndefined()
})

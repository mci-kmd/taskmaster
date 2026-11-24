// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { CopilotTimelineItem } from '../../../../shared/app-types'
import SessionTimeline, { INITIAL_ROWS, MAX_FOLLOW_ROWS, TRIM_KEEP_ROWS } from './SessionTimeline'

afterEach(cleanup)

const message = (id: string, content: string): CopilotTimelineItem => ({
  id,
  type: 'assistant',
  content,
  timestamp: ''
})

const article = (text: string): HTMLElement => screen.getByText(text).closest('article')!

it('shows the history at once and lets only later items rise in', () => {
  const history = [message('a', 'Earlier answer')]
  const { rerender } = render(<SessionTimeline items={history} />)
  expect(article('Earlier answer').classList.contains('tm-rise-in')).toBe(false)

  rerender(<SessionTimeline items={[...history, message('b', 'New answer')]} />)
  expect(article('Earlier answer').classList.contains('tm-rise-in')).toBe(false)
  expect(article('New answer').classList.contains('tm-rise-in')).toBe(true)
})

it('animates the first items of a conversation that started empty', () => {
  render(<SessionTimeline items={[message('a', 'First answer')]} animateInitial />)
  expect(article('First answer').classList.contains('tm-rise-in')).toBe(true)
})

it('lets a message that was empty while streaming rise in once it has text', () => {
  const { rerender } = render(
    <SessionTimeline items={[message('a', 'Earlier answer'), message('b', '')]} />
  )
  rerender(<SessionTimeline items={[message('a', 'Earlier answer'), message('b', 'Streamed')]} />)
  expect(article('Streamed').classList.contains('tm-rise-in')).toBe(true)
})

it('opens a long conversation at its newest end and loads older chunks on demand', () => {
  vi.useFakeTimers()
  try {
    const history = Array.from({ length: 100 }, (_, index) =>
      message(`m${index}`, `Answer ${index}`)
    )
    render(<SessionTimeline items={history} />)
    expect(screen.queryByText('Answer 99')).not.toBeNull()
    expect(screen.queryByText('Answer 0')).toBeNull()

    // Idle time alone must not prepend older rows (prevents thread-switch scroll wobble).
    vi.advanceTimersByTime(2_000)
    expect(screen.queryByText('Answer 0')).toBeNull()

    // Clicking "Load earlier messages" loads chunks until the start is reached.
    while (screen.queryByRole('button', { name: /Load earlier messages/ })) {
      fireEvent.click(screen.getByRole('button', { name: /Load earlier messages/ }))
    }
    expect(screen.queryByText('Answer 0')).not.toBeNull()
    // Loaded history is not new: it doesn't animate.
    expect(article('Answer 0').classList.contains('tm-rise-in')).toBe(false)
  } finally {
    vi.useRealTimers()
  }
})

it('loads older chunks when scrolling near the top and preserves scroll position', () => {
  const history = Array.from({ length: 100 }, (_, index) => message(`m${index}`, `Answer ${index}`))
  const onScrollAdjusted = vi.fn()
  const { container } = render(
    <div style={{ overflowY: 'auto' }}>
      <SessionTimeline items={history} onScrollAdjusted={onScrollAdjusted} />
    </div>
  )
  const scroller = container.firstElementChild as HTMLDivElement
  Object.defineProperties(scroller, {
    scrollHeight: {
      get: () => scroller.querySelectorAll('article').length * 50,
      configurable: true
    },
    clientHeight: { value: 400, configurable: true }
  })
  const beforeHeight = scroller.scrollHeight
  scroller.scrollTop = 100
  fireEvent.scroll(scroller)
  expect(screen.queryByText(`Answer ${100 - INITIAL_ROWS - 1}`)).not.toBeNull()
  const expectedScrollTop = 100 + (scroller.scrollHeight - beforeHeight)
  expect(scroller.scrollTop).toBe(expectedScrollTop)
  expect(onScrollAdjusted).toHaveBeenCalledWith(expectedScrollTop)
})

it('reveals down to a targeted older item synchronously without mounting earlier history', () => {
  const history = Array.from({ length: 100 }, (_, index) => message(`m${index}`, `Answer ${index}`))
  const { rerender } = render(<SessionTimeline items={history} />)
  expect(screen.queryByText('Answer 40')).toBeNull()

  rerender(<SessionTimeline items={history} revealRequest={{ id: 'm40', nonce: 1 }} />)
  expect(screen.queryByText('Answer 40')).not.toBeNull()
  expect(screen.queryByText('Answer 0')).toBeNull()
})

it('trims oldest rows while following a long-running session without re-animating them later', () => {
  const initial = Array.from({ length: 10 }, (_, index) => message(`m${index}`, `Answer ${index}`))
  const { rerender } = render(<SessionTimeline items={initial} following />)
  const grown = Array.from({ length: MAX_FOLLOW_ROWS + 5 }, (_, index) =>
    message(`m${index}`, `Answer ${index}`)
  )
  rerender(<SessionTimeline items={grown} following />)
  expect(screen.queryByText(`Answer ${MAX_FOLLOW_ROWS + 4}`)).not.toBeNull()
  expect(screen.queryByText('Answer 0')).toBeNull()
  expect(screen.queryByText(`Answer ${grown.length - TRIM_KEEP_ROWS}`)).not.toBeNull()

  // Scrolling back up to trimmed rows mounts them without replaying the rise-in animation.
  rerender(<SessionTimeline items={grown} following={false} />)
  while (screen.queryByRole('button', { name: /Load earlier messages/ })) {
    fireEvent.click(screen.getByRole('button', { name: /Load earlier messages/ }))
  }
  expect(article('Answer 0').classList.contains('tm-rise-in')).toBe(false)
})

it('renders the whole history at once when asked', () => {
  const history = Array.from({ length: 100 }, (_, index) => message(`m${index}`, `Answer ${index}`))
  render(<SessionTimeline items={history} showAll />)
  expect(screen.queryByText('Answer 0')).not.toBeNull()
})

it('puts skills loaded together on one line', () => {
  const skill = (id: string, name: string): CopilotTimelineItem => ({
    id,
    type: 'skill',
    timestamp: '',
    name,
    description: `${name} docs`,
    invokedBy: 'copilot'
  })
  render(
    <SessionTimeline
      items={[
        skill('s1', 'review'),
        skill('s2', 'deploy'),
        message('a', 'Done'),
        skill('s3', 'lint')
      ]}
    />
  )
  const notes = screen.getAllByRole('note')
  expect(notes.map((note) => note.getAttribute('aria-label'))).toEqual([
    'Skills review, deploy loaded',
    'Skill lint loaded'
  ])
  expect(notes[0].textContent).toBe('Copilot loaded skillsreviewdeploy')
  expect(screen.getByText('deploy').title).toBe('deploy docs')
})

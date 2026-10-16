// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { RunningSubagents, WorkingIndicator } from './ConversationStates'
import { formatElapsed } from './prompt-cost'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

it('formats elapsed time compactly', () => {
  expect(formatElapsed(-5)).toBe('0s')
  expect(formatElapsed(42_900)).toBe('42s')
  expect(formatElapsed(185_000)).toBe('3m 05s')
  expect(formatElapsed(3_720_000)).toBe('1h 02m')
})

it('shows how long Copilot has been working, ticking every second', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2024-01-01T00:01:10Z'))
  const { rerender } = render(<WorkingIndicator waiting={false} since="2024-01-01T00:00:00Z" />)
  expect(screen.getByTitle('Time spent on this prompt').textContent).toBe('1m 10s')
  act(() => vi.advanceTimersByTime(2000))
  expect(screen.getByTitle('Time spent on this prompt').textContent).toBe('1m 12s')

  rerender(<WorkingIndicator waiting since="2024-01-01T00:00:00Z" />)
  expect(screen.queryByTitle('Time spent on this prompt')).toBeNull()
  rerender(<WorkingIndicator waiting={false} />)
  expect(screen.queryByTitle('Time spent on this prompt')).toBeNull()
})

it('lists running sub-agents with their model and runtime, keeping them while leaving', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2024-01-01T00:00:30Z'))
  const agents = [
    {
      id: 'a',
      name: 'Explore',
      description: 'Finds the parser',
      model: 'gpt-5.5',
      startedAt: '2024-01-01T00:00:00Z'
    },
    { id: 'b', name: 'task', description: '', model: null, startedAt: '2024-01-01T00:00:25Z' }
  ]
  const { rerender } = render(<RunningSubagents agents={agents} />)
  const rows = (): Array<string | null> =>
    within(screen.getByRole('list', { name: 'Running sub-agents' }))
      .getAllByRole('listitem')
      .map((row) => row.textContent)
  expect(rows()).toEqual(['ExploreFinds the parsergpt-5.5 · 30s', 'task5s'])
  act(() => vi.advanceTimersByTime(2000))
  expect(rows()).toEqual(['ExploreFinds the parsergpt-5.5 · 32s', 'task7s'])
  rerender(<RunningSubagents agents={[]} />)
  expect(rows()).toHaveLength(2)
})

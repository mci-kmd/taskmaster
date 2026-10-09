// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { CopilotTimelineItem } from '../../../../shared/app-types'
import SessionTimeline from './SessionTimeline'

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

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { CopilotSubagentUsage } from '../../../../shared/app-types'
import SessionTimelineItem from './SessionTimelineItem'

afterEach(cleanup)

const base = { type: 'summary' as const, timestamp: '', durationMs: 185_000, subagents: [] }

it('shows prompt time, credits and DKK estimate on one line', () => {
  render(<SessionTimelineItem item={{ ...base, id: 'a', nanoAiu: 12_345_000_000 }} />)
  expect(screen.getByLabelText('Prompt summary').textContent).toBe('3m 05s·12.35 credits·≈0.81 DKK')
  cleanup()
  render(<SessionTimelineItem item={{ ...base, id: 'b', nanoAiu: null }} />)
  expect(screen.getByLabelText('Prompt summary').textContent).toBe('3m 05s')
})

it('shows the sub-agent count with usage grouped by model and effort on hover', () => {
  const agent = (
    id: string,
    model: string | null,
    reasoningEffort: string | null,
    durationMs: number | null,
    nanoAiu: number | null
  ): CopilotSubagentUsage => ({ id, model, reasoningEffort, durationMs, nanoAiu })
  render(
    <SessionTimelineItem
      item={{
        ...base,
        id: 'a',
        nanoAiu: 5_000_000_000,
        subagents: [
          agent('1', 'gpt', 'high', 60_000, 1_000_000_000),
          agent('2', 'claude', null, 5000, null),
          agent('3', 'gpt', 'high', 30_000, 500_000_000),
          agent('4', 'gpt', 'low', null, 2_000_000_000)
        ]
      }}
    />
  )
  expect(screen.getByLabelText('Prompt summary').textContent).toBe(
    '3m 05s·5.00 credits·≈0.33 DKK·4'
  )
  const badge = screen.getByLabelText('4 sub-agents')
  expect(screen.queryByRole('tooltip')).toBeNull()
  fireEvent.mouseEnter(badge)
  const tooltip = screen.getByRole('tooltip')
  expect(badge.getAttribute('aria-describedby')).toBe(tooltip.id)
  const rows = within(tooltip)
    .getAllByRole('row')
    .map((row) => [...row.querySelectorAll('th, td')].map((cell) => cell.textContent))
  expect(rows).toEqual([
    ['Model', 'Effort', 'Agents', 'Runtime', 'Credits', '≈DKK'],
    ['gpt', 'high', '2', '1m 30s', '1.50', '0.10'],
    ['claude', '—', '1', '5.0s', '—', '—'],
    ['gpt', 'low', '1', '—', '2.00', '0.13'],
    ['Total', '4', '1m 35s', '3.50', '0.23']
  ])
  fireEvent.mouseLeave(badge)
  expect(screen.queryByRole('tooltip')).toBeNull()
})

it('shows a request Copilot made together with the answer', () => {
  render(
    <SessionTimelineItem
      item={{
        id: 'interaction:1',
        type: 'interaction',
        timestamp: '',
        title: 'Copilot needs your input',
        prompt: 'Which **database**?',
        answer: 'Postgres',
        outcome: 'answered'
      }}
    />
  )
  const request = screen.getByRole('region', { name: 'Copilot needs your input' })
  expect(within(request).getByText('database').tagName).toBe('STRONG')
  expect(within(request).getByText('You answered').nextSibling?.textContent).toBe('Postgres')
})

// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import SessionTimelineItem from './SessionTimelineItem'

afterEach(cleanup)

it('shows prompt time, credits and DKK estimate on one line', () => {
  const base = { type: 'summary' as const, timestamp: '', durationMs: 185_000 }
  render(<SessionTimelineItem item={{ ...base, id: 'a', nanoAiu: 12_345_000_000 }} />)
  expect(screen.getByLabelText('Prompt summary').textContent).toBe('3m 05s·12.35 credits·≈0.81 DKK')
  cleanup()
  render(<SessionTimelineItem item={{ ...base, id: 'b', nanoAiu: null }} />)
  expect(screen.getByLabelText('Prompt summary').textContent).toBe('3m 05s')
})

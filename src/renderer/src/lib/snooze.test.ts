import { describe, expect, it } from 'vitest'
import { formatSnoozeUntil } from './snooze'

describe('formatSnoozeUntil', () => {
  const now = new Date(2026, 0, 14, 15, 20)
  const time = (date: Date): string =>
    date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

  it('names today and tomorrow', () => {
    const later = new Date(2026, 0, 14, 16, 20)
    const tomorrow = new Date(2026, 0, 15, 8, 0)
    expect(formatSnoozeUntil(later.toISOString(), now)).toBe(`today ${time(later)}`)
    expect(formatSnoozeUntil(tomorrow.toISOString(), now)).toBe(`tomorrow ${time(tomorrow)}`)
  })

  it('names a later date', () => {
    const date = new Date(2026, 1, 20, 9, 0)
    expect(formatSnoozeUntil(date.toISOString(), now)).toContain(time(date))
    expect(formatSnoozeUntil(date.toISOString(), now)).not.toMatch(/^(today|tomorrow)/)
  })
})

import { describe, expect, it } from 'vitest'
import { formatSnoozeUntil, snoozeUntil } from './snooze'

describe('snoozeUntil', () => {
  // Wednesday 2026-01-14, 15:20 local time.
  const now = new Date(2026, 0, 14, 15, 20)

  it('snoozes for an hour', () => {
    expect(snoozeUntil('hour', now).getTime()).toBe(now.getTime() + 60 * 60 * 1000)
  })

  it('snoozes until tomorrow morning', () => {
    expect(snoozeUntil('tomorrow', now)).toEqual(new Date(2026, 0, 15, 8, 0))
  })

  it('snoozes until next Monday morning', () => {
    expect(snoozeUntil('next-week', now)).toEqual(new Date(2026, 0, 19, 8, 0))
    // On a Monday, next week is a week away.
    expect(snoozeUntil('next-week', new Date(2026, 0, 19, 7, 0))).toEqual(
      new Date(2026, 0, 26, 8, 0)
    )
  })
})

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

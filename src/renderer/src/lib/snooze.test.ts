import { describe, expect, it } from 'vitest'
import { formatSnoozeUntil, parseDateTimeInput } from './snooze'

describe('formatSnoozeUntil', () => {
  const now = new Date(2026, 0, 14, 15, 20)

  it('names today and tomorrow on a 24-hour clock', () => {
    const later = new Date(2026, 0, 14, 16, 20)
    const tomorrow = new Date(2026, 0, 15, 8, 0)
    expect(formatSnoozeUntil(later.toISOString(), now)).toMatch(/^today 16[:.]20$/)
    expect(formatSnoozeUntil(tomorrow.toISOString(), now)).toMatch(/^tomorrow 08[:.]00$/)
  })

  it('names a later date', () => {
    const date = new Date(2026, 1, 20, 21, 0)
    expect(formatSnoozeUntil(date.toISOString(), now)).toMatch(/ 21[:.]00$/)
    expect(formatSnoozeUntil(date.toISOString(), now)).not.toMatch(/^(today|tomorrow)/)
  })
})

describe('parseDateTimeInput', () => {
  it('reads 24-hour times', () => {
    expect(parseDateTimeInput('2026-01-14', '16:30')).toEqual(new Date(2026, 0, 14, 16, 30))
    expect(parseDateTimeInput('2026-01-14', '8:05')).toEqual(new Date(2026, 0, 14, 8, 5))
    expect(parseDateTimeInput('2026-01-14', '0000')).toEqual(new Date(2026, 0, 14, 0, 0))
  })

  it('rejects invalid input', () => {
    for (const [date, time] of [
      ['2026-01-14', '24:00'],
      ['2026-01-14', '12:60'],
      ['2026-01-14', '4 PM'],
      ['2026-02-30', '08:00'],
      ['', '08:00']
    ]) {
      expect(parseDateTimeInput(date, time)).toBeNull()
    }
  })
})

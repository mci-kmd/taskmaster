import { describe, expect, it } from 'vitest'
import { isSnoozePreset, snoozeUntil } from './snooze'

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

  it('recognizes presets', () => {
    expect(isSnoozePreset('next-week')).toBe(true)
    expect(isSnoozePreset('custom')).toBe(false)
  })
})

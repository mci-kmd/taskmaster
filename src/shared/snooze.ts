/** The quick snooze choices in a thread's menu. */
export const SNOOZE_PRESETS = ['hour', 'tomorrow', 'next-week'] as const

export type SnoozePreset = (typeof SNOOZE_PRESETS)[number]

export function isSnoozePreset(value: unknown): value is SnoozePreset {
  return SNOOZE_PRESETS.includes(value as SnoozePreset)
}

const MORNING_HOUR = 8

/** When a snooze chosen now ends: in an hour, tomorrow at 8:00, or next Monday at 8:00. */
export function snoozeUntil(preset: SnoozePreset, now: Date = new Date()): Date {
  if (preset === 'hour') return new Date(now.getTime() + 60 * 60 * 1000)
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), MORNING_HOUR)
  if (preset === 'tomorrow') {
    date.setDate(date.getDate() + 1)
  } else {
    // Days until the next Monday; a full week on a Monday.
    date.setDate(date.getDate() + ((8 - date.getDay()) % 7 || 7))
  }
  return date
}

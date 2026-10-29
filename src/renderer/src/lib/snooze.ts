/** The quick snooze choices in a thread's menu. */
export type SnoozePreset = 'hour' | 'tomorrow' | 'next-week'

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

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** A snooze end for display, e.g. "today 16:20", "tomorrow 08:00" or "Mon 19 Jan 08:00". */
export function formatSnoozeUntil(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'later'
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const days = Math.round((startOfDay(date) - startOfDay(now)) / (24 * 60 * 60 * 1000))
  if (days <= 0) return `today ${time}`
  if (days === 1) return `tomorrow ${time}`
  const day = date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' })
  })
  return `${day} ${time}`
}

/** A date as a `datetime-local` input value. */
export function toDateTimeLocalValue(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

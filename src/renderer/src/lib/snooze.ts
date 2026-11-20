export { snoozeUntil, type SnoozePreset } from '../../../shared/snooze'

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** A snooze end for display, e.g. "today 16:20", "tomorrow 08:00" or "Mon 19 Jan 08:00". */
export function formatSnoozeUntil(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'later'
  const time = date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  })
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

const pad = (value: number): string => String(value).padStart(2, '0')

/** A date as a `date` input value, e.g. "2026-01-14". */
export function toDateInputValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** A 24-hour clock time, e.g. "08:00". */
export function toTimeInputValue(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Combines a `date` input value and a 24-hour time ("8:05", "08:05" or "0805") into a local date. */
export function parseDateTimeInput(date: string, time: string): Date | null {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const clock = /^([01]?\d|2[0-3])[:.]?([0-5]\d)$/.exec(time.trim())
  if (!day || !clock) return null
  const result = new Date(
    Number(day[1]),
    Number(day[2]) - 1,
    Number(day[3]),
    Number(clock[1]),
    Number(clock[2])
  )
  return result.getDate() === Number(day[3]) ? result : null
}

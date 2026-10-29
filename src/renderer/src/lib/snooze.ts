export { snoozeUntil, type SnoozePreset } from '../../../shared/snooze'

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

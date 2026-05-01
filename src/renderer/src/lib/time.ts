export function formatRelativeTime(iso: string): string {
  const elapsed = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(elapsed / 60_000)
  const hours = Math.floor(elapsed / 3_600_000)
  const days = Math.floor(elapsed / 86_400_000)
  const weeks = Math.floor(days / 7)
  const months = Math.floor(days / 30)

  if (minutes < 1) {
    return 'now'
  }

  if (minutes < 60) {
    return `${minutes}m`
  }

  if (hours < 24) {
    return `${hours}h`
  }

  if (days < 7) {
    return `${days}d`
  }

  if (weeks < 5) {
    return `${weeks}w`
  }

  return `${months}mo`
}

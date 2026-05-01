import { useEffect, useState } from 'react'

/**
 * Returns Date.now() that updates every `intervalMs`. Use this to keep
 * relative-time labels fresh without per-component intervals.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])

  return now
}

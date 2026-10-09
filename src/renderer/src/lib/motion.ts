import { createContext, useContext, useEffect, useState } from 'react'

/** Mirrors the motion tokens in styles/tokens.css. */
export const MOTION = {
  fastMs: 120,
  baseMs: 180,
  slowMs: 260,
  exitMs: 140,
  easeOut: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  easeIn: 'cubic-bezier(0.4, 0, 1, 1)'
} as const

/** The presets in styles/motion.css. */
export type MotionPreset = 'fade' | 'pop' | 'drop' | 'rise' | 'collapse'
export type PresenceState = 'open' | 'closed'

/** Whether animations will run: false without the Web Animations API (tests) or when reduced. */
export function canAnimate(): boolean {
  if (typeof window === 'undefined' || typeof Element.prototype.animate !== 'function') {
    return false
  }
  return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/**
 * True inside something that is animating out (provided by <Presence> and Modal). React context
 * crosses portals, so popovers opened from a leaving view know to close with it.
 */
export const LeavingContext = createContext(false)

/**
 * Keeps something mounted while it animates out. `state` is 'closed' during the exit; give it
 * to the element as data-state alongside a data-motion preset (see styles/motion.css). Anything
 * inside a leaving owner (see LeavingContext) closes too.
 */
export function usePresence(
  requested: boolean,
  exitMs: number = MOTION.exitMs
): { mounted: boolean; state: PresenceState } {
  const leaving = useContext(LeavingContext)
  const show = requested && !leaving
  const [mounted, setMounted] = useState(show)
  if (show && !mounted) setMounted(true)
  const animates = canAnimate()

  useEffect(() => {
    if (show || !mounted) return
    const timer = window.setTimeout(() => setMounted(false), animates ? exitMs + 20 : 0)
    return () => window.clearTimeout(timer)
  }, [animates, exitMs, mounted, show])

  return { mounted: show || (mounted && animates), state: show ? 'open' : 'closed' }
}

/** Remembers the last non-empty value so leaving content keeps rendering it while it animates. */
export function useLastValue<T>(value: T | null | undefined): T | null {
  const [last, setLast] = useState<T | null>(value ?? null)
  if (value !== null && value !== undefined && value !== last) setLast(value)
  return value ?? last
}

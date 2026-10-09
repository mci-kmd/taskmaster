import { cloneElement, isValidElement, type ReactElement } from 'react'
import { LeavingContext, useLastValue, usePresence, type MotionPreset } from '../../lib/motion'

/**
 * Animates its child in and out with a motion preset (styles/motion.css). While leaving, the
 * child keeps showing what it last rendered, so `{error ? <p>{error}</p> : null}` can be
 * wrapped as is. The child must be a DOM element: it receives data-motion and data-state.
 */
export default function Presence({
  show,
  motion,
  children
}: {
  show: boolean
  motion: MotionPreset
  children: ReactElement | null | false | undefined
}): ReactElement | null {
  const { mounted, state } = usePresence(show)
  const current = show && isValidElement(children) ? children : null
  const last = useLastValue(current)
  const child = current ?? last
  if (!mounted || !child) return null
  return (
    <LeavingContext.Provider value={state === 'closed'}>
      {cloneElement(child as ReactElement<Record<string, unknown>>, {
        'data-motion': motion,
        'data-state': state,
        inert: state === 'closed' || undefined
      })}
    </LeavingContext.Provider>
  )
}

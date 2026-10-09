import { useState } from 'react'
import { usePresence } from '../../lib/motion'

/**
 * Keeps a dialog's content mounted while it animates out, and numbers each opening so the
 * content can be keyed by it: drafts reset every time the dialog opens, even when it reopens
 * before the previous exit finished.
 */
export function useDialogSession(open: boolean): { mounted: boolean; key: number } {
  const { mounted } = usePresence(open)
  const [session, setSession] = useState({ open, key: 0 })
  if (session.open !== open) {
    setSession({ open, key: open ? session.key + 1 : session.key })
  }
  return { mounted, key: session.key }
}

/**
 * The value while the dialog is open, frozen at its last open value while it animates out
 * (callers often clear what the dialog was editing as they close it).
 */
export function useOpenValue<T>(value: T, open: boolean): T {
  const [held, setHeld] = useState(value)
  if (open && held !== value) setHeld(value)
  return open ? value : held
}

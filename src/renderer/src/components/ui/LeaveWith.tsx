import { useContext, type ReactNode } from 'react'
import { LeavingContext } from '../../lib/motion'

/**
 * Marks content as leaving while `leaving` is true (or an ancestor is), so presence-managed
 * popovers inside it, portalled or not, close with it. Use it in rows that animate out of a
 * presence list; <Presence> and Modal already do this for their content.
 */
export default function LeaveWith({
  leaving,
  children
}: {
  leaving: boolean
  children: ReactNode
}): React.JSX.Element {
  const ancestorLeaving = useContext(LeavingContext)
  return (
    <LeavingContext.Provider value={leaving || ancestorLeaving}>{children}</LeavingContext.Provider>
  )
}

import { useLayoutEffect, useRef } from 'react'

/** Animate row insertion and reordering without moving the list's surrounding layout. */
export function useListMotion(): React.RefObject<HTMLUListElement | null> {
  const list = useRef<HTMLUListElement>(null)
  const previous = useRef(new Map<string, number>())
  useLayoutEffect(() => {
    const next = new Map<string, number>()
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    for (const child of Array.from(list.current?.children ?? [])) {
      if (!(child instanceof HTMLElement) || !child.dataset.threadId) continue
      const id = child.dataset.threadId
      const top = child.offsetTop
      const oldTop = previous.current.get(id)
      next.set(id, top)
      if (reduceMotion || !child.animate) continue
      if (oldTop === undefined || oldTop !== top)
        child.getAnimations().forEach((animation) => animation.cancel())
      if (oldTop === undefined) {
        child.animate(
          [
            { opacity: 0, transform: 'translateY(4px)' },
            { opacity: 1, transform: 'translateY(0)' }
          ],
          { duration: 140, easing: 'ease-out' }
        )
      } else if (oldTop !== top) {
        child.animate(
          [{ transform: `translateY(${oldTop - top}px)` }, { transform: 'translateY(0)' }],
          { duration: 180, easing: 'ease-out' }
        )
      }
    }
    previous.current = next
  })
  return list
}

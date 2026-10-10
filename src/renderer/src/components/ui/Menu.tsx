import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { usePresence } from '../../lib/motion'

export type MenuItem = { label: string; disabled?: boolean; onSelect: () => void }

/** Where a menu opens: below a trigger element, or at a point (e.g. a right-click). */
export type MenuAnchor = { element: RefObject<HTMLElement | null> } | { x: number; y: number }

const MENU_WIDTH = 180
const MARGIN = 8

/**
 * A themed menu popup (the app's replacement for native menus). It focuses its first item,
 * moves with the arrow keys, Home and End, closes on Escape, Tab, a click elsewhere, resizing
 * or scrolling, and animates in and out.
 */
export default function Menu({
  open,
  anchor,
  label,
  items,
  onClose,
  ignore
}: {
  open: boolean
  anchor: MenuAnchor | null
  label: string
  items: MenuItem[]
  /** `restoreFocus` is true when the menu was closed from the keyboard or by choosing an item. */
  onClose: (restoreFocus: boolean) => void
  /** An element (the trigger) whose clicks don't count as clicking elsewhere. */
  ignore?: RefObject<HTMLElement | null>
}): React.JSX.Element | null {
  const menu = useRef<HTMLDivElement>(null)
  const popup = usePresence(open)
  const onCloseRef = useRef(onClose)
  useLayoutEffect(() => {
    onCloseRef.current = onClose
  })

  useLayoutEffect(() => {
    const element = menu.current
    if (!open || !element || !anchor) return
    const width = Math.min(MENU_WIDTH, window.innerWidth - MARGIN * 2)
    element.style.width = `${width}px`
    element.style.maxHeight = `${window.innerHeight - MARGIN * 2}px`
    const height = element.offsetHeight
    let left: number
    let top: number
    if ('element' in anchor) {
      const bounds = anchor.element.current?.getBoundingClientRect()
      if (!bounds) return
      left = bounds.right - width
      top = bounds.bottom + 6
    } else {
      left = anchor.x
      top = anchor.y
    }
    // Keep the menu on screen; near the bottom it opens upwards from the anchor.
    const fitsBelow = top + height <= window.innerHeight - MARGIN
    if (!fitsBelow && !('element' in anchor)) top = anchor.y - height
    element.style.left = `${Math.max(MARGIN, Math.min(left, window.innerWidth - width - MARGIN))}px`
    element.style.top = `${Math.max(MARGIN, Math.min(top, window.innerHeight - height - MARGIN))}px`
    element.dataset.placement = fitsBelow ? 'bottom' : 'top'
    element.style.visibility = 'visible'
    // Focus the first item when the menu opens (or its focused item went away), but leave it
    // where it is when the menu is merely re-placed or its items update.
    if (!element.contains(document.activeElement)) {
      element.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus()
    }
  }, [open, anchor])

  useEffect(() => {
    if (!open) return
    const outside = (event: Event): void => {
      if (
        event.target instanceof Node &&
        !menu.current?.contains(event.target) &&
        !ignore?.current?.contains(event.target)
      )
        onCloseRef.current(false)
    }
    const dismiss = (): void => onCloseRef.current(false)
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', outside)
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('focusin', outside)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismiss, true)
    }
  }, [open, ignore])

  if (!popup.mounted) return null
  return createPortal(
    <div
      ref={menu}
      role="menu"
      aria-label={label}
      className="tm-picker-popup"
      data-motion="drop"
      data-state={popup.state}
      style={{ position: 'fixed', visibility: 'hidden' }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onClose(true)
        } else if (event.key === 'Tab') {
          onClose(true)
        } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault()
          const buttons = Array.from(
            menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ??
              []
          )
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? buttons.length - 1
                : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
          buttons[next]?.focus()
        }
      }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          role="menuitem"
          type="button"
          className="tm-action-menu-item"
          disabled={item.disabled}
          onClick={() => {
            onClose(true)
            item.onSelect()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body
  )
}

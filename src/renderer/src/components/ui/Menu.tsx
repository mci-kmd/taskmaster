import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { usePresence } from '../../lib/motion'
import { ChevronRightIcon } from '../Icons'

/** A menu entry: an action, or a submenu that flies out beside it. */
export type MenuItem = { label: string; disabled?: boolean } & (
  { onSelect: () => void; items?: never } | { items: MenuItem[]; onSelect?: never }
)

/** Where a menu opens: below a trigger element, or at a point (e.g. a right-click). */
export type MenuAnchor = { element: RefObject<HTMLElement | null> } | { x: number; y: number }

const MENU_WIDTH = 180
const MARGIN = 8
const ITEM_SELECTOR = '[role="menuitem"]:not(:disabled)'

function menuButtons(element: HTMLElement | null): HTMLButtonElement[] {
  return Array.from(element?.querySelectorAll<HTMLButtonElement>(ITEM_SELECTOR) ?? [])
}

/** Moves focus among a menu's items for the arrow keys, Home and End; true if it handled the key. */
function moveFocus(element: HTMLElement | null, key: string): boolean {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) return false
  const buttons = menuButtons(element)
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const next =
    key === 'Home'
      ? 0
      : key === 'End'
        ? buttons.length - 1
        : (index + (key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
  buttons[next]?.focus()
  return true
}

/**
 * A themed menu popup (the app's replacement for native menus). It focuses its first item,
 * moves with the arrow keys, Home and End, closes on Escape, Tab, a click elsewhere, resizing
 * or scrolling, and animates in and out. Items with `items` open a submenu on hover, click,
 * Enter or ArrowRight; ArrowLeft or Escape returns to the parent item.
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
  const submenu = useRef<HTMLDivElement>(null)
  const popup = usePresence(open)
  const onCloseRef = useRef(onClose)
  // The open submenu: its parent item's label, and whether to focus its first item.
  const [sub, setSub] = useState<{ label: string; focus: boolean } | null>(null)
  useLayoutEffect(() => {
    onCloseRef.current = onClose
  })
  if (!open && sub) setSub(null)
  const subItems = sub ? items.find((item) => item.label === sub.label)?.items : undefined
  if (sub && !subItems) setSub(null)

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
    if (
      !element.contains(document.activeElement) &&
      !submenu.current?.contains(document.activeElement)
    ) {
      element.querySelector<HTMLButtonElement>(ITEM_SELECTOR)?.focus()
    }
  }, [open, anchor])

  // Places the submenu beside its parent item: to the right, or to the left if there's no room.
  useLayoutEffect(() => {
    const element = submenu.current
    if (!sub || !element) return
    const parent = parentItem(menu.current, sub.label)
    if (!parent) return
    const bounds = parent.getBoundingClientRect()
    const width = Math.min(MENU_WIDTH, window.innerWidth - MARGIN * 2)
    element.style.width = `${width}px`
    element.style.maxHeight = `${window.innerHeight - MARGIN * 2}px`
    const height = element.offsetHeight
    const right = bounds.right + 4
    const left = right + width <= window.innerWidth - MARGIN ? right : bounds.left - width - 4
    element.style.left = `${Math.max(MARGIN, left)}px`
    element.style.top = `${Math.max(MARGIN, Math.min(bounds.top - 4, window.innerHeight - height - MARGIN))}px`
    element.style.visibility = 'visible'
    if (sub.focus && !element.contains(document.activeElement)) {
      element.querySelector<HTMLButtonElement>(ITEM_SELECTOR)?.focus()
    }
  }, [sub])

  useEffect(() => {
    if (!open) return
    const outside = (event: Event): void => {
      if (
        event.target instanceof Node &&
        !menu.current?.contains(event.target) &&
        !submenu.current?.contains(event.target) &&
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

  const closeSubmenu = (): void => {
    if (!sub) return
    parentItem(menu.current, sub.label)?.focus()
    setSub(null)
  }

  if (!popup.mounted) return null
  return (
    <>
      {createPortal(
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
            } else if (moveFocus(menu.current, event.key)) {
              event.preventDefault()
            }
          }}
        >
          {items.map((item) =>
            item.items ? (
              <button
                key={item.label}
                role="menuitem"
                type="button"
                className="tm-action-menu-item"
                data-submenu=""
                aria-haspopup="menu"
                aria-expanded={sub?.label === item.label}
                disabled={item.disabled}
                onPointerEnter={() => {
                  if (sub?.label !== item.label) setSub({ label: item.label, focus: false })
                }}
                onClick={() => setSub({ label: item.label, focus: true })}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowRight' || event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    event.stopPropagation()
                    setSub({ label: item.label, focus: true })
                  }
                }}
              >
                <span>{item.label}</span>
                <ChevronRightIcon width={12} height={12} strokeWidth={1.8} aria-hidden="true" />
              </button>
            ) : (
              <button
                key={item.label}
                role="menuitem"
                type="button"
                className="tm-action-menu-item"
                disabled={item.disabled}
                onPointerEnter={() => setSub(null)}
                onClick={() => {
                  onClose(true)
                  item.onSelect()
                }}
              >
                {item.label}
              </button>
            )
          )}
        </div>,
        document.body
      )}
      {open && sub && subItems
        ? createPortal(
            <div
              ref={submenu}
              role="menu"
              aria-label={sub.label}
              className="tm-picker-popup"
              style={{ position: 'fixed', visibility: 'hidden' }}
              onContextMenu={(event) => event.preventDefault()}
              onKeyDown={(event) => {
                if (event.key === 'Escape' || event.key === 'ArrowLeft') {
                  event.preventDefault()
                  event.stopPropagation()
                  closeSubmenu()
                } else if (event.key === 'Tab') {
                  onClose(true)
                } else if (moveFocus(submenu.current, event.key)) {
                  event.preventDefault()
                }
              }}
            >
              {subItems.map((item) => (
                <button
                  key={item.label}
                  role="menuitem"
                  type="button"
                  className="tm-action-menu-item"
                  disabled={item.disabled}
                  onClick={() => {
                    onClose(true)
                    item.onSelect?.()
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  )
}

function parentItem(menu: HTMLElement | null, label: string): HTMLButtonElement | null {
  return (
    Array.from(menu?.querySelectorAll<HTMLButtonElement>('[aria-haspopup="menu"]') ?? []).find(
      (button) => button.textContent === label
    ) ?? null
  )
}

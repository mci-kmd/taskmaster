import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export default function ActionMenu({
  label,
  items,
  children
}: {
  label: string
  items: Array<{ label: string; onSelect: () => void }>
  children: ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  function close(restoreFocus: boolean): void {
    setOpen(false)
    if (restoreFocus) trigger.current?.focus()
  }

  useLayoutEffect(() => {
    if (!open) return
    const bounds = trigger.current?.getBoundingClientRect()
    if (!bounds) return
    const element = menu.current
    if (!element) return
    const width = Math.min(180, window.innerWidth - 16)
    element.style.width = `${width}px`
    element.style.maxHeight = `${window.innerHeight - 16}px`
    const height = element.offsetHeight
    element.style.left = `${Math.max(8, Math.min(bounds.right - width, window.innerWidth - width - 8))}px`
    element.style.top = `${Math.max(8, Math.min(bounds.bottom + 4, window.innerHeight - height - 8))}px`
    element.style.visibility = 'visible'
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const outside = (event: Event): void => {
      if (
        event.target instanceof Node &&
        !menu.current?.contains(event.target) &&
        !trigger.current?.contains(event.target)
      )
        close(false)
    }
    const dismiss = (): void => close(false)
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
  }, [open])

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="tm-inbox-action grid size-6 place-items-center rounded text-[var(--color-fg-subtle)]"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        {children}
      </button>
      {open
        ? createPortal(
            <div
              ref={menu}
              role="menu"
              aria-label={label}
              className="tm-picker-popup"
              style={{ position: 'fixed', visibility: 'hidden' }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  event.stopPropagation()
                  close(true)
                } else if (event.key === 'Tab') {
                  close(true)
                } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                  event.preventDefault()
                  const buttons = Array.from(
                    menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []
                  )
                  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
                  const next =
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? buttons.length - 1
                        : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
                          buttons.length
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
                  onClick={() => {
                    close(true)
                    item.onSelect()
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

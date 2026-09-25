import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CopilotSendDelivery } from '../../../../shared/app-types'
import { ChevronDownIcon } from '../Icons'

export type SendMode = 'send' | CopilotSendDelivery

const MODES: Record<SendMode, { label: string; title: string }> = {
  send: { label: 'Send', title: 'Send message (Enter)' },
  steer: {
    label: 'Steer',
    title: 'Send now so Copilot adjusts the work in progress (Enter)'
  },
  queue: { label: 'Queue', title: 'Send when Copilot finishes the current work (Enter)' }
}

const DELIVERIES: Array<{ value: CopilotSendDelivery; description: string }> = [
  { value: 'steer', description: 'Send now. Copilot adjusts the work in progress.' },
  { value: 'queue', description: 'Send when Copilot finishes. Cancel any time before then.' }
]

/**
 * The composer's primary action. While Copilot works it becomes a split button:
 * the main segment steers or queues, and the dropdown segment picks between them.
 */
export default function SendButton({
  running,
  canSteer = true,
  delivery,
  disabled,
  busy = false,
  onDeliveryChange,
  onSend
}: {
  running: boolean
  canSteer?: boolean
  delivery: CopilotSendDelivery
  disabled: boolean
  busy?: boolean
  onDeliveryChange: (delivery: CopilotSendDelivery) => void
  onSend: () => void
}): React.JSX.Element {
  const mode: SendMode = !running ? 'send' : canSteer ? delivery : 'queue'
  const split = running && canSteer
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const group = useRef<HTMLDivElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const menuOpen = open && split

  const close = (restoreFocus: boolean): void => {
    setOpen(false)
    if (restoreFocus) toggle.current?.focus()
  }

  if (!split && open) setOpen(false)

  const position = (): void => {
    const bounds = group.current?.getBoundingClientRect()
    const element = menu.current
    if (!bounds || !element) return
    const width = Math.min(280, window.innerWidth - 16)
    element.style.width = `${width}px`
    const height = element.offsetHeight
    const above = bounds.top - height - 6
    element.style.left = `${Math.max(8, Math.min(bounds.right - width, window.innerWidth - width - 8))}px`
    element.style.top = `${above >= 8 ? above : Math.min(bounds.bottom + 6, window.innerHeight - height - 8)}px`
    element.style.visibility = 'visible'
  }

  useLayoutEffect(() => {
    if (!menuOpen) return
    position()
    menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
  }, [menuOpen])

  useEffect(() => {
    if (!menuOpen) return
    const outside = (event: Event): void => {
      if (
        event.target instanceof Node &&
        !menu.current?.contains(event.target) &&
        !toggle.current?.contains(event.target)
      )
        setOpen(false)
    }
    // The timeline auto-scrolls while Copilot streams, so follow the button instead of closing.
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', outside)
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('focusin', outside)
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
    }
  }, [menuOpen])

  return (
    <div
      ref={group}
      className="tm-send"
      role="group"
      aria-label="Send message"
      data-mode={mode}
      data-split={split}
      data-disabled={disabled || undefined}
    >
      <button
        type="button"
        className="tm-send-main"
        disabled={disabled}
        aria-label={MODES[mode].label}
        aria-busy={busy || undefined}
        title={MODES[mode].title}
        onClick={onSend}
      >
        {/* Every label shares one cell, so the button keeps its width while they crossfade. */}
        <span className="tm-send-labels" aria-hidden="true">
          {(Object.keys(MODES) as SendMode[]).map((key) => (
            <span key={key} data-active={key === mode}>
              {MODES[key].label}
            </span>
          ))}
        </span>
        <svg
          className="tm-send-arrow"
          aria-hidden="true"
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
        </svg>
      </button>
      <button
        ref={toggle}
        type="button"
        className="tm-send-toggle"
        disabled={!split}
        tabIndex={split ? undefined : -1}
        aria-hidden={split ? undefined : true}
        aria-label="Choose how to send while Copilot works"
        title="Choose how to send while Copilot works"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? menuId : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        <ChevronDownIcon width={12} height={12} aria-hidden="true" />
      </button>
      {menuOpen
        ? createPortal(
            <div
              ref={menu}
              id={menuId}
              role="menu"
              aria-label="Send while Copilot works"
              className="tm-picker-popup tm-send-menu"
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
                  const items = Array.from(
                    menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ??
                      []
                  )
                  const index = items.indexOf(document.activeElement as HTMLButtonElement)
                  const next =
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? items.length - 1
                        : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) %
                          items.length
                  items[next]?.focus()
                }
              }}
            >
              {DELIVERIES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={option.value === delivery}
                  className="tm-send-menu-item"
                  onClick={() => {
                    close(false)
                    onDeliveryChange(option.value)
                  }}
                >
                  <span className="tm-send-menu-check" aria-hidden="true">
                    {option.value === delivery ? '✓' : ''}
                  </span>
                  <span className="min-w-0">
                    <span className="tm-send-menu-label">{MODES[option.value].label}</span>
                    <span className="tm-send-menu-description">{option.description}</span>
                  </span>
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </div>
  )
}

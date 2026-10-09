import { useEffect, useId, useMemo } from 'react'
import { CloseIcon } from './Icons'
import Button from './ui/Button'
import { useLastValue, usePresence } from '../lib/motion'

type ModalProps = {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  /** Rendered in the header beside the close button, e.g. a save status. */
  headerExtra?: React.ReactNode
  width?: 'sm' | 'md' | 'lg' | 'xl'
  /** Fixed-height panel whose body lays out and scrolls its own content without padding. */
  fill?: boolean
}

const widths = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-[880px]'
}

/**
 * A dialog that pops in and animates out. It stays mounted while closing, so callers that
 * render it conditionally should keep it mounted until `usePresence(open).mounted` is false.
 */
export default function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  headerExtra,
  width = 'md',
  fill = false
}: ModalProps): React.JSX.Element | null {
  const titleId = useId()
  const { mounted, state } = usePresence(open)
  // Keep the content that was showing while the dialog animates out.
  const current = useMemo(
    () => (open ? { title, description, children, footer, headerExtra } : null),
    [open, title, description, children, footer, headerExtra]
  )
  const content = useLastValue(current)

  useEffect(() => {
    if (!open) {
      return
    }

    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!mounted || !content) {
    return null
  }

  return (
    <div
      aria-labelledby={titleId}
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      inert={!open}
      role="dialog"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-overlay backdrop-blur-[2px]"
        data-motion="fade"
        data-state={state}
        onClick={onClose}
      />

      <div
        className={`relative flex max-h-[calc(100dvh-2rem)] w-full ${widths[width]} ${fill ? 'h-[min(600px,calc(100dvh-2rem))] sm:h-[min(600px,calc(100dvh-3rem))]' : ''} min-h-0 flex-col overflow-hidden rounded-xl bg-panel elevation-pop sm:max-h-[calc(100dvh-3rem)]`}
        data-motion="pop"
        data-state={state}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold tracking-tight text-fg" id={titleId}>
              {content.title}
            </h2>
            {content.description ? (
              <p className="mt-1 text-[13px] leading-5 text-fg-muted">{content.description}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {content.headerExtra}
            <Button
              aria-label="Close dialog"
              className="-m-1"
              iconOnly
              onClick={onClose}
              size="sm"
              title="Close (Esc)"
              variant="ghost"
            >
              <CloseIcon />
            </Button>
          </div>
        </header>

        {fill ? (
          <div className="flex min-h-0 flex-1">{content.children}</div>
        ) : (
          <div className="min-h-0 overflow-y-auto px-5 py-5">{content.children}</div>
        )}

        {content.footer ? (
          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border bg-surface px-5 py-3">
            {content.footer}
          </footer>
        ) : null}
      </div>
    </div>
  )
}

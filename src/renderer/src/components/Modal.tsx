import { useEffect } from 'react'
import { CloseIcon } from './Icons'

type ModalProps = {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  width?: 'sm' | 'md' | 'lg'
}

const widths = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl'
}

export default function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  width = 'md'
}: ModalProps): React.JSX.Element | null {
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

  if (!open) {
    return null
  }

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center px-6 pt-[14vh]"
      role="dialog"
    >
      <div
        aria-hidden="true"
        className="tm-fade-in absolute inset-0 bg-black/55 backdrop-blur-[2px]"
        onClick={onClose}
      />

      <div
        className={`tm-pop-in relative w-full ${widths[width]} overflow-hidden rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface-2)] shadow-[var(--shadow-pop)]`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-[15px] font-medium tracking-tight text-[var(--color-fg)]">
              {title}
            </h2>
            {description ? (
              <p className="mt-1 text-[13px] leading-5 text-[var(--color-fg-muted)]">
                {description}
              </p>
            ) : null}
          </div>
          <button
            aria-label="Close dialog"
            className="-m-1 grid size-7 place-items-center rounded-md text-[var(--color-fg-subtle)] transition hover:bg-[var(--color-hover)] hover:text-[var(--color-fg)]"
            onClick={onClose}
            type="button"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="px-5 py-5">{children}</div>

        {footer ? (
          <footer className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  )
}

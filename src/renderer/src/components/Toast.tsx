import { useEffect } from 'react'
import { CloseIcon } from './Icons'

export type ToastTone = 'error' | 'success' | 'info'

type ToastProps = {
  tone: ToastTone
  message: string
  onDismiss: () => void
}

const toneStyles: Record<ToastTone, string> = {
  error: 'border-[rgba(240,140,140,0.35)] bg-[rgba(240,140,140,0.06)] text-[var(--color-danger)]',
  success:
    'border-[rgba(110,231,168,0.3)] bg-[rgba(110,231,168,0.05)] text-[var(--color-positive)]',
  info: 'border-[var(--color-border-strong)] bg-[var(--color-surface-2)] text-[var(--color-fg)]'
}

export default function Toast({ tone, message, onDismiss }: ToastProps): React.JSX.Element {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, tone === 'error' ? 6000 : 3500)
    return () => window.clearTimeout(timer)
  }, [tone, onDismiss])

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
      <div
        className={`tm-pop-in pointer-events-auto inline-flex max-w-md items-start gap-3 rounded-lg border px-3.5 py-2.5 text-[12.5px] leading-5 shadow-[0_18px_50px_-20px_rgba(0,0,0,0.7)] ${toneStyles[tone]}`}
        role="status"
      >
        <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-current opacity-80" />
        <span className="min-w-0 flex-1 text-[var(--color-fg)]">{message}</span>
        <button
          aria-label="Dismiss"
          className="-m-1 grid size-6 shrink-0 place-items-center rounded text-[var(--color-fg-subtle)] hover:bg-[var(--color-hover)] hover:text-[var(--color-fg)]"
          onClick={onDismiss}
          type="button"
        >
          <CloseIcon width={11} height={11} />
        </button>
      </div>
    </div>
  )
}

import { CloseIcon } from './Icons'

type ToastProps = {
  message: string
  onDismiss: () => void
}

/** Error toast; stays until dismissed. */
export default function Toast({ message, onDismiss }: ToastProps): React.JSX.Element {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
      <div
        className="tm-pop-in pointer-events-auto inline-flex max-w-md items-start gap-3 rounded-lg border px-3.5 py-2.5 text-[12.5px] leading-5 shadow-[0_18px_50px_-20px_rgba(0,0,0,0.7)] border-[rgba(240,140,140,0.45)] bg-[var(--color-surface-2)] text-[var(--color-danger)]"
        role="alert"
      >
        <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-current opacity-80" />
        <span className="min-w-0 flex-1 text-[var(--color-fg)]">{message}</span>
        <button
          aria-label="Dismiss"
          className="-m-1 grid size-6 shrink-0 place-items-center rounded text-[var(--color-fg-subtle)] hover:bg-[var(--color-hover)] hover:text-[var(--color-fg)]"
          onClick={onDismiss}
          title="Dismiss"
          type="button"
        >
          <CloseIcon width={11} height={11} />
        </button>
      </div>
    </div>
  )
}

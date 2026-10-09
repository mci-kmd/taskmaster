import { CloseIcon } from './Icons'
import Button from './ui/Button'
import Presence from './ui/Presence'

type ToastProps = {
  /** The error to show; null hides the toast. */
  message: string | null
  onDismiss: () => void
}

/** Error toast; rises in and stays until dismissed. */
export default function Toast({ message, onDismiss }: ToastProps): React.JSX.Element {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
      <Presence motion="rise" show={message !== null}>
        {message !== null ? (
          <div
            className="pointer-events-auto inline-flex max-w-md items-start gap-3 rounded-lg bg-popover px-3.5 py-2.5 text-[12.5px] leading-5 elevation-pop"
            role="alert"
          >
            <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-danger" />
            <span className="min-w-0 flex-1 text-fg">{message}</span>
            <Button
              aria-label="Dismiss"
              className="-m-1"
              iconOnly
              onClick={onDismiss}
              size="xs"
              title="Dismiss"
              variant="ghost"
            >
              <CloseIcon width={11} height={11} />
            </Button>
          </div>
        ) : null}
      </Presence>
    </div>
  )
}

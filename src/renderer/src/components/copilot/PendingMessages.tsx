import type { CopilotQueuedMessage } from '../../../../shared/app-types'
import { CloseIcon } from '../Icons'

/** Messages sent while Copilot works that it has not picked up yet. */
export default function PendingMessages({
  steering,
  queued,
  cancelling,
  onCancel
}: {
  steering: string[]
  queued: CopilotQueuedMessage[]
  cancelling: string | null
  onCancel: (id: string) => void
}): React.JSX.Element | null {
  if (!steering.length && !queued.length) return null
  return (
    <ol className="tm-session-pending" aria-label="Messages waiting for Copilot">
      {steering.map((text, index) => (
        <li className="tm-session-pending-item" data-kind="steer" key={`steer:${index}:${text}`}>
          <span className="tm-session-pending-kind">Steering</span>
          <span className="tm-session-pending-text" title={text}>
            {text}
          </span>
        </li>
      ))}
      {queued.map((item) => (
        <li className="tm-session-pending-item" data-kind="queue" key={item.id}>
          <span className="tm-session-pending-kind">Queued</span>
          <span className="tm-session-pending-text" title={item.text}>
            {item.text}
          </span>
          <button
            type="button"
            className="tm-session-pending-cancel"
            disabled={cancelling === item.id}
            aria-label={`Cancel queued message: ${item.text}`}
            title="Remove from queue"
            onClick={() => onCancel(item.id)}
          >
            <CloseIcon width={12} height={12} aria-hidden="true" />
          </button>
        </li>
      ))}
    </ol>
  )
}

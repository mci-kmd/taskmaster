import { useMemo } from 'react'
import type { CopilotQueuedMessage } from '../../../../shared/app-types'
import { CloseIcon } from '../Icons'
import Button from '../ui/Button'
import Presence from '../ui/Presence'
import { useAnimatedListMotion, usePresenceList } from '../../lib/use-presence-list'

type Pending =
  | { kind: 'steer'; key: string; text: string }
  | { kind: 'queue'; key: string; text: string; id: string }

/** Messages sent while Copilot works that it has not picked up yet. */
export default function PendingMessages({
  steering,
  queued,
  cancelling,
  onCancel,
  resetKey = ''
}: {
  steering: string[]
  queued: CopilotQueuedMessage[]
  cancelling: string | null
  onCancel: (id: string) => void
  /** Changing it (e.g. switching threads) swaps the list without animating. */
  resetKey?: string
}): React.JSX.Element | null {
  const items = useMemo<Pending[]>(
    () => [
      ...steering.map((text, index) => ({
        kind: 'steer' as const,
        key: `steer:${index}:${text}`,
        text
      })),
      ...queued.map((item) => ({
        kind: 'queue' as const,
        key: item.id,
        text: item.text,
        id: item.id
      }))
    ],
    [steering, queued]
  )
  const entries = usePresenceList(items, (item) => item.key, resetKey)
  const list = useAnimatedListMotion<HTMLOListElement>(resetKey)

  return (
    <Presence show={items.length > 0} motion="collapse">
      <div>
        <ol ref={list} className="tm-session-pending" aria-label="Messages waiting for Copilot">
          {entries.map(({ key, item, exitToken }) => (
            <li
              className="tm-session-pending-item"
              data-kind={item.kind}
              data-motion-key={key}
              data-exiting={exitToken === null ? undefined : ''}
              aria-hidden={exitToken === null ? undefined : true}
              key={key}
            >
              <span className="tm-session-pending-kind">
                {item.kind === 'steer' ? 'Steering' : 'Queued'}
              </span>
              <span className="tm-session-pending-text" title={item.text}>
                {item.text}
              </span>
              {item.kind === 'queue' ? (
                <Button
                  size="xs"
                  variant="ghost"
                  iconOnly
                  className="tm-session-pending-cancel"
                  disabled={cancelling === item.id || exitToken !== null}
                  aria-label={`Cancel queued message: ${item.text}`}
                  title="Remove from queue"
                  onClick={() => onCancel(item.id)}
                >
                  <CloseIcon width={12} height={12} aria-hidden="true" />
                </Button>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </Presence>
  )
}

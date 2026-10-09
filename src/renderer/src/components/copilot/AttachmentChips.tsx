import type { CopilotAttachment } from '../../../../shared/app-types'
import { PaperclipIcon } from '../Icons'
import Presence from '../ui/Presence'
import { usePresenceList } from '../../lib/use-presence-list'
import { attachmentPreview } from './attachment-markers'

const attachmentKey = (attachment: CopilotAttachment): string => attachment.id

/** Files attached to the draft; each chip pops in, and removes its file when clicked. */
export default function AttachmentChips({
  attachments,
  onRemove,
  resetKey = ''
}: {
  attachments: CopilotAttachment[]
  onRemove: (attachment: CopilotAttachment) => void
  /** Changing it (e.g. switching threads) swaps the chips without animating. */
  resetKey?: string
}): React.JSX.Element | null {
  const entries = usePresenceList(attachments, attachmentKey, resetKey)
  return (
    <Presence show={attachments.length > 0} motion="collapse">
      <div>
        <div className="tm-session-attachments">
          {entries.map(({ key, item: attachment, exitToken }) => {
            const preview = attachmentPreview(attachment)
            const leaving = exitToken !== null
            return (
              <button
                type="button"
                className="tm-session-attachment tm-session-attachment--removable"
                key={key}
                data-motion="pop"
                data-state={leaving ? 'closed' : 'open'}
                disabled={leaving}
                aria-hidden={leaving || undefined}
                aria-label={`Remove ${attachment.displayName}`}
                title={`Remove ${attachment.displayName}`}
                onClick={() => onRemove(attachment)}
              >
                {preview ? (
                  <img className="tm-session-attachment-thumb" src={preview} alt="" />
                ) : (
                  <PaperclipIcon className="tm-session-attachment-icon" aria-hidden="true" />
                )}
                <span className="tm-session-attachment-name">{attachment.displayName}</span>
                <span className="tm-session-attachment-remove" aria-hidden="true">
                  ×
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </Presence>
  )
}

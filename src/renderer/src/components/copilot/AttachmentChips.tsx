import { useState } from 'react'
import { DocumentIcon, PaperclipIcon } from '../Icons'
import Modal from '../Modal'
import Presence from '../ui/Presence'
import { usePresenceList } from '../../lib/use-presence-list'
import { attachmentPreview, type DraftAttachment, type PastedText } from './attachment-markers'

const attachmentKey = (attachment: DraftAttachment): string => attachment.id

/**
 * Files and long pasted text in the draft; each chip pops in. A file chip removes its file when
 * clicked, while a pasted text chip opens the text and has its own remove button.
 */
export default function AttachmentChips({
  attachments,
  onRemove,
  resetKey = ''
}: {
  attachments: DraftAttachment[]
  onRemove: (attachment: DraftAttachment) => void
  /** Changing it (e.g. switching threads) swaps the chips without animating. */
  resetKey?: string
}): React.JSX.Element | null {
  const entries = usePresenceList(attachments, attachmentKey, resetKey)
  const [viewing, setViewing] = useState<PastedText | null>(null)
  return (
    <>
      <Presence show={attachments.length > 0} motion="collapse">
        <div>
          <div className="tm-session-attachments">
            {entries.map(({ key, item: attachment, exitToken }) => {
              const leaving = exitToken !== null
              if (attachment.type === 'text')
                return (
                  <span
                    className="tm-session-attachment tm-session-attachment--text"
                    key={key}
                    data-motion="pop"
                    data-state={leaving ? 'closed' : 'open'}
                    aria-hidden={leaving || undefined}
                  >
                    <button
                      type="button"
                      className="tm-session-attachment-open"
                      disabled={leaving}
                      title={`Show ${attachment.displayName}`}
                      onClick={() => setViewing(attachment)}
                    >
                      <DocumentIcon className="tm-session-attachment-icon" aria-hidden="true" />
                      <span className="tm-session-attachment-name">{attachment.displayName}</span>
                    </button>
                    <button
                      type="button"
                      className="tm-session-attachment-remove"
                      disabled={leaving}
                      aria-label={`Remove ${attachment.displayName}`}
                      title={`Remove ${attachment.displayName}`}
                      onClick={() => onRemove(attachment)}
                    >
                      ×
                    </button>
                  </span>
                )
              const preview = attachmentPreview(attachment)
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
      <Modal
        open={viewing !== null}
        title={viewing?.displayName ?? ''}
        description="Sent in place of its pill in your message."
        width="xl"
        onClose={() => setViewing(null)}
      >
        <pre className="tm-pasted-text" tabIndex={0} aria-label="Pasted text">
          {viewing?.text}
        </pre>
      </Modal>
    </>
  )
}

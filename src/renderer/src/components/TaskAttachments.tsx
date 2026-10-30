import {
  useRef,
  useState,
  type ClipboardEvent,
  type Dispatch,
  type DragEvent,
  type ReactNode,
  type SetStateAction
} from 'react'
import type { ProjectTaskAttachment } from '../../../shared/app-types'
import { isPreviewableImage } from '../../../shared/task-attachments'
import { getRendererApi } from '../shared/api/client'
import {
  fileAttachmentDraft,
  pickedAttachmentDraft,
  useTaskAttachmentPreview,
  type TaskAttachmentDraft
} from '../lib/task-attachments'
import { usePresenceList } from '../lib/use-presence-list'
import { DocumentIcon, ExternalLinkIcon, PaperclipIcon } from './Icons'
import Modal from './Modal'
import Button from './ui/Button'
import Presence from './ui/Presence'

const draftKey = (draft: TaskAttachmentDraft): string => draft.key

const hasFiles = (event: DragEvent<HTMLElement>): boolean =>
  event.dataTransfer.types.includes('Files')

function AttachmentThumb({
  attachment,
  previewUrl
}: {
  attachment?: ProjectTaskAttachment
  previewUrl?: string
}): React.JSX.Element {
  const loaded = useTaskAttachmentPreview(previewUrl ? undefined : attachment, 'thumbnail')
  const src = previewUrl ?? loaded
  if (src) return <img alt="" className="tm-session-attachment-thumb" src={src} />
  return attachment && !isPreviewableImage(attachment) ? (
    <DocumentIcon aria-hidden="true" className="tm-session-attachment-icon" />
  ) : (
    <PaperclipIcon aria-hidden="true" className="tm-session-attachment-icon" />
  )
}

/**
 * Wraps a task form's description with attachment support: an attach button, pasting files or
 * images, and dropping files. Attachments only show as chips here; they are saved with the form.
 */
export function TaskAttachmentEditor({
  attachments,
  onChange,
  disabled = false,
  resetKey,
  children
}: {
  attachments: TaskAttachmentDraft[]
  onChange: Dispatch<SetStateAction<TaskAttachmentDraft[]>>
  disabled?: boolean
  /** Changing it (e.g. editing another task) swaps the chips without animating. */
  resetKey: string
  children: ReactNode
}): React.JSX.Element {
  const entries = usePresenceList(attachments, draftKey, resetKey)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dragDepth = useRef(0)

  const add = (drafts: TaskAttachmentDraft[]): void => {
    setError(null)
    if (drafts.length > 0) onChange((current) => [...current, ...drafts])
  }

  const addFiles = (files: File[]): void => {
    void Promise.all(files.map(fileAttachmentDraft)).then(add, () =>
      setError('Could not read the file.')
    )
  }

  const handlePick = async (): Promise<void> => {
    try {
      const result = await getRendererApi().appState.pickTaskAttachments()
      if (!result.ok) {
        if (!result.cancelled) setError(result.error ?? 'Could not attach the files.')
        return
      }
      add((result.files ?? []).map(pickedAttachmentDraft))
    } catch {
      setError('Could not attach the files.')
    }
  }

  const handlePaste = (event: ClipboardEvent<HTMLElement>): void => {
    const files = Array.from(event.clipboardData.files)
    if (disabled || files.length === 0) return
    event.preventDefault()
    addFiles(files)
  }

  const resetDrag = (): void => {
    dragDepth.current = 0
    setDragging(false)
  }

  return (
    <div
      className="tm-task-attachment-editor"
      onDragEnter={(event) => {
        if (disabled || !hasFiles(event)) return
        event.preventDefault()
        dragDepth.current++
        setDragging(true)
      }}
      onDragLeave={(event) => {
        if (!hasFiles(event)) return
        if (--dragDepth.current <= 0) resetDrag()
      }}
      onDragOver={(event) => {
        if (!disabled && hasFiles(event)) event.preventDefault()
      }}
      onDrop={(event) => {
        if (!hasFiles(event)) return
        event.preventDefault()
        event.stopPropagation()
        resetDrag()
        if (!disabled && event.dataTransfer.files.length > 0) {
          addFiles(Array.from(event.dataTransfer.files))
        }
      }}
      onPaste={handlePaste}
    >
      {children}
      <Presence motion="collapse" show={attachments.length > 0}>
        <div>
          <div className="tm-session-attachments tm-task-attachments" aria-label="Attachments">
            {entries.map(({ key, item: draft, exitToken }) => {
              const leaving = exitToken !== null
              return (
                <button
                  aria-hidden={leaving || undefined}
                  aria-label={`Remove ${draft.displayName}`}
                  className="tm-session-attachment tm-session-attachment--removable"
                  data-motion="pop"
                  data-state={leaving ? 'closed' : 'open'}
                  disabled={leaving || disabled}
                  key={key}
                  onClick={() =>
                    onChange((current) => current.filter((item) => item.key !== draft.key))
                  }
                  title={`Remove ${draft.displayName}`}
                  type="button"
                >
                  <AttachmentThumb attachment={draft.saved} previewUrl={draft.previewUrl} />
                  <span className="tm-session-attachment-name">{draft.displayName}</span>
                  <span aria-hidden="true" className="tm-session-attachment-remove">
                    ×
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </Presence>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          disabled={disabled}
          onClick={() => void handlePick()}
          size="sm"
          title="Attach files or images (you can also paste or drop them)"
          variant="ghost"
        >
          <PaperclipIcon aria-hidden="true" height={12} width={12} />
          Attach files
        </Button>
        {error ? (
          <span className="text-[12px] text-danger" role="alert">
            {error}
          </span>
        ) : null}
      </div>
      <Presence motion="fade" show={dragging}>
        <div className="tm-session-drop tm-task-attachment-drop">
          <PaperclipIcon aria-hidden="true" />
          Drop files to attach
        </div>
      </Presence>
    </div>
  )
}

function openAttachment(attachment: ProjectTaskAttachment): void {
  void getRendererApi()
    .appState.openTaskAttachment(attachment.path)
    .catch(() => undefined)
}

function AttachmentPreviewDialog({
  attachment,
  open,
  onClose
}: {
  attachment: ProjectTaskAttachment | null
  open: boolean
  onClose: () => void
}): React.JSX.Element {
  const preview = useTaskAttachmentPreview(attachment ?? undefined, 'full')
  return (
    <Modal
      footer={
        attachment ? (
          <Button
            onClick={() => openAttachment(attachment)}
            size="sm"
            title="Open with the default app"
            variant="secondary"
          >
            <ExternalLinkIcon aria-hidden="true" height={12} width={12} />
            Open
          </Button>
        ) : null
      }
      onClose={onClose}
      open={open}
      title={attachment?.displayName ?? 'Attachment'}
      width="xl"
    >
      <div className="tm-task-attachment-preview">
        {preview ? (
          <img alt={attachment?.displayName ?? ''} src={preview} />
        ) : (
          <span className="text-[12.5px] text-fg-subtle">Loading preview…</span>
        )}
      </div>
    </Modal>
  )
}

/** A task card's attachments: images open a preview, other files open with the OS. */
export function TaskAttachmentList({
  attachments
}: {
  attachments: readonly ProjectTaskAttachment[]
}): React.JSX.Element | null {
  const [previewing, setPreviewing] = useState<ProjectTaskAttachment | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const showPreview = (attachment: ProjectTaskAttachment): void => {
    setPreviewing(attachment)
    setPreviewOpen(true)
  }
  if (attachments.length === 0) return null
  return (
    <>
      <div className="tm-session-attachments tm-task-attachments" aria-label="Attachments">
        {attachments.map((attachment) => {
          const image = isPreviewableImage(attachment)
          return (
            <button
              className="tm-session-attachment tm-task-attachment"
              key={attachment.id}
              onClick={() => (image ? showPreview(attachment) : openAttachment(attachment))}
              title={image ? `Preview ${attachment.displayName}` : `Open ${attachment.displayName}`}
              type="button"
            >
              <AttachmentThumb attachment={attachment} />
              <span className="tm-session-attachment-name">{attachment.displayName}</span>
            </button>
          )
        })}
      </div>
      <AttachmentPreviewDialog
        attachment={previewing}
        onClose={() => setPreviewOpen(false)}
        open={previewOpen}
      />
    </>
  )
}

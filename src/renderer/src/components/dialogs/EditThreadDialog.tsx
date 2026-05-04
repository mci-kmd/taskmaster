import { useMemo, useState } from 'react'
import type { ThreadSnapshot } from '../../../../shared/app-types'
import { getCopilotTitle } from '../../../../shared/thread-title'
import { composeThreadTitle } from '../../lib/title'
import Modal from '../Modal'
import Button from '../ui/Button'
import { Field, TextInput } from '../ui/Field'

type EditThreadDialogProps = {
  open: boolean
  thread: ThreadSnapshot | null
  runtimeTitle: string | null
  busy: boolean
  onClose: () => void
  onSubmit: (input: { threadId: string; customTitle: string | null }) => Promise<boolean>
}

export default function EditThreadDialog({
  open,
  thread,
  runtimeTitle,
  busy,
  onClose,
  onSubmit
}: EditThreadDialogProps): React.JSX.Element {
  return (
    <Modal
      description={
        thread
          ? 'Set an optional title prefix. Copilot keeps generating the rest of the title.'
          : 'Pick a thread in the sidebar first.'
      }
      onClose={onClose}
      open={open}
      title="Edit thread"
      width="md"
    >
      {thread ? (
        <EditThreadForm
          busy={busy}
          key={`${thread.id}:${thread.customTitle ?? ''}`}
          onCancel={onClose}
          onSubmit={async (input) => {
            const ok = await onSubmit(input)
            if (ok) {
              onClose()
            }
          }}
          runtimeTitle={runtimeTitle}
          thread={thread}
        />
      ) : (
        <div className="space-y-5">
          <p className="text-[13px] text-[var(--color-fg-muted)]">
            Select a thread, then reopen the editor.
          </p>
          <div className="flex justify-end">
            <Button onClick={onClose} title="Close dialog" variant="secondary">
              Close
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

type EditThreadFormProps = {
  thread: ThreadSnapshot
  runtimeTitle: string | null
  busy: boolean
  onCancel: () => void
  onSubmit: (input: { threadId: string; customTitle: string | null }) => Promise<void>
}

function EditThreadForm({
  thread,
  runtimeTitle,
  busy,
  onCancel,
  onSubmit
}: EditThreadFormProps): React.JSX.Element {
  const [draft, setDraft] = useState(thread.customTitle ?? '')

  const dirty = draft !== (thread.customTitle ?? '')
  const normalizedDraft = draft.trim()
  const previewTitle = useMemo(() => {
    const copilotTitle = getCopilotTitle(thread, runtimeTitle)
    if (normalizedDraft) {
      return copilotTitle ? `${normalizedDraft} — ${copilotTitle}` : normalizedDraft
    }
    return composeThreadTitle(
      {
        ...thread,
        customTitle: null,
        displayTitle: thread.branchName
      },
      runtimeTitle
    )
  }, [normalizedDraft, runtimeTitle, thread])

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!busy && dirty) {
          void onSubmit({
            threadId: thread.id,
            customTitle: normalizedDraft || null
          })
        }
      }}
    >
      <Field
        hint="Shown before the live Copilot title. Leave blank to use the Copilot title or branch name on its own."
        label="Title prefix"
      >
        <TextInput
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Optional title prefix"
          value={draft}
        />
      </Field>

      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-input)] px-3 py-2.5 text-[12.5px] leading-5 text-[var(--color-fg-muted)]">
        Preview: <span className="text-[var(--color-fg)]">{previewTitle}</span>
      </div>

      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-input)] px-3 py-2.5 text-[12.5px] leading-5 text-[var(--color-fg-muted)]">
        Branch: <span className="font-mono text-[var(--color-fg)]">{thread.displayBranchName}</span>
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button
          disabled={busy || draft.length === 0}
          onClick={() => setDraft('')}
          title="Clear title prefix"
          type="button"
          variant="ghost"
        >
          Clear
        </Button>

        <div className="flex items-center gap-2">
          <Button onClick={onCancel} title="Cancel (Esc)" type="button" variant="ghost">
            Cancel
          </Button>
          <Button
            disabled={busy || !dirty}
            title="Save thread title prefix"
            type="submit"
            variant="primary"
          >
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </form>
  )
}

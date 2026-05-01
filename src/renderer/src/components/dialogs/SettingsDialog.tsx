import { useState } from 'react'
import Modal from '../Modal'
import Button from '../ui/Button'
import { Field, TextInput } from '../ui/Field'
import type { AppSettingsSnapshot } from '../../../../shared/app-types'

type SettingsDialogProps = {
  open: boolean
  settings: AppSettingsSnapshot
  busy: boolean
  onClose: () => void
  onSubmit: (input: { globalFlagsInput: string }) => Promise<boolean>
}

export default function SettingsDialog({
  open,
  settings,
  busy,
  onClose,
  onSubmit
}: SettingsDialogProps): React.JSX.Element {
  return (
    <Modal
      description="Applied to every Copilot CLI launch in every thread."
      onClose={onClose}
      open={open}
      title="Settings"
      width="md"
    >
      <SettingsForm
        busy={busy}
        onCancel={onClose}
        onSubmit={async (input) => {
          const ok = await onSubmit(input)
          if (ok) {
            onClose()
          }
        }}
        settings={settings}
      />
    </Modal>
  )
}

type SettingsFormProps = {
  settings: AppSettingsSnapshot
  busy: boolean
  onCancel: () => void
  onSubmit: (input: { globalFlagsInput: string }) => Promise<void>
}

function SettingsForm({
  settings,
  busy,
  onCancel,
  onSubmit
}: SettingsFormProps): React.JSX.Element {
  const [draft, setDraft] = useState(settings.globalFlagsInput)

  const parsedPreview =
    draft === settings.globalFlagsInput
      ? settings.parsedGlobalFlags
      : (draft.match(/("[^"]*"|'[^']*'|\S+)/g) ?? []).map((token) =>
          token.replace(/^['"]|['"]$/g, '')
        )

  const dirty = draft !== settings.globalFlagsInput

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (dirty && !busy) {
          void onSubmit({ globalFlagsInput: draft })
        }
      }}
    >
      <Field
        hint='Whitespace-separated CLI tokens. Use quotes to group, e.g. --model "claude-opus".'
        label="Global Copilot flags"
      >
        <TextInput
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          placeholder="--yolo"
          value={draft}
        />
      </Field>

      <div>
        <div className="mb-1.5 text-[12px] font-medium uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
          Preview
        </div>
        <div className="flex flex-wrap gap-1.5">
          {parsedPreview.length > 0 ? (
            parsedPreview.map((flag, index) => (
              <span
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-input)] px-2 py-1 font-mono text-[11.5px] text-[var(--color-fg)]"
                key={`${flag}-${index}`}
              >
                {flag}
              </span>
            ))
          ) : (
            <span className="text-[12.5px] text-[var(--color-fg-subtle)]">
              No flags configured.
            </span>
          )}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-end gap-2 pt-1">
        <Button onClick={onCancel} type="button" variant="ghost">
          Cancel
        </Button>
        <Button disabled={busy || !dirty} type="submit" variant="primary">
          {busy ? 'Saving…' : 'Save flags'}
        </Button>
      </div>
    </form>
  )
}

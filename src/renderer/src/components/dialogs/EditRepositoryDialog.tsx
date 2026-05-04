import { useState } from 'react'
import Modal from '../Modal'
import Button from '../ui/Button'
import { Field, TextInput } from '../ui/Field'
import type { RepositorySnapshot } from '../../../../shared/app-types'

type EditRepositoryDialogProps = {
  open: boolean
  repository: RepositorySnapshot | null
  busy: boolean
  onClose: () => void
  onBrowse: (repositoryId: string) => Promise<string | null>
  onSubmit: (input: { repositoryId: string; faviconPath: string | null }) => Promise<boolean>
}

export default function EditRepositoryDialog({
  open,
  repository,
  busy,
  onClose,
  onBrowse,
  onSubmit
}: EditRepositoryDialogProps): React.JSX.Element {
  return (
    <Modal
      description={
        repository
          ? `Set a repository-relative favicon path for ${repository.name}.`
          : 'Pick a repository in the sidebar first.'
      }
      onClose={onClose}
      open={open}
      title="Edit project"
      width="md"
    >
      {repository ? (
        <EditRepositoryForm
          busy={busy}
          key={`${repository.id}:${repository.faviconPath ?? ''}`}
          onBrowse={onBrowse}
          onCancel={onClose}
          onSubmit={async (input) => {
            const ok = await onSubmit(input)
            if (ok) {
              onClose()
            }
          }}
          repository={repository}
        />
      ) : (
        <div className="space-y-5">
          <p className="text-[13px] text-[var(--color-fg-muted)]">
            Select a repository, then reopen the editor.
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

type EditRepositoryFormProps = {
  repository: RepositorySnapshot
  busy: boolean
  onCancel: () => void
  onBrowse: (repositoryId: string) => Promise<string | null>
  onSubmit: (input: { repositoryId: string; faviconPath: string | null }) => Promise<void>
}

function EditRepositoryForm({
  repository,
  busy,
  onCancel,
  onBrowse,
  onSubmit
}: EditRepositoryFormProps): React.JSX.Element {
  const [draft, setDraft] = useState(repository.faviconPath ?? '')

  const dirty = draft !== (repository.faviconPath ?? '')

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!busy && dirty) {
          void onSubmit({
            repositoryId: repository.id,
            faviconPath: draft.trim() || null
          })
        }
      }}
    >
      <Field
        hint={`Use Browse to pick a file, or paste a relative path manually. Stored relative to ${repository.name}'s repo root so the same path works in worktrees too.`}
        label="Application favicon path"
      >
        <div className="flex items-center gap-2">
          <TextInput
            autoFocus
            className="min-w-0 flex-1"
            onChange={(event) => setDraft(event.target.value)}
            placeholder="app\\public\\favicon.ico"
            value={draft}
          />
          <Button
            disabled={busy}
            onClick={async () => {
              const nextPath = await onBrowse(repository.id)
              if (nextPath) {
                setDraft(nextPath)
              }
            }}
            title="Browse for a favicon file"
            type="button"
            variant="secondary"
          >
            Browse…
          </Button>
        </div>
      </Field>

      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-input)] px-3 py-2.5 text-[12.5px] leading-5 text-[var(--color-fg-muted)]">
        Repository root: <span className="font-mono text-[var(--color-fg)]">{repository.path}</span>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            disabled={busy || draft.length === 0}
            onClick={() => setDraft('')}
            title="Clear custom favicon"
            type="button"
            variant="ghost"
          >
            Clear
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={onCancel} title="Cancel (Esc)" type="button" variant="ghost">
            Cancel
          </Button>
          <Button disabled={busy || !dirty} title="Save project icon" type="submit" variant="primary">
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </form>
  )
}

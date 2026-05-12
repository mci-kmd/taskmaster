import { useState } from 'react'
import Modal from '../Modal'
import Button from '../ui/Button'
import { Field, TextArea, TextInput } from '../ui/Field'
import type { RepositorySnapshot } from '../../../../shared/app-types'

type EditRepositoryDialogProps = {
  open: boolean
  repository: RepositorySnapshot | null
  busy: boolean
  onClose: () => void
  onBrowse: (repositoryId: string) => Promise<string | null>
  onSubmit: (input: {
    repositoryId: string
    faviconPath: string | null
    runCommand: string | null
    postWorktreeRemoveCommand: string | null
  }) => Promise<boolean>
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
          ? `Configure the icon and project commands for ${repository.name}.`
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
          key={`${repository.id}:${repository.faviconPath ?? ''}:${repository.runCommand ?? ''}:${repository.postWorktreeRemoveCommand ?? ''}`}
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
  onSubmit: (input: {
    repositoryId: string
    faviconPath: string | null
    runCommand: string | null
    postWorktreeRemoveCommand: string | null
  }) => Promise<void>
}

function EditRepositoryForm({
  repository,
  busy,
  onCancel,
  onBrowse,
  onSubmit
}: EditRepositoryFormProps): React.JSX.Element {
  const [faviconDraft, setFaviconDraft] = useState(repository.faviconPath ?? '')
  const [runCommandDraft, setRunCommandDraft] = useState(repository.runCommand ?? '')
  const [postWorktreeRemoveCommandDraft, setPostWorktreeRemoveCommandDraft] = useState(
    repository.postWorktreeRemoveCommand ?? ''
  )

  const dirty =
    faviconDraft !== (repository.faviconPath ?? '') ||
    runCommandDraft !== (repository.runCommand ?? '') ||
    postWorktreeRemoveCommandDraft !== (repository.postWorktreeRemoveCommand ?? '')

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!busy && dirty) {
          void onSubmit({
            repositoryId: repository.id,
            faviconPath: faviconDraft.trim() || null,
            runCommand: runCommandDraft.trim() || null,
            postWorktreeRemoveCommand: postWorktreeRemoveCommandDraft.trim() || null
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
            onChange={(event) => setFaviconDraft(event.target.value)}
            placeholder="app\\public\\favicon.ico"
            value={faviconDraft}
          />
          <Button
            disabled={busy}
            onClick={async () => {
              const nextPath = await onBrowse(repository.id)
              if (nextPath) {
                setFaviconDraft(nextPath)
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

      <Field
        hint="Runs in the selected thread's working directory. Use {BRANCH-NAME} for the raw branch name, {BRANCH-NAME-SAFE} for a lowercased Docker-safe variant, or {BRANCH-PORT} for a deterministic pseudo-random port for this repo + branch."
        label="Run command"
      >
        <TextArea
          className="min-w-0 w-full"
          onChange={(event) => setRunCommandDraft(event.target.value)}
          placeholder={'bun install\nbun run dev'}
          rows={5}
          spellCheck={false}
          value={runCommandDraft}
        />
      </Field>

      <Field
        hint="Optional. Runs in the repository root after a worktree thread is removed and its branch is deleted. Supports the same tokens as the run command."
        label="Post-worktree-remove script"
      >
        <TextArea
          className="min-w-0 w-full"
          onChange={(event) => setPostWorktreeRemoveCommandDraft(event.target.value)}
          placeholder={'docker volume rm myapp-{BRANCH-NAME-SAFE}-sql'}
          rows={4}
          spellCheck={false}
          value={postWorktreeRemoveCommandDraft}
        />
      </Field>

      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-input)] px-3 py-2.5 text-[12.5px] leading-5 text-[var(--color-fg-muted)]">
        Repository root: <span className="font-mono text-[var(--color-fg)]">{repository.path}</span>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            disabled={
              busy ||
              (faviconDraft.length === 0 &&
                runCommandDraft.length === 0 &&
                postWorktreeRemoveCommandDraft.length === 0)
            }
            onClick={() => {
              setFaviconDraft('')
              setRunCommandDraft('')
              setPostWorktreeRemoveCommandDraft('')
            }}
            title="Clear project fields"
            type="button"
            variant="ghost"
          >
            Clear fields
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={onCancel} title="Cancel (Esc)" type="button" variant="ghost">
            Cancel
          </Button>
          <Button
            disabled={busy || !dirty}
            title="Save project settings"
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

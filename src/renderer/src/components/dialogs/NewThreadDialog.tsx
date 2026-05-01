import { useState } from 'react'
import Modal from '../Modal'
import Button from '../ui/Button'
import { Field, TextInput } from '../ui/Field'
import SegmentedControl from '../ui/SegmentedControl'
import type { RepositorySnapshot, ThreadMode } from '../../../../shared/app-types'

type NewThreadDialogProps = {
  open: boolean
  repository: RepositorySnapshot | null
  busy: boolean
  onClose: () => void
  onSubmit: (input: { mode: ThreadMode; title?: string; branchName?: string }) => Promise<boolean>
}

export default function NewThreadDialog({
  open,
  repository,
  busy,
  onClose,
  onSubmit
}: NewThreadDialogProps): React.JSX.Element {
  return (
    <Modal
      description={
        repository
          ? `In ${repository.name} · ${repository.currentBranch}`
          : 'Pick a repository in the sidebar first.'
      }
      onClose={onClose}
      open={open}
      title="New thread"
      width="md"
    >
      {repository ? (
        <NewThreadForm
          busy={busy}
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
            Add or select a repository first, then create a thread.
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

type NewThreadFormProps = {
  repository: RepositorySnapshot
  busy: boolean
  onCancel: () => void
  onSubmit: (input: { mode: ThreadMode; title?: string; branchName?: string }) => Promise<void>
}

function NewThreadForm({
  repository,
  busy,
  onCancel,
  onSubmit
}: NewThreadFormProps): React.JSX.Element {
  const [mode, setMode] = useState<ThreadMode>('active-branch')
  const [title, setTitle] = useState('')
  const [branchName, setBranchName] = useState('')

  const submit = async (): Promise<void> => {
    await onSubmit({
      mode,
      title: title.trim() || undefined,
      branchName: mode === 'worktree' ? branchName.trim() : undefined
    })
  }

  const submitDisabled = busy || (mode === 'worktree' && !branchName.trim())

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!submitDisabled) {
          void submit()
        }
      }}
    >
      <Field label="Mode">
        <SegmentedControl<ThreadMode>
          ariaLabel="Thread mode"
          onChange={setMode}
          options={[
            {
              value: 'active-branch',
              label: 'Active branch',
              description: 'Run Copilot in the repository working tree'
            },
            {
              value: 'worktree',
              label: 'Owned worktree',
              description: 'Create a dedicated worktree + branch'
            }
          ]}
          value={mode}
        />
      </Field>

      <Field
        hint={
          mode === 'worktree'
            ? 'Defaults to the worktree branch name when blank.'
            : `Defaults to ${repository.currentBranch} when blank.`
        }
        label="Label"
      >
        <TextInput
          autoFocus
          onChange={(event) => setTitle(event.target.value)}
          placeholder={mode === 'worktree' ? 'Optional thread label' : repository.currentBranch}
          value={title}
        />
      </Field>

      {mode === 'worktree' ? (
        <Field hint="Worktree folder name is derived from this branch." label="Branch name">
          <TextInput
            onChange={(event) => setBranchName(event.target.value)}
            placeholder="feature/my-branch"
            value={branchName}
          />
        </Field>
      ) : (
        <div className="rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-input)] px-3 py-2.5 text-[12.5px] leading-5 text-[var(--color-fg-muted)]">
          Active-branch threads launch in{' '}
          <span className="font-mono text-[var(--color-fg)]">{repository.currentBranch}</span>.
        </div>
      )}

      <div className="mt-2 flex items-center justify-end gap-2 pt-1">
        <Button onClick={onCancel} title="Cancel (Esc)" type="button" variant="ghost">
          Cancel
        </Button>
        <Button
          disabled={submitDisabled}
          title={
            mode === 'worktree'
              ? 'Create a new owned worktree thread'
              : 'Create a new active-branch thread'
          }
          type="submit"
          variant="primary"
        >
          {busy ? 'Creating…' : 'Create thread'}
        </Button>
      </div>
    </form>
  )
}

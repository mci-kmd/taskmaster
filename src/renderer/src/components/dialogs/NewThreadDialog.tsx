import { useState } from 'react'
import Modal from '../Modal'
import Button from '../ui/Button'
import Checkbox from '../ui/Checkbox'
import { Field, TextInput } from '../ui/Field'
import SegmentedControl from '../ui/SegmentedControl'
import type { RepositorySnapshot, ThreadMode } from '../../../../shared/app-types'

type SubmitInput = {
  mode: ThreadMode
  title?: string
  branchName?: string
  useCurrentBranch?: boolean
}

type NewThreadDialogProps = {
  open: boolean
  repository: RepositorySnapshot | null
  busy: boolean
  onClose: () => void
  onSubmit: (input: SubmitInput) => Promise<boolean>
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
  onSubmit: (input: SubmitInput) => Promise<void>
}

function NewThreadForm({
  repository,
  busy,
  onCancel,
  onSubmit
}: NewThreadFormProps): React.JSX.Element {
  const [mode, setMode] = useState<ThreadMode>('new-branch')
  const [title, setTitle] = useState('')
  const [branchName, setBranchName] = useState('')
  const [useCurrentBranch, setUseCurrentBranch] = useState(false)

  const requiresBranchInput = mode === 'new-branch' || mode === 'worktree'
  const noPrimary = repository.primaryBranch === null
  const onPrimary = repository.primaryBranch === repository.currentBranch
  // When there's no primary branch we have to fall back to current.
  const effectiveUseCurrent = noPrimary ? true : useCurrentBranch
  const checkboxDisabled = noPrimary || onPrimary
  const baseLabel = effectiveUseCurrent
    ? repository.currentBranch
    : (repository.primaryBranch ?? repository.currentBranch)

  const submit = async (): Promise<void> => {
    await onSubmit({
      mode,
      title: title.trim() || undefined,
      branchName: mode === 'active-branch' ? undefined : branchName.trim(),
      useCurrentBranch: requiresBranchInput ? effectiveUseCurrent : undefined
    })
  }

  const submitDisabled = busy || (requiresBranchInput && !branchName.trim())

  const labelHint =
    mode === 'new-branch'
      ? 'Defaults to the branch name when blank.'
      : mode === 'worktree'
        ? 'Defaults to the worktree branch name when blank.'
        : `Defaults to ${repository.currentBranch} when blank.`

  const branchHint =
    mode === 'new-branch'
      ? 'Created via git checkout -b. Working tree must be clean.'
      : 'Worktree folder name is derived from this branch.'

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
              description: 'Run the agent on the repo as it is currently checked out'
            },
            {
              value: 'new-branch',
              label: 'New branch',
              description: 'Create a branch in this repo and check it out'
            },
            {
              value: 'worktree',
              label: 'Worktree',
              description: 'Create a dedicated worktree + branch'
            }
          ]}
          value={mode}
        />
      </Field>

      <Field hint={labelHint} label="Label">
        <TextInput
          autoFocus
          onChange={(event) => setTitle(event.target.value)}
          placeholder={requiresBranchInput ? 'Optional thread label' : repository.currentBranch}
          value={title}
        />
      </Field>

      {requiresBranchInput ? (
        <>
          <Field hint={branchHint} label="Branch name">
            <TextInput
              onChange={(event) => setBranchName(event.target.value)}
              placeholder="feature/my-branch"
              value={branchName}
            />
          </Field>

          <Field label="Base">
            <div className="space-y-2 rounded-md border border-[var(--color-border)] bg-[var(--color-input)] px-3 py-2.5">
              <div className="flex items-center justify-between gap-2 text-[12.5px]">
                <span className="text-[var(--color-fg-muted)]">Branching from</span>
                <span className="font-mono text-[var(--color-fg)]">{baseLabel}</span>
              </div>
              <Checkbox
                checked={effectiveUseCurrent}
                disabled={checkboxDisabled}
                label={
                  <span>
                    Use current branch{' '}
                    <span className="font-mono text-[var(--color-fg-muted)]">
                      ({repository.currentBranch})
                    </span>{' '}
                    instead
                  </span>
                }
                onChange={setUseCurrentBranch}
                title={
                  noPrimary
                    ? 'Could not determine a primary branch; falling back to current.'
                    : onPrimary
                      ? 'Already on the primary branch.'
                      : `Branch off ${repository.currentBranch} instead of ${repository.primaryBranch}`
                }
              />
            </div>
          </Field>
        </>
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
              ? 'Create a new worktree thread'
              : mode === 'new-branch'
                ? 'Create a new branch and start a thread on it'
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

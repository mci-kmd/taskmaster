import { useId, useState } from 'react'
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

type DialogMode = 'branch' | 'worktree'

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
  const [mode, setMode] = useState<DialogMode>('branch')
  const [title, setTitle] = useState('')
  const [branchName, setBranchName] = useState('')
  const [useCurrentBranch, setUseCurrentBranch] = useState(false)
  const branchOptionsId = useId()
  const worktreeOptionsId = useId()

  const trimmedBranchName = branchName.trim()
  const noPrimary = repository.primaryBranch === null
  const onPrimary = repository.primaryBranch === repository.currentBranch
  const effectiveUseCurrent = noPrimary ? true : useCurrentBranch
  const checkboxDisabled = noPrimary || onPrimary
  const baseLabel = effectiveUseCurrent
    ? repository.currentBranch
    : (repository.primaryBranch ?? repository.currentBranch)
  const showBaseField = mode === 'worktree' || trimmedBranchName.length > 0

  const submit = async (): Promise<void> => {
    await onSubmit({
      mode: mode === 'worktree' ? 'worktree' : 'active-branch',
      title: title.trim() || undefined,
      branchName: trimmedBranchName || undefined,
      useCurrentBranch: showBaseField ? effectiveUseCurrent : undefined
    })
  }

  const submitDisabled = busy || (mode === 'worktree' && !trimmedBranchName)
  const labelHint =
    mode === 'worktree'
      ? 'Defaults to the worktree branch name when blank.'
      : trimmedBranchName
        ? 'Defaults to the selected branch name when blank.'
        : `Defaults to ${repository.currentBranch} when blank.`
  const branchHint =
    mode === 'worktree'
      ? 'Pick an existing worktree branch to reuse it, or type a new branch name to create one. Existing branches without a worktree are not supported here.'
      : `Leave blank to use ${repository.currentBranch}. Pick an existing local/remote branch or type a new one. Switching away from ${repository.currentBranch} requires a clean working tree.`

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
        <SegmentedControl<DialogMode>
          ariaLabel="Thread mode"
          onChange={setMode}
          options={[
            {
              value: 'branch',
              label: 'Branch',
              description: 'Use the active branch, an existing branch, or create a new one'
            },
            {
              value: 'worktree',
              label: 'Worktree',
              description: 'Reuse an existing worktree or create a new one'
            }
          ]}
          value={mode}
        />
      </Field>

      <Field hint={labelHint} label="Label">
        <TextInput
          autoFocus
          onChange={(event) => setTitle(event.target.value)}
          placeholder={trimmedBranchName ? 'Optional thread label' : repository.currentBranch}
          value={title}
        />
      </Field>

      <Field hint={branchHint} label={mode === 'worktree' ? 'Worktree branch' : 'Branch'}>
        <TextInput
          list={mode === 'worktree' ? worktreeOptionsId : branchOptionsId}
          onChange={(event) => setBranchName(event.target.value)}
          placeholder={mode === 'worktree' ? 'feature/my-worktree' : repository.currentBranch}
          value={branchName}
        />
        <datalist id={branchOptionsId}>
          {repository.branchOptions.map((option) => (
            <option
              key={`${option.kind}:${option.value}`}
              label={option.label}
              value={option.value}
            />
          ))}
        </datalist>
        <datalist id={worktreeOptionsId}>
          {repository.worktreeOptions.map((option) => (
            <option
              key={`${option.branchName}:${option.path}`}
              label={option.path}
              value={option.branchName}
            />
          ))}
        </datalist>
      </Field>

      {mode === 'branch' && !trimmedBranchName ? (
        <div className="rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-input)] px-3 py-2.5 text-[12.5px] leading-5 text-[var(--color-fg-muted)]">
          Blank creates the thread on{' '}
          <span className="font-mono text-[var(--color-fg)]">{repository.currentBranch}</span>.
        </div>
      ) : null}

      {showBaseField ? (
        <Field label="Base">
          <div className="space-y-2 rounded-md border border-[var(--color-border)] bg-[var(--color-input)] px-3 py-2.5">
            <div className="flex items-center justify-between gap-2 text-[12.5px]">
              <span className="text-[var(--color-fg-muted)]">Use when creating a new branch</span>
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
      ) : null}

      <div className="mt-2 flex items-center justify-end gap-2 pt-1">
        <Button onClick={onCancel} title="Cancel (Esc)" type="button" variant="ghost">
          Cancel
        </Button>
        <Button
          disabled={submitDisabled}
          title={
            mode === 'worktree' ? 'Create or attach a worktree thread' : 'Create a branch thread'
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

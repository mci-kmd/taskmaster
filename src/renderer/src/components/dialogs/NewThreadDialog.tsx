import { useState } from 'react'
import Modal from '../Modal'
import Button from '../ui/Button'
import Checkbox from '../ui/Checkbox'
import { Field, TextInput } from '../ui/Field'
import Presence from '../ui/Presence'
import SegmentedControl from '../ui/SegmentedControl'
import Select from '../ui/Select'
import { useDialogSession } from './use-dialog-session'
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
  error: string | null
  onClose: () => void
  onSubmit: (input: SubmitInput) => Promise<boolean>
}

export default function NewThreadDialog({
  open,
  repository,
  busy,
  error,
  onClose,
  onSubmit
}: NewThreadDialogProps): React.JSX.Element {
  // Each opening gets a fresh form, even when the dialog reopens while animating out.
  const session = useDialogSession(open)
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
          key={`${repository.id}:${session.key}`}
          busy={busy}
          error={error}
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
          <p className="text-[13px] text-fg-muted">
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
  error: string | null
  onCancel: () => void
  onSubmit: (input: SubmitInput) => Promise<void>
}

function NewThreadForm({
  repository,
  busy,
  error,
  onCancel,
  onSubmit
}: NewThreadFormProps): React.JSX.Element {
  const [mode, setMode] = useState<DialogMode>('branch')
  const [title, setTitle] = useState('')
  const [branchName, setBranchName] = useState('')
  const [useCurrentBranch, setUseCurrentBranch] = useState(false)

  const trimmedBranchName = branchName.trim()
  const defaultBranchName = repository.primaryBranch ?? repository.currentBranch
  const noPrimary = repository.primaryBranch === null
  const onPrimary = repository.primaryBranch === repository.currentBranch
  const effectiveUseCurrent = noPrimary ? true : useCurrentBranch
  const checkboxDisabled = noPrimary || onPrimary
  const baseLabel = effectiveUseCurrent
    ? repository.currentBranch
    : (repository.primaryBranch ?? repository.currentBranch)
  const showBaseField = mode === 'worktree' || trimmedBranchName.length > 0

  const submit = async (): Promise<void> => {
    const submittedBranchName =
      trimmedBranchName || (mode === 'branch' ? repository.primaryBranch : undefined)
    await onSubmit({
      mode: mode === 'worktree' ? 'worktree' : 'active-branch',
      title: title.trim() || undefined,
      branchName: submittedBranchName || undefined,
      useCurrentBranch: showBaseField ? effectiveUseCurrent : undefined
    })
  }

  const submitDisabled = busy || (mode === 'worktree' && !trimmedBranchName)
  const labelHint =
    mode === 'worktree'
      ? 'Defaults to the worktree branch name when blank.'
      : trimmedBranchName
        ? 'Defaults to the selected branch name when blank.'
        : `Defaults to ${defaultBranchName} when blank.`
  const branchHint =
    mode === 'worktree'
      ? 'Pick an existing worktree branch to reuse it, or type a new branch name to create one. Existing branches without a worktree are not supported here.'
      : `Leave blank to use ${defaultBranchName}. Pick an existing local/remote branch or type a new one. Switching away from ${repository.currentBranch} requires a clean working tree.`

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
          placeholder={trimmedBranchName ? 'Optional thread label' : defaultBranchName}
          value={title}
        />
      </Field>

      <Field hint={branchHint} label={mode === 'worktree' ? 'Worktree branch' : 'Branch'}>
        <Select
          editable
          aria-label={mode === 'worktree' ? 'Worktree branch' : 'Branch'}
          onChange={setBranchName}
          placeholder={mode === 'worktree' ? 'feature/my-worktree' : defaultBranchName}
          value={branchName}
          options={
            mode === 'worktree'
              ? repository.worktreeOptions.map((option) => ({
                  value: option.branchName,
                  label: option.branchName,
                  description: option.path
                }))
              : repository.branchOptions.map((option) => ({
                  value: option.value,
                  label: option.value,
                  description: option.label
                }))
          }
        />
      </Field>

      <Presence motion="collapse" show={mode === 'branch' && !trimmedBranchName}>
        <div className="tm-dialog-note" data-variant="dashed">
          Blank creates the thread on <span className="font-mono text-fg">{defaultBranchName}</span>
          .
        </div>
      </Presence>

      <Presence motion="collapse" show={showBaseField}>
        <div>
          <Field label="Base">
            <div className="tm-dialog-note space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span>Use when creating a new branch</span>
                <span className="font-mono text-fg">{baseLabel}</span>
              </div>
              <Checkbox
                checked={effectiveUseCurrent}
                disabled={checkboxDisabled}
                label={
                  <span>
                    Use current branch{' '}
                    <span className="font-mono text-fg-muted">({repository.currentBranch})</span>{' '}
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
        </div>
      </Presence>

      <Presence motion="collapse" show={Boolean(error)}>
        <div className="tm-dialog-note" data-tone="danger" role="alert">
          {error}
        </div>
      </Presence>

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

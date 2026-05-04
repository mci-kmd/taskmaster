import Modal from '../Modal'
import Button from '../ui/Button'
import type { ThreadSnapshot } from '../../../../shared/app-types'
import { getCopilotTitle } from '../../../../shared/thread-title'
import { formatRelativeTime } from '../../lib/time'
import { composeThreadTitle } from '../../lib/title'

type ThreadDetailsDialogProps = {
  open: boolean
  thread: ThreadSnapshot | null
  runtimeTitle: string | null
  closing: boolean
  onClose: () => void
  onCloseThread: () => void
}

function Row({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div className="grid grid-cols-[120px_1fr] items-start gap-3 border-b border-[var(--color-border)] py-2.5 last:border-b-0">
      <div className="pt-0.5 text-[11.5px] font-medium uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
        {label}
      </div>
      <div className="text-[13px] text-[var(--color-fg)]">{value}</div>
    </div>
  )
}

export default function ThreadDetailsDialog({
  open,
  thread,
  runtimeTitle,
  closing,
  onClose,
  onCloseThread
}: ThreadDetailsDialogProps): React.JSX.Element {
  if (!thread) {
    return (
      <Modal onClose={onClose} open={open} title="Thread details">
        <p className="text-[13px] text-[var(--color-fg-muted)]">No thread selected.</p>
      </Modal>
    )
  }

  const copilotTitle = getCopilotTitle(thread, runtimeTitle)

  return (
    <Modal
      description={
        thread.mode === 'worktree'
          ? 'Worktree thread'
          : thread.mode === 'new-branch'
            ? 'New-branch thread'
            : 'Active-branch thread'
      }
      footer={
        <>
          <Button onClick={onClose} title="Close dialog (Esc)" variant="ghost">
            Close
          </Button>
          <Button
            disabled={closing}
            onClick={onCloseThread}
            title={
              thread.mode === 'worktree'
                ? 'Close thread, remove worktree, delete branch'
                : thread.mode === 'new-branch'
                  ? 'Close thread (the branch and working tree are preserved)'
                  : 'Close thread (branch and working tree are preserved)'
            }
            variant="danger"
          >
            {closing ? 'Closing…' : 'Close thread'}
          </Button>
        </>
      }
      onClose={onClose}
      open={open}
      title={composeThreadTitle(thread, runtimeTitle)}
      width="lg"
    >
      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-input)] px-4 py-2.5">
        {thread.customTitle ? (
          <Row label="Title prefix" value={<span>{thread.customTitle}</span>} />
        ) : null}
        {copilotTitle ? (
          <Row
            label="Copilot title"
            value={<span className="text-[var(--color-fg)]">{copilotTitle}</span>}
          />
        ) : null}
        <Row label="Branch" value={<span className="font-mono">{thread.displayBranchName}</span>} />
        <Row
          label="Working dir"
          value={
            <span className="break-all font-mono text-[12px] text-[var(--color-fg-muted)]">
              {thread.cwd}
            </span>
          }
        />
        <Row
          label="Session"
          value={
            <span className="break-all font-mono text-[12px] text-[var(--color-fg-muted)]">
              {thread.sessionName}
            </span>
          }
        />
        <Row
          label="Status"
          value={
            <span className="inline-flex items-center gap-2">
              <span
                className={`size-1.5 rounded-full ${
                  thread.isRunning
                    ? 'bg-[var(--color-positive)] tm-pulse-dot'
                    : 'bg-[var(--color-fg-faint)]'
                }`}
              />
              {thread.isRunning ? 'Running' : 'Idle'}
            </span>
          }
        />
        <Row label="Last activity" value={formatRelativeTime(thread.lastActivityAt)} />
      </div>

      {thread.mode === 'worktree' ? (
        <p className="mt-4 text-[12.5px] leading-5 text-[var(--color-fg-muted)]">
          Closing this thread removes the worktree at{' '}
          <span className="font-mono text-[var(--color-fg)]">{thread.cwd}</span> and deletes the{' '}
          <span className="font-mono text-[var(--color-fg)]">{thread.branchName}</span> branch. You
          will be asked to confirm if the worktree is dirty.
        </p>
      ) : thread.mode === 'new-branch' ? (
        <p className="mt-4 text-[12.5px] leading-5 text-[var(--color-fg-muted)]">
          Closing this thread only forgets the persisted Copilot session. The{' '}
          <span className="font-mono text-[var(--color-fg)]">{thread.branchName}</span> branch and
          working tree are left untouched.
        </p>
      ) : (
        <p className="mt-4 text-[12.5px] leading-5 text-[var(--color-fg-muted)]">
          Closing an active-branch thread only forgets the persisted Copilot session. The branch and
          working tree are left untouched.
        </p>
      )}
    </Modal>
  )
}

import type { ThreadCommitPhase } from '../../../../shared/app-types'
import {
  COMMIT_PHASE_LABELS,
  COMMIT_SHORTCUT_LABEL,
  PUSH_SHORTCUT_LABEL
} from '../../../../shared/commit'
import { GitCommitIcon, GitPushIcon } from '../Icons'
import Button from '../ui/Button'

/** `commit` while there are changes to commit; `push` once only unpushed commits remain. */
export type CommitButtonAction = 'commit' | 'push'

function commitButtonTitle(action: CommitButtonAction, autoPush: boolean): string {
  if (action === 'push') return `Push commits to the remote (${PUSH_SHORTCUT_LABEL})`
  return autoPush
    ? `Commit and push all changes with an AI-written message (${COMMIT_SHORTCUT_LABEL})`
    : `Commit all changes with an AI-written message (${COMMIT_SHORTCUT_LABEL})`
}

function commitButtonLabel(action: CommitButtonAction, autoPush: boolean): string {
  if (action === 'push') return 'Push'
  return autoPush ? 'Commit and push' : 'Commit'
}

/**
 * Stages everything and commits with a Copilot-written message, or pushes when only unpushed
 * commits remain; shows each phase while it runs.
 */
export default function CommitButton({
  phase,
  action = 'commit',
  autoPush,
  disabledReason,
  onCommit,
  onPush,
  ...rest
}: {
  phase: ThreadCommitPhase | null
  action?: CommitButtonAction
  autoPush: boolean
  disabledReason: string | null
  onCommit: () => void
  onPush?: () => void
  /** Motion attributes from <Presence>. */
  'data-motion'?: string
  'data-state'?: string
}): React.JSX.Element {
  const unavailable = Boolean(phase) || Boolean(disabledReason)
  const title = phase
    ? COMMIT_PHASE_LABELS[phase]
    : (disabledReason ?? commitButtonTitle(action, autoPush))
  const Icon = action === 'push' ? GitPushIcon : GitCommitIcon
  return (
    <Button
      {...rest}
      size="sm"
      variant="secondary"
      iconOnly
      className="tm-commit"
      data-phase={phase ?? undefined}
      data-action={action}
      // aria-disabled keeps the tooltip available while the button can't be used.
      aria-disabled={unavailable || undefined}
      aria-busy={Boolean(phase) || undefined}
      aria-keyshortcuts={action === 'push' ? 'Control+D' : 'Control+S'}
      aria-label={phase ? COMMIT_PHASE_LABELS[phase] : commitButtonLabel(action, autoPush)}
      title={title}
      onClick={() => {
        if (unavailable) return
        if (action === 'push') onPush?.()
        else onCommit()
      }}
    >
      <Icon key={action} className="tm-commit-icon tm-fade-in" aria-hidden="true" />
      <span className="tm-commit-ring" aria-hidden="true" />
    </Button>
  )
}

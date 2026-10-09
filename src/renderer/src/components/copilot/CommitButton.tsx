import type { ThreadCommitPhase } from '../../../../shared/app-types'
import { COMMIT_PHASE_LABELS, COMMIT_SHORTCUT_LABEL } from '../../../../shared/commit'
import { GitCommitIcon } from '../Icons'
import Button from '../ui/Button'

function commitButtonTitle(autoPush: boolean): string {
  return autoPush
    ? `Commit and push all changes with an AI-written message (${COMMIT_SHORTCUT_LABEL})`
    : `Commit all changes with an AI-written message (${COMMIT_SHORTCUT_LABEL})`
}

/** Stages everything and commits with a Copilot-written message; shows each phase while it runs. */
export default function CommitButton({
  phase,
  autoPush,
  disabledReason,
  onCommit
}: {
  phase: ThreadCommitPhase | null
  autoPush: boolean
  disabledReason: string | null
  onCommit: () => void
}): React.JSX.Element {
  const unavailable = Boolean(phase) || Boolean(disabledReason)
  const title = phase ? COMMIT_PHASE_LABELS[phase] : (disabledReason ?? commitButtonTitle(autoPush))
  return (
    <Button
      size="sm"
      variant="ghost"
      iconOnly
      className="tm-commit"
      data-phase={phase ?? undefined}
      // aria-disabled keeps the tooltip available while the button can't be used.
      aria-disabled={unavailable || undefined}
      aria-busy={Boolean(phase) || undefined}
      aria-keyshortcuts="Control+S"
      aria-label={phase ? COMMIT_PHASE_LABELS[phase] : autoPush ? 'Commit and push' : 'Commit'}
      title={title}
      onClick={() => {
        if (!unavailable) onCommit()
      }}
    >
      <GitCommitIcon className="tm-commit-icon" aria-hidden="true" />
      <span className="tm-commit-ring" aria-hidden="true" />
    </Button>
  )
}

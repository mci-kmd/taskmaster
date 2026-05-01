import type { TerminalStatus, ThreadSnapshot } from '../../../shared/app-types'
import type { SessionPhase, ThreadSessionState } from './ThreadTerminal'
import Button from './ui/Button'
import { PlayIcon, RefreshIcon, SparkIcon } from './Icons'
import { composeThreadTitle } from '../lib/title'

type LaunchPanelProps = {
  thread: ThreadSnapshot
  session: ThreadSessionState
  copilotStatus: TerminalStatus | null
  onLaunch: () => void
}

type Visual = {
  tone: 'idle' | 'progress' | 'error' | 'stopped'
  title: string
  detail: React.ReactNode
  action: React.ReactNode | null
}

function pickVisual(
  thread: ThreadSnapshot,
  session: ThreadSessionState,
  copilotStatus: TerminalStatus | null,
  onLaunch: () => void
): Visual {
  const phase: SessionPhase = session.phase
  const cliAvailable = copilotStatus?.available ?? false

  if (!copilotStatus) {
    return {
      tone: 'progress',
      title: 'Resolving Copilot CLI…',
      detail: <span>Looking for the Copilot CLI on your PATH.</span>,
      action: null
    }
  }

  if (phase === 'launching') {
    return {
      tone: 'progress',
      title: thread.hasLaunched ? 'Resuming session…' : 'Starting session…',
      detail: (
        <span>
          {thread.hasLaunched ? 'Reattaching to ' : 'Spawning '}Copilot CLI in{' '}
          <span className="font-mono text-[var(--color-fg)]">{thread.cwd}</span>
        </span>
      ),
      action: null
    }
  }

  if (phase === 'error') {
    return {
      tone: 'error',
      title: 'Failed to launch',
      detail: (
        <span className="text-[var(--color-danger)]">
          {session.errorMessage ?? 'Unknown error.'}
        </span>
      ),
      action: (
        <Button onClick={onLaunch} size="md" title="Try launching again" variant="primary">
          <RefreshIcon width={12} height={12} />
          Try again
        </Button>
      )
    }
  }

  if (phase === 'stopped') {
    return {
      tone: 'stopped',
      title: `Session ended${session.exitCode !== null ? ` (code ${session.exitCode})` : ''}`,
      detail: <span>Restart the Copilot session for this thread to continue.</span>,
      action: (
        <Button onClick={onLaunch} size="md" title="Restart Copilot session" variant="primary">
          <PlayIcon width={11} height={11} />
          Restart
        </Button>
      )
    }
  }

  if (!cliAvailable) {
    return {
      tone: 'error',
      title: 'Copilot CLI unavailable',
      detail: (
        <span>
          {copilotStatus.message ?? 'Install GitHub Copilot CLI and ensure it is signed in.'}
        </span>
      ),
      action: null
    }
  }

  return {
    tone: 'idle',
    title: thread.hasLaunched ? 'Ready to resume' : 'Ready to launch',
    detail: (
      <span>
        Launch Copilot CLI in <span className="font-mono text-[var(--color-fg)]">{thread.cwd}</span>
      </span>
    ),
    action: (
      <Button onClick={onLaunch} size="md" title="Launch Copilot session" variant="primary">
        <PlayIcon width={11} height={11} />
        {thread.hasLaunched ? 'Resume session' : 'Launch session'}
      </Button>
    )
  }
}

const toneIndicator: Record<Visual['tone'], string> = {
  idle: 'bg-[var(--color-fg-muted)]',
  progress: 'bg-[var(--color-info)] tm-pulse-dot',
  error: 'bg-[var(--color-danger)]',
  stopped: 'bg-[var(--color-warning)]'
}

export default function LaunchPanel({
  thread,
  session,
  copilotStatus,
  onLaunch
}: LaunchPanelProps): React.JSX.Element {
  const visual = pickVisual(thread, session, copilotStatus, onLaunch)
  const isProgress = visual.tone === 'progress'
  const composedTitle = composeThreadTitle(thread, session.runtimeTitle)

  return (
    <div className="tm-fade-in flex h-full w-full items-center justify-center rounded-lg border border-[var(--color-border)] bg-[#141414] px-6">
      <div className="flex w-full max-w-md flex-col items-center text-center">
        <div className="relative mb-5 grid size-14 place-items-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          {isProgress ? (
            <span
              aria-hidden
              className="absolute size-9 rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-fg)] tm-spin"
            />
          ) : null}
          <SparkIcon width={18} height={18} className="text-[var(--color-fg)]" />
        </div>

        <div className="mb-1.5 inline-flex max-w-full items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-input)] px-2.5 py-1 text-[11px] uppercase tracking-[0.16em] text-[var(--color-fg-subtle)]">
          <span className={`size-1.5 shrink-0 rounded-full ${toneIndicator[visual.tone]}`} />
          <span className="truncate normal-case tracking-normal text-[var(--color-fg-muted)]">
            {composedTitle}
          </span>
        </div>

        <h2 className="text-[18px] font-medium tracking-tight text-[var(--color-fg)]">
          {visual.title}
        </h2>
        <p className="mt-1.5 max-w-sm text-[12.5px] leading-5 text-[var(--color-fg-muted)]">
          {visual.detail}
        </p>

        {visual.action ? <div className="mt-5">{visual.action}</div> : null}

        <div className="mt-8 grid w-full grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-left text-[11.5px]">
          <span className="font-medium uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
            Branch
          </span>
          <span className="truncate font-mono text-[var(--color-fg)]">
            {thread.displayBranchName}
          </span>
          <span className="font-medium uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
            Mode
          </span>
          <span className="text-[var(--color-fg)]">
            {thread.mode === 'worktree' ? 'Owned worktree' : 'Active branch'}
          </span>
          <span className="font-medium uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
            Session
          </span>
          <span className="truncate font-mono text-[var(--color-fg-muted)]">
            {thread.sessionName}
          </span>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import type {
  AppSettingsSnapshot,
  RepositorySnapshot,
  ThreadSnapshot
} from '../../../shared/app-types'
import TerminalPane, { type TerminalPaneHandle, type TerminalPaneState } from './TerminalPane'
import LaunchPanel from './LaunchPanel'
import EmptyState from './EmptyState'
import Button from './ui/Button'
import { BranchIcon, InfoIcon, RefreshIcon, StopIcon, WorktreeIcon } from './Icons'

type WorkspaceProps = {
  selectedThread: ThreadSnapshot | null
  selectedRepository: RepositorySnapshot | null
  settings: AppSettingsSnapshot
  hasRepositories: boolean
  autoLaunchThreadId: string | null
  onAutoLaunchHandled: () => void
  onRefresh: () => Promise<void>
  onAddRepository: () => void
  onNewThread: () => void
  onOpenDetails: () => void
}

const INITIAL_STATE: TerminalPaneState = {
  copilotStatus: null,
  phase: 'initializing',
  exitCode: null,
  errorMessage: null
}

export default function Workspace({
  selectedThread,
  selectedRepository,
  settings,
  hasRepositories,
  autoLaunchThreadId,
  onAutoLaunchHandled,
  onRefresh,
  onAddRepository,
  onNewThread,
  onOpenDetails
}: WorkspaceProps): React.JSX.Element {
  const terminalRef = useRef<TerminalPaneHandle | null>(null)
  const [terminalState, setTerminalState] = useState<TerminalPaneState>(INITIAL_STATE)
  const autoLaunchedRef = useRef<Set<string>>(new Set())

  const hasThread = Boolean(selectedThread)
  const isRunning = terminalState.phase === 'running'
  const isLaunching = terminalState.phase === 'launching'
  const cliAvailable = terminalState.copilotStatus?.available ?? false

  const headerTitle = selectedThread
    ? selectedThread.title
    : selectedRepository
      ? selectedRepository.name
      : 'Taskmaster'

  const headerBranch = selectedThread
    ? selectedThread.displayBranchName
    : selectedRepository?.currentBranch

  // Auto-launch on freshly-created threads.
  useEffect(() => {
    if (!autoLaunchThreadId) {
      return
    }
    if (!selectedThread || selectedThread.id !== autoLaunchThreadId) {
      return
    }
    if (autoLaunchedRef.current.has(autoLaunchThreadId)) {
      onAutoLaunchHandled()
      return
    }
    if (terminalState.phase !== 'idle' || !cliAvailable) {
      return
    }

    autoLaunchedRef.current.add(autoLaunchThreadId)
    onAutoLaunchHandled()
    void terminalRef.current?.start()
  }, [autoLaunchThreadId, selectedThread, terminalState.phase, cliAvailable, onAutoLaunchHandled])

  return (
    <main className="flex min-h-0 min-w-0 flex-col bg-[var(--color-bg)]">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg)] px-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[14px] font-medium tracking-tight text-[var(--color-fg)]">
                {headerTitle}
              </h1>
              {selectedThread ? (
                <span
                  className="grid size-4 place-items-center rounded text-[var(--color-fg-subtle)]"
                  title={selectedThread.mode === 'worktree' ? 'Owned worktree' : 'Active branch'}
                >
                  {selectedThread.mode === 'worktree' ? (
                    <WorktreeIcon width={11} height={11} />
                  ) : (
                    <BranchIcon width={11} height={11} />
                  )}
                </span>
              ) : null}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-[var(--color-fg-subtle)]">
              {headerBranch ? (
                <span className="truncate font-mono">{headerBranch}</span>
              ) : (
                <span>No selection</span>
              )}
              {selectedThread ? (
                <>
                  <span className="text-[var(--color-fg-faint)]">·</span>
                  <span className="truncate">
                    {selectedThread.mode === 'worktree' ? 'worktree' : 'active branch'}
                  </span>
                  <span className="text-[var(--color-fg-faint)]">·</span>
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className={`size-1.5 rounded-full ${
                        isRunning
                          ? 'bg-[var(--color-positive)] tm-pulse-dot'
                          : isLaunching
                            ? 'bg-[var(--color-info)] tm-pulse-dot'
                            : 'bg-[var(--color-fg-faint)]'
                      }`}
                    />
                    {isRunning ? 'running' : isLaunching ? 'launching' : 'idle'}
                  </span>
                </>
              ) : null}
            </div>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            aria-label="Refresh"
            iconOnly
            onClick={() => void onRefresh()}
            size="sm"
            title="Refresh state"
            variant="ghost"
          >
            <RefreshIcon width={13} height={13} />
          </Button>

          {selectedThread ? (
            <>
              <Button
                aria-label="Thread details"
                iconOnly
                onClick={onOpenDetails}
                size="sm"
                title="Thread details"
                variant="ghost"
              >
                <InfoIcon width={13} height={13} />
              </Button>

              {isRunning ? (
                <Button
                  onClick={() => void terminalRef.current?.stop()}
                  size="sm"
                  title="Stop the running Copilot session"
                  variant="secondary"
                >
                  <StopIcon width={11} height={11} />
                  Stop
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          aria-hidden={!hasThread}
          className={`flex h-full flex-col p-5 transition-opacity duration-200 ${
            hasThread ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <div className="relative min-h-0 flex-1">
            <TerminalPane
              onRefresh={onRefresh}
              onStateChange={setTerminalState}
              ref={terminalRef}
              selectedThread={selectedThread}
              settings={settings}
            />

            {selectedThread && !isRunning ? (
              <div className="absolute inset-0">
                <LaunchPanel
                  onLaunch={() => void terminalRef.current?.start()}
                  state={terminalState}
                  thread={selectedThread}
                />
              </div>
            ) : null}
          </div>
        </div>

        {!hasThread ? (
          <div className="absolute inset-0">
            <EmptyState
              hasRepositories={hasRepositories}
              hasRepository={Boolean(selectedRepository)}
              onAddRepository={onAddRepository}
              onNewThread={onNewThread}
            />
          </div>
        ) : null}
      </div>
    </main>
  )
}

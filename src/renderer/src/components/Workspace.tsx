import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AppSettingsSnapshot,
  BranchStatusRequest,
  BranchStatusSnapshot,
  RepositorySnapshot,
  TerminalStatus,
  ThreadSnapshot
} from '../../../shared/app-types'
import TerminalSessions, {
  type SessionMap,
  type TerminalSessionsHandle,
  type ThreadSessionState
} from './TerminalSessions'
import ThreadDiffView from './ThreadDiffView'
import LaunchPanel from './LaunchPanel'
import EmptyState from './EmptyState'
import Button from './ui/Button'
import SegmentedControl from './ui/SegmentedControl'
import {
  BranchIcon,
  CodeIcon,
  FolderIcon,
  PlayIcon,
  RefreshIcon,
  StopIcon,
  WorktreeIcon
} from './Icons'
import { composeThreadTitle } from '../lib/title'

type WorkspaceProps = {
  threads: ThreadSnapshot[]
  selectedThread: ThreadSnapshot | null
  selectedRepository: RepositorySnapshot | null
  settings: AppSettingsSnapshot
  hasRepositories: boolean
  autoLaunchThreadId: string | null
  runCommandBusy: boolean
  onAutoLaunchHandled: () => void
  onRefresh: () => Promise<void>
  onAddRepository: () => void
  onNewThread: () => void
  onStartRunCommand: () => void
  onStopRunCommand: () => void
  onOpenWorkingDirectory: () => void
  onOpenWorkingDirectoryInVscode: () => void
  onSessionsChange: (sessions: SessionMap) => void
}

type ThreadWorkspaceViewId = 'copilot' | 'terminal' | 'diff'

type TerminalViewVisual = {
  tone: 'idle' | 'progress' | 'error' | 'stopped'
  title: string
  detail: string
  actionLabel: string | null
}

const IDLE_STATE: ThreadSessionState = {
  phase: 'idle',
  exitCode: null,
  errorMessage: null,
  runtimeTitle: null,
  lastUserMessage: null
}

const ACTIVE_BRANCH_STATUS_POLL_MS = 4_000
const IDLE_BRANCH_STATUS_POLL_MS = 15_000
const THREAD_VIEW_OPTIONS: Array<{
  value: ThreadWorkspaceViewId
  label: string
  description: string
}> = [
  {
    value: 'copilot',
    label: 'Copilot',
    description: 'Copilot session and recent prompt'
  },
  {
    value: 'terminal',
    label: 'Terminal',
    description: 'Plain shell in the thread working directory'
  },
  {
    value: 'diff',
    label: 'Diff',
    description: 'Changed files and patches for this thread'
  }
]
const THREAD_VIEW_CONTROL_WIDTH_PX = THREAD_VIEW_OPTIONS.length * 88

function formatBranchStatusTokens(status: BranchStatusSnapshot): string[] {
  const tokens: string[] = []
  if (status.ahead > 0) tokens.push(`↑${status.ahead}`)
  if (status.behind > 0) tokens.push(`↓${status.behind}`)
  if (status.staged > 0) tokens.push(`+${status.staged}`)
  if (status.modified > 0) tokens.push(`~${status.modified}`)
  if (status.deleted > 0) tokens.push(`-${status.deleted}`)
  if (status.untracked > 0) tokens.push(`?${status.untracked}`)
  if (status.conflicted > 0) tokens.push(`!${status.conflicted}`)
  return tokens
}

function formatBranchStatusTitle(status: BranchStatusSnapshot): string {
  const parts = [
    `${status.ahead} ahead`,
    `${status.behind} behind`,
    `${status.staged} staged`,
    `${status.modified} modified`,
    `${status.deleted} deleted`,
    `${status.untracked} untracked`,
    `${status.conflicted} conflicted`
  ]
  return parts.join(' · ')
}

function getSelectedThreadView(
  selections: Map<string, ThreadWorkspaceViewId>,
  threadId: string | null | undefined
): ThreadWorkspaceViewId {
  if (!threadId) {
    return 'copilot'
  }
  return selections.get(threadId) ?? 'copilot'
}

function pickTerminalVisual(
  thread: ThreadSnapshot,
  session: ThreadSessionState
): TerminalViewVisual {
  if (session.phase === 'launching') {
    return {
      tone: 'progress',
      title: 'Opening terminal…',
      detail: `Starting a shell in ${thread.cwd}.`,
      actionLabel: null
    }
  }

  if (session.phase === 'error') {
    return {
      tone: 'error',
      title: 'Failed to open terminal',
      detail: session.errorMessage ?? 'Unknown error.',
      actionLabel: 'Try again'
    }
  }

  if (session.phase === 'stopped') {
    return {
      tone: 'stopped',
      title: `Terminal ended${session.exitCode !== null ? ` (code ${session.exitCode})` : ''}`,
      detail: `Start a new shell in ${thread.cwd}.`,
      actionLabel: 'Restart terminal'
    }
  }

  return {
    tone: 'idle',
    title: 'Terminal ready',
    detail: `Open a shell in ${thread.cwd}.`,
    actionLabel: 'Start terminal'
  }
}

function TerminalLaunchPanel({
  thread,
  session,
  onLaunch
}: {
  thread: ThreadSnapshot
  session: ThreadSessionState
  onLaunch: () => void
}): React.JSX.Element {
  const visual = pickTerminalVisual(thread, session)

  return (
    <div className="tm-fade-in flex h-full w-full items-center justify-center rounded-lg border border-[var(--color-border)] bg-[#141414] px-6">
      <div className="flex w-full max-w-md flex-col items-center text-center">
        <div className="mb-3 inline-flex rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[11px] uppercase tracking-[0.16em] text-[var(--color-fg-subtle)]">
          Terminal
        </div>
        <h2 className="text-[18px] font-medium tracking-tight text-[var(--color-fg)]">
          {visual.title}
        </h2>
        <p
          className={`mt-2 max-w-sm text-[12.5px] leading-5 ${
            visual.tone === 'error' ? 'text-[var(--color-danger)]' : 'text-[var(--color-fg-muted)]'
          }`}
        >
          {visual.detail}
        </p>

        {visual.actionLabel ? (
          <div className="mt-5">
            <Button
              onClick={onLaunch}
              size="md"
              title={visual.actionLabel}
              variant={visual.tone === 'error' ? 'secondary' : 'primary'}
            >
              {visual.tone === 'error' || visual.tone === 'stopped' ? (
                <RefreshIcon width={12} height={12} />
              ) : (
                <PlayIcon width={11} height={11} />
              )}
              {visual.actionLabel}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default function Workspace({
  threads,
  selectedThread,
  selectedRepository,
  settings,
  hasRepositories,
  autoLaunchThreadId,
  runCommandBusy,
  onAutoLaunchHandled,
  onRefresh,
  onAddRepository,
  onNewThread,
  onStartRunCommand,
  onStopRunCommand,
  onOpenWorkingDirectory,
  onOpenWorkingDirectoryInVscode,
  onSessionsChange
}: WorkspaceProps): React.JSX.Element {
  const copilotSessionsRef = useRef<TerminalSessionsHandle | null>(null)
  const terminalSessionsRef = useRef<TerminalSessionsHandle | null>(null)
  const [copilotStatus, setCopilotStatus] = useState<TerminalStatus | null>(null)
  const [copilotSessions, setCopilotSessions] = useState<SessionMap>(new Map())
  const [terminalSessions, setTerminalSessions] = useState<SessionMap>(new Map())
  const [threadViewSelections, setThreadViewSelections] = useState<
    Map<string, ThreadWorkspaceViewId>
  >(new Map())
  const [branchStatusState, setBranchStatusState] = useState<{
    key: string | null
    value: BranchStatusSnapshot | null
  }>({
    key: null,
    value: null
  })
  const autoLaunchedRef = useRef<Set<string>>(new Set())
  const branchStatusPollMsRef = useRef(IDLE_BRANCH_STATUS_POLL_MS)

  useEffect(() => {
    let cancelled = false
    void window.api.terminal.getStatus().then((status) => {
      if (cancelled) return
      setCopilotStatus(status)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const handleCopilotSessionsChange = useCallback(
    (next: SessionMap): void => {
      setCopilotSessions(next)
      onSessionsChange(next)
    },
    [onSessionsChange]
  )

  const handleTerminalSessionsChange = useCallback((next: SessionMap): void => {
    setTerminalSessions(next)
  }, [])

  const selectedCopilotSession: ThreadSessionState = useMemo(() => {
    if (!selectedThread) return IDLE_STATE
    return copilotSessions.get(selectedThread.id) ?? IDLE_STATE
  }, [copilotSessions, selectedThread])

  const selectedTerminalSession: ThreadSessionState = useMemo(() => {
    if (!selectedThread) return IDLE_STATE
    return terminalSessions.get(selectedThread.id) ?? IDLE_STATE
  }, [selectedThread, terminalSessions])

  const selectedView = getSelectedThreadView(threadViewSelections, selectedThread?.id)
  const activeSession =
    selectedView === 'terminal'
      ? selectedTerminalSession
      : selectedView === 'copilot'
        ? selectedCopilotSession
        : IDLE_STATE
  const isRunning = activeSession.phase === 'running'
  const copilotRunning = selectedCopilotSession.phase === 'running'
  const cliAvailable = copilotStatus?.available ?? false
  const hasThread = Boolean(selectedThread)
  const hasRunCommand = Boolean(selectedRepository?.runCommand)
  const runCommandRunning = selectedThread?.isRunCommandRunning ?? false
  const showRunCommandButton = hasRunCommand || runCommandRunning
  const branchStatusTarget = useMemo<BranchStatusRequest | null>(() => {
    if (selectedThread) {
      return { threadId: selectedThread.id }
    }
    if (selectedRepository) {
      return { repositoryId: selectedRepository.id }
    }
    return null
  }, [selectedRepository, selectedThread])
  const branchStatusTargetKey = selectedThread
    ? `thread:${selectedThread.id}`
    : selectedRepository
      ? `repository:${selectedRepository.id}`
      : null
  const branchStatus =
    branchStatusTargetKey && branchStatusState.key === branchStatusTargetKey
      ? branchStatusState.value
      : null
  const branchStatusSummary = useMemo(() => {
    if (!branchStatus) {
      return null
    }
    const tokens = formatBranchStatusTokens(branchStatus)
    return tokens.length > 0 ? tokens.join(' ') : 'clean'
  }, [branchStatus])
  const branchStatusTitle = useMemo(() => {
    if (!branchStatus) {
      return null
    }
    const tokens = formatBranchStatusTokens(branchStatus)
    return tokens.length > 0 ? formatBranchStatusTitle(branchStatus) : 'Working tree clean'
  }, [branchStatus])

  const headerTitle = selectedThread
    ? composeThreadTitle(selectedThread, selectedCopilotSession.runtimeTitle)
    : selectedRepository
      ? selectedRepository.name
      : 'Taskmaster'

  const headerBranch = selectedThread
    ? selectedThread.displayBranchName
    : selectedRepository?.currentBranch
  const selectedThreadId = selectedThread?.id ?? null
  const latestUserMessage =
    selectedCopilotSession.lastUserMessage?.trim() ??
    selectedThread?.lastUserMessage?.trim() ??
    null

  useEffect(() => {
    const hasActiveThreadSession =
      hasThread &&
      [selectedCopilotSession, selectedTerminalSession].some(
        (session) => session.phase === 'running' || session.phase === 'launching'
      )

    branchStatusPollMsRef.current = hasActiveThreadSession
      ? ACTIVE_BRANCH_STATUS_POLL_MS
      : IDLE_BRANCH_STATUS_POLL_MS
  }, [hasThread, selectedCopilotSession, selectedTerminalSession])

  useEffect(() => {
    if (!branchStatusTarget || !branchStatusTargetKey) {
      return
    }

    let cancelled = false
    let timeoutId: number | null = null

    const load = async (): Promise<void> => {
      const nextStatus = await window.api.appState.getBranchStatus(branchStatusTarget)
      if (cancelled) {
        return
      }
      setBranchStatusState({
        key: branchStatusTargetKey,
        value: nextStatus
      })
      timeoutId = window.setTimeout(() => {
        void load()
      }, branchStatusPollMsRef.current)
    }

    void load()

    return () => {
      cancelled = true
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [
    branchStatusTarget,
    branchStatusTargetKey,
    selectedCopilotSession.phase,
    selectedTerminalSession.phase
  ])

  // Auto-launch on freshly-created threads.
  useEffect(() => {
    if (!autoLaunchThreadId) return
    if (!selectedThread || selectedThread.id !== autoLaunchThreadId) return
    if (autoLaunchedRef.current.has(autoLaunchThreadId)) {
      onAutoLaunchHandled()
      return
    }
    if (!cliAvailable) return
    if (selectedCopilotSession.phase !== 'idle') return

    autoLaunchedRef.current.add(autoLaunchThreadId)
    onAutoLaunchHandled()
    copilotSessionsRef.current?.start(autoLaunchThreadId)
  }, [
    autoLaunchThreadId,
    cliAvailable,
    onAutoLaunchHandled,
    selectedCopilotSession.phase,
    selectedThread
  ])

  useEffect(() => {
    if (!selectedThreadId || selectedView !== 'terminal') {
      return
    }

    terminalSessionsRef.current?.start(selectedThreadId)
  }, [selectedThreadId, selectedView])

  const handleSelectView = useCallback(
    (nextView: ThreadWorkspaceViewId): void => {
      if (!selectedThread) {
        return
      }

      setThreadViewSelections((current) => {
        if (current.get(selectedThread.id) === nextView) {
          return current
        }
        const next = new Map(current)
        next.set(selectedThread.id, nextView)
        return next
      })
    },
    [selectedThread]
  )

  const handleLaunchCopilot = useCallback((): void => {
    if (!selectedThread) return
    copilotSessionsRef.current?.start(selectedThread.id)
  }, [selectedThread])

  const handleLaunchTerminal = useCallback((): void => {
    if (!selectedThread) return
    terminalSessionsRef.current?.start(selectedThread.id)
  }, [selectedThread])

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--color-bg)]">
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
                  title={
                    selectedThread.mode === 'worktree'
                      ? 'Worktree'
                      : selectedThread.mode === 'new-branch'
                        ? 'New branch'
                        : 'Active branch'
                  }
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
              {branchStatusSummary ? (
                <>
                  <span className="text-[var(--color-fg-faint)]">·</span>
                  <span className="truncate font-mono" title={branchStatusTitle ?? undefined}>
                    {branchStatusSummary}
                  </span>
                </>
              ) : null}
            </div>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {selectedThread ? (
            <>
              {showRunCommandButton ? (
                <Button
                  aria-label={runCommandRunning ? 'Stop run command' : 'Run project command'}
                  disabled={runCommandBusy}
                  iconOnly
                  onClick={runCommandRunning ? onStopRunCommand : onStartRunCommand}
                  size="sm"
                  title={runCommandRunning ? 'Stop run command' : 'Run project command'}
                  variant="ghost"
                >
                  {runCommandRunning ? (
                    <StopIcon width={13} height={13} />
                  ) : (
                    <PlayIcon width={13} height={13} />
                  )}
                </Button>
              ) : null}

                <Button
                  aria-label="Open working directory"
                  iconOnly
                onClick={onOpenWorkingDirectory}
                size="sm"
                title="Open working directory"
                variant="ghost"
                >
                  <FolderIcon width={13} height={13} />
                </Button>

                <Button
                  aria-label="Open workspace in VS Code"
                  iconOnly
                  onClick={onOpenWorkingDirectoryInVscode}
                  size="sm"
                  title="Open workspace in VS Code"
                  variant="ghost"
                >
                  <CodeIcon width={13} height={13} />
                </Button>

              <div style={{ width: THREAD_VIEW_CONTROL_WIDTH_PX }}>
                <SegmentedControl<ThreadWorkspaceViewId>
                  ariaLabel="Thread view"
                  onChange={handleSelectView}
                  options={THREAD_VIEW_OPTIONS}
                  value={selectedView}
                />
              </div>
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
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            {selectedThread && selectedView === 'copilot' ? (
              <section className="shrink-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-4 py-3">
                <div className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-[var(--color-fg-subtle)]">
                  Most recent user message
                </div>
                <div className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[12.5px] leading-5 text-[var(--color-fg)]">
                  {latestUserMessage ? (
                    latestUserMessage
                  ) : (
                    <span className="text-[var(--color-fg-muted)]">No user message yet.</span>
                  )}
                </div>
              </section>
            ) : null}

            <div className="relative min-h-0 flex-1">
              <TerminalSessions
                copilotStatus={copilotStatus}
                kind="copilot"
                onRefresh={onRefresh}
                onSessionsChange={handleCopilotSessionsChange}
                ref={copilotSessionsRef}
                selectedThreadId={selectedView === 'copilot' ? (selectedThread?.id ?? null) : null}
                settings={settings}
                threads={threads}
              />

              <TerminalSessions
                copilotStatus={copilotStatus}
                kind="shell"
                onRefresh={onRefresh}
                onSessionsChange={handleTerminalSessionsChange}
                ref={terminalSessionsRef}
                selectedThreadId={selectedView === 'terminal' ? (selectedThread?.id ?? null) : null}
                settings={settings}
                threads={threads}
              />

              {selectedThread && selectedView === 'copilot' && !copilotRunning ? (
                <div className="absolute inset-0">
                  <LaunchPanel
                    copilotStatus={copilotStatus}
                    onLaunch={handleLaunchCopilot}
                    session={selectedCopilotSession}
                    thread={selectedThread}
                  />
                </div>
              ) : null}

              {selectedThread && selectedView === 'terminal' && !isRunning ? (
                <div className="absolute inset-0">
                  <TerminalLaunchPanel
                    onLaunch={handleLaunchTerminal}
                    session={selectedTerminalSession}
                    thread={selectedThread}
                  />
                </div>
              ) : null}

              {selectedView === 'diff' && selectedThread ? (
                <div className="absolute inset-0">
                  <ThreadDiffView key={selectedThread.id} thread={selectedThread} />
                </div>
              ) : null}
            </div>
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

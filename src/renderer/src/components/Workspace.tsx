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
import LaunchPanel from './LaunchPanel'
import EmptyState from './EmptyState'
import Button from './ui/Button'
import { BranchIcon, InfoIcon, RefreshIcon, StopIcon, WorktreeIcon } from './Icons'
import { composeThreadTitle } from '../lib/title'

type WorkspaceProps = {
  threads: ThreadSnapshot[]
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
  onSessionsChange: (sessions: SessionMap) => void
}

const IDLE_STATE: ThreadSessionState = {
  phase: 'idle',
  exitCode: null,
  errorMessage: null,
  runtimeTitle: null
}

const ACTIVE_BRANCH_STATUS_POLL_MS = 4_000
const IDLE_BRANCH_STATUS_POLL_MS = 15_000

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

export default function Workspace({
  threads,
  selectedThread,
  selectedRepository,
  settings,
  hasRepositories,
  autoLaunchThreadId,
  onAutoLaunchHandled,
  onRefresh,
  onAddRepository,
  onNewThread,
  onOpenDetails,
  onSessionsChange
}: WorkspaceProps): React.JSX.Element {
  const sessionsRef = useRef<TerminalSessionsHandle | null>(null)
  const [copilotStatus, setCopilotStatus] = useState<TerminalStatus | null>(null)
  const [sessions, setSessions] = useState<SessionMap>(new Map())
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

  const handleSessionsChange = useCallback(
    (next: SessionMap): void => {
      setSessions(next)
      onSessionsChange(next)
    },
    [onSessionsChange]
  )

  const selectedSession: ThreadSessionState = useMemo(() => {
    if (!selectedThread) return IDLE_STATE
    return sessions.get(selectedThread.id) ?? IDLE_STATE
  }, [sessions, selectedThread])

  const isRunning = selectedSession.phase === 'running'
  const isLaunching = selectedSession.phase === 'launching'
  const cliAvailable = copilotStatus?.available ?? false
  const hasThread = Boolean(selectedThread)
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
    ? composeThreadTitle(selectedThread, selectedSession.runtimeTitle)
    : selectedRepository
      ? selectedRepository.name
      : 'Taskmaster'

  const headerBranch = selectedThread
    ? selectedThread.displayBranchName
    : selectedRepository?.currentBranch

  useEffect(() => {
    branchStatusPollMsRef.current =
      hasThread && (isRunning || isLaunching)
        ? ACTIVE_BRANCH_STATUS_POLL_MS
        : IDLE_BRANCH_STATUS_POLL_MS
  }, [hasThread, isLaunching, isRunning])

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
  }, [branchStatusTarget, branchStatusTargetKey, selectedSession.phase])

  // Auto-launch on freshly-created threads.
  useEffect(() => {
    if (!autoLaunchThreadId) return
    if (!selectedThread || selectedThread.id !== autoLaunchThreadId) return
    if (autoLaunchedRef.current.has(autoLaunchThreadId)) {
      onAutoLaunchHandled()
      return
    }
    if (!cliAvailable) return
    if (selectedSession.phase !== 'idle') return

    autoLaunchedRef.current.add(autoLaunchThreadId)
    onAutoLaunchHandled()
    sessionsRef.current?.start(autoLaunchThreadId)
  }, [autoLaunchThreadId, selectedThread, selectedSession.phase, cliAvailable, onAutoLaunchHandled])

  const handleLaunch = (): void => {
    if (!selectedThread) return
    sessionsRef.current?.start(selectedThread.id)
  }

  const handleStop = (): void => {
    if (!selectedThread) return
    void sessionsRef.current?.stop(selectedThread.id)
  }

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
              {selectedThread ? (
                <>
                  <span className="text-[var(--color-fg-faint)]">·</span>
                  <span className="truncate">
                    {selectedThread.mode === 'worktree'
                      ? 'worktree'
                      : selectedThread.mode === 'new-branch'
                        ? 'new branch'
                        : 'active branch'}
                  </span>
                  {branchStatusSummary ? (
                    <>
                      <span className="text-[var(--color-fg-faint)]">·</span>
                      <span className="truncate font-mono" title={branchStatusTitle ?? undefined}>
                        {branchStatusSummary}
                      </span>
                    </>
                  ) : null}
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
              ) : branchStatusSummary ? (
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
                  onClick={handleStop}
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
            <TerminalSessions
              copilotStatus={copilotStatus}
              onRefresh={onRefresh}
              onSessionsChange={handleSessionsChange}
              ref={sessionsRef}
              selectedThreadId={selectedThread?.id ?? null}
              settings={settings}
              threads={threads}
            />

            {selectedThread && !isRunning ? (
              <div className="absolute inset-0">
                <LaunchPanel
                  copilotStatus={copilotStatus}
                  onLaunch={handleLaunch}
                  session={selectedSession}
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

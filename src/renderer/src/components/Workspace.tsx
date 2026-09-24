import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AppSettingsSnapshot,
  CreateRepositoryTaskInput,
  RepositorySnapshot,
  ThreadSnapshot,
  UpdateRepositoryTaskInput
} from '../../../shared/app-types'
import TerminalSessions, {
  type SessionMap,
  type TerminalSessionsHandle,
  type ThreadSessionState
} from './TerminalSessions'
import EmptyState from './EmptyState'
import ProjectTaskManager from './ProjectTaskManager'
import Button from './ui/Button'
import SegmentedControl from './ui/SegmentedControl'
import {
  BranchIcon,
  CodeIcon,
  FolderIcon,
  PlayIcon,
  RefreshIcon,
  StopIcon,
  VisualStudioIcon,
  WorktreeIcon
} from './Icons'
import { composeThreadTitle } from '../lib/title'
import { COPILOT_LABEL } from '../../../shared/copilot'
import { getRendererApi } from '../shared/api/client'
import { useBranchStatus } from '../shared/hooks/use-branch-status'
import {
  mergeCopilotThreadSessionState,
  toCopilotThreadSessionState
} from '../lib/copilot-thread-status'

const api = getRendererApi()
const LazyThreadDiffView = lazy(() => import('./ThreadDiffView'))
const LazyCopilotThreadView = lazy(() => import('./CopilotThreadView'))

type WorkspaceProps = {
  threads: ThreadSnapshot[]
  selectedThread: ThreadSnapshot | null
  selectedRepository: RepositorySnapshot | null
  showRepositoryTasks?: boolean
  settings: AppSettingsSnapshot
  hasRepositories: boolean
  repositoryTaskBusy: boolean
  runCommandBusy: boolean
  onRefresh: () => Promise<void>
  onAddRepository: () => void
  onCreateRepositoryTask: (
    input: Omit<CreateRepositoryTaskInput, 'repositoryId'>
  ) => Promise<boolean>
  onCompleteRepositoryTask: (taskId: string) => Promise<void>
  onUpdateRepositoryTask: (
    input: Omit<UpdateRepositoryTaskInput, 'repositoryId'>
  ) => Promise<boolean>
  onNewThread: () => void
  onStartRunCommand: () => void
  onStopRunCommand: () => void
  onOpenWorkingDirectory: () => void
  onOpenWorkingDirectoryInVscode: () => void
  onOpenSolutionInVisualStudio: () => void
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

function buildThreadViewOptions(agentLabel: string): Array<{
  value: ThreadWorkspaceViewId
  label: string
  description: string
}> {
  return [
    {
      value: 'copilot',
      label: agentLabel,
      description: `${agentLabel} session and recent prompt`
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

function DiffLoadingPanel(): React.JSX.Element {
  return (
    <div className="flex h-full w-full items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]">
      <div className="text-[12.5px] text-[var(--color-fg-muted)]">Loading diff…</div>
    </div>
  )
}

export default function Workspace({
  threads,
  selectedThread,
  selectedRepository,
  showRepositoryTasks = true,
  settings,
  hasRepositories,
  repositoryTaskBusy,
  runCommandBusy,
  onRefresh,
  onAddRepository,
  onCreateRepositoryTask,
  onCompleteRepositoryTask,
  onUpdateRepositoryTask,
  onNewThread,
  onStartRunCommand,
  onStopRunCommand,
  onOpenWorkingDirectory,
  onOpenWorkingDirectoryInVscode,
  onOpenSolutionInVisualStudio,
  onSessionsChange
}: WorkspaceProps): React.JSX.Element {
  const terminalSessionsRef = useRef<TerminalSessionsHandle | null>(null)
  const [customCopilotSessions, setCustomCopilotSessions] = useState<SessionMap>(new Map())
  const [terminalSessions, setTerminalSessions] = useState<SessionMap>(new Map())
  const [threadViewSelections, setThreadViewSelections] = useState<
    Map<string, ThreadWorkspaceViewId>
  >(new Map())
  const selectedCustomThreadId = selectedThread?.id ?? null
  const threadViewOptions = useMemo(() => buildThreadViewOptions(COPILOT_LABEL), [])
  const threadViewControlWidthPx = threadViewOptions.length * 88
  const hasSolutionFile = Boolean(selectedRepository?.solutionFilePath)

  const handleTerminalSessionsChange = useCallback((next: SessionMap): void => {
    setTerminalSessions(next)
  }, [])

  const handleCustomCopilotSessionChange = useCallback(
    (threadId: string, state: ThreadSessionState): void => {
      setCustomCopilotSessions((current) => {
        const next = new Map(current)
        next.set(
          threadId,
          mergeCopilotThreadSessionState(
            current.get(threadId),
            state,
            selectedCustomThreadId === threadId
          )
        )
        return next
      })
    },
    [selectedCustomThreadId]
  )

  useEffect(() => {
    return api.copilot.onSession(({ snapshot }) => {
      handleCustomCopilotSessionChange(snapshot.threadId, toCopilotThreadSessionState(snapshot))
    })
  }, [handleCustomCopilotSessionChange])

  useEffect(() => {
    onSessionsChange(customCopilotSessions)
  }, [customCopilotSessions, onSessionsChange])

  const selectedCopilotSession: ThreadSessionState = useMemo(() => {
    if (!selectedThread) return IDLE_STATE
    return customCopilotSessions.get(selectedThread.id) ?? IDLE_STATE
  }, [customCopilotSessions, selectedThread])

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
  const hasThread = Boolean(selectedThread)
  const hasRunCommand = Boolean(selectedRepository?.runCommand)
  const runCommandRunning = selectedThread?.isRunCommandRunning ?? false
  const showRunCommandButton = hasRunCommand || runCommandRunning
  const headerTitle = selectedThread
    ? composeThreadTitle(selectedThread, selectedCopilotSession.runtimeTitle)
    : selectedRepository
      ? selectedRepository.name
      : 'Taskmaster'

  const headerBranch = selectedThread
    ? selectedThread.displayBranchName
    : selectedRepository?.currentBranch
  const selectedThreadId = selectedThread?.id ?? null
  const { branchStatusSummary, branchStatusTitle } = useBranchStatus({
    selectedRepository,
    selectedThread,
    selectedAgentSession: selectedCopilotSession,
    selectedTerminalSession: selectedTerminalSession
  })

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

              {hasSolutionFile ? (
                <Button
                  aria-label="Open solution in Visual Studio"
                  iconOnly
                  onClick={onOpenSolutionInVisualStudio}
                  size="sm"
                  title="Open solution in Visual Studio"
                  variant="ghost"
                >
                  <VisualStudioIcon width={13} height={13} />
                </Button>
              ) : null}

              <div style={{ width: threadViewControlWidthPx }}>
                <SegmentedControl<ThreadWorkspaceViewId>
                  ariaLabel="Thread view"
                  onChange={handleSelectView}
                  options={threadViewOptions}
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
          className={`flex h-full flex-col ${selectedView === 'copilot' ? '' : 'p-5'} transition-opacity duration-200 ${
            hasThread ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="relative min-h-0 flex-1">
              <TerminalSessions
                onRefresh={onRefresh}
                onSessionsChange={handleTerminalSessionsChange}
                ref={terminalSessionsRef}
                selectedThreadId={selectedView === 'terminal' ? (selectedThread?.id ?? null) : null}
                settings={settings}
                threads={threads}
              />

              {selectedThread && selectedView === 'copilot' ? (
                <div className="absolute inset-0">
                  <Suspense
                    fallback={
                      <div className="p-6 text-sm text-[var(--color-fg-muted)]" role="status">
                        Opening thread…
                      </div>
                    }
                  >
                    <LazyCopilotThreadView
                      onSessionChange={handleCustomCopilotSessionChange}
                      thread={selectedThread}
                    />
                  </Suspense>
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
                  <Suspense fallback={<DiffLoadingPanel />}>
                    <LazyThreadDiffView key={selectedThread.id} thread={selectedThread} />
                  </Suspense>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {!hasThread && selectedRepository && showRepositoryTasks ? (
          <div className="absolute inset-0">
            <ProjectTaskManager
              busy={repositoryTaskBusy}
              key={selectedRepository.id}
              onCompleteTask={onCompleteRepositoryTask}
              onCreateTask={onCreateRepositoryTask}
              onUpdateTask={onUpdateRepositoryTask}
              repository={selectedRepository}
              taskTags={settings.parsedTaskTags}
            />
          </div>
        ) : null}

        {!hasThread && (!selectedRepository || !showRepositoryTasks) ? (
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

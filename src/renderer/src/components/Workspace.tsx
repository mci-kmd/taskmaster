import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AppSettingsSnapshot,
  CreateRepositoryTaskInput,
  RepositorySnapshot,
  ThreadSnapshot,
  UpdateRepositoryTaskInput
} from '../../../shared/app-types'
import { isGeneralProject } from '../../../shared/general-project'
import { resolveProjectTaskTags } from '../../../shared/task-tags'
import TerminalSessions, {
  type SessionMap,
  type TerminalSessionsHandle,
  type ThreadSessionState
} from './TerminalSessions'
import EmptyState from './EmptyState'
import ProjectTaskManager from './ProjectTaskManager'
import Button from './ui/Button'
import Presence from './ui/Presence'
import SegmentedControl from './ui/SegmentedControl'
import {
  BranchIcon,
  CheckIcon,
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
  dismissCopilotThreadDone,
  isDoneDismissKey,
  mergeCopilotThreadSessionState,
  toCopilotThreadSessionState
} from '../lib/copilot-thread-status'

const api = getRendererApi()
const LazyThreadDiffView = lazy(() => import('./ThreadDiffView'))
const LazyCopilotThreadView = lazy(() => import('./CopilotThreadView'))
const LazyThreadPreviewView = lazy(() => import('./preview/ThreadPreviewView'))

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
  onReopenRepositoryTask: (taskId: string) => Promise<void>
  onUpdateRepositoryTask: (
    input: Omit<UpdateRepositoryTaskInput, 'repositoryId'>
  ) => Promise<boolean>
  onReorderRepositoryTasks: (taskIds: string[]) => Promise<void>
  onNewThread: () => void
  onStartRunCommand: () => void
  onStopRunCommand: () => void
  onOpenWorkingDirectory: () => void
  onOpenWorkingDirectoryInVscode: () => void
  onOpenSolutionInVisualStudio: () => void
  onSessionsChange: (sessions: SessionMap) => void
}

type ThreadWorkspaceViewId = 'copilot' | 'preview' | 'terminal' | 'diff'

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

type ThreadPreviewAvailability = { enabled: true } | { enabled: false; reason: string }

function buildThreadViewOptions(
  agentLabel: string,
  preview: ThreadPreviewAvailability | null,
  includeDiff: boolean
): Array<{
  value: ThreadWorkspaceViewId
  label: string
  description: string
  disabled?: boolean
}> {
  return [
    {
      value: 'copilot',
      label: agentLabel,
      description: `${agentLabel} session and recent prompt`
    },
    ...(preview
      ? [
          {
            value: 'preview' as const,
            label: 'Preview',
            description: preview.enabled
              ? `Browse the running app and point ${agentLabel} at elements to change`
              : preview.reason,
            disabled: !preview.enabled
          }
        ]
      : []),
    {
      value: 'terminal',
      label: 'Terminal',
      description: 'Plain shell in the thread working directory'
    },
    ...(includeDiff
      ? [
          {
            value: 'diff' as const,
            label: 'Diff',
            description: 'Changed files and patches for this thread'
          }
        ]
      : [])
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
    <div className="tm-terminal-launch">
      {/* Keyed by tone so each state's copy fades in rather than snapping. */}
      <div className="tm-fade-in flex w-full max-w-md flex-col items-center" key={visual.tone}>
        <span className="tm-terminal-launch__eyebrow">Terminal</span>
        <h2 className="text-[17px] font-semibold tracking-[-0.012em] text-fg">{visual.title}</h2>
        <p
          className={`mt-2 max-w-sm text-[12.5px] leading-5 ${
            visual.tone === 'error' ? 'text-danger' : 'text-fg-muted'
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

function ViewLoading({ label }: { label: string }): React.JSX.Element {
  return (
    <div className="tm-workspace-loading" role="status">
      {label}
    </div>
  )
}

/** Shows one of two icons, turning between them when `showSecond` changes. */
function IconSwap({
  first,
  second,
  showSecond
}: {
  first: React.ReactNode
  second: React.ReactNode
  showSecond: boolean
}): React.JSX.Element {
  return (
    <span className="tm-icon-swap">
      <span aria-hidden={showSecond || undefined} data-active={!showSecond} className="flex">
        {first}
      </span>
      <span aria-hidden={!showSecond || undefined} data-active={showSecond} className="flex">
        {second}
      </span>
    </span>
  )
}

/** Branch status tokens (`↑2 ~3`); commits ahead read in the accent. */
function BranchStatusSummary({ summary }: { summary: string }): React.JSX.Element {
  return (
    <>
      {summary.split(' ').map((token, index) => (
        <span data-ahead={token.startsWith('↑') || undefined} key={`${index}:${token}`}>
          {index > 0 ? ' ' : ''}
          {token}
        </span>
      ))}
    </>
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
  onReopenRepositoryTask,
  onUpdateRepositoryTask,
  onReorderRepositoryTasks,
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
  const selectedPreviewUrl = selectedThread?.previewUrl ?? null
  const selectedRunCommandRunning = selectedThread?.isRunCommandRunning ?? false
  const selectedHasRunCommand = Boolean(selectedRepository?.runCommand)
  const previewAvailability = useMemo<ThreadPreviewAvailability | null>(() => {
    if (!selectedPreviewUrl) return null
    if (selectedRunCommandRunning) return { enabled: true }
    return {
      enabled: false,
      reason: selectedHasRunCommand
        ? 'Start the run command (▶ in the toolbar) to open the preview'
        : 'Add a run command in Edit project to use the preview'
    }
  }, [selectedHasRunCommand, selectedPreviewUrl, selectedRunCommandRunning])
  const generalProject = selectedThread
    ? selectedThread.projectKind === 'general'
    : isGeneralProject(selectedRepository)
  const threadViewOptions = useMemo(
    () => buildThreadViewOptions(COPILOT_LABEL, previewAvailability, !generalProject),
    [generalProject, previewAvailability]
  )
  const hasSolutionFile = Boolean(selectedRepository?.solutionFilePath)

  const handleTerminalSessionsChange = useCallback((next: SessionMap): void => {
    setTerminalSessions(next)
  }, [])

  const handleCustomCopilotSessionChange = useCallback(
    (threadId: string, state: ThreadSessionState): void => {
      setCustomCopilotSessions((current) => {
        const next = new Map(current)
        next.set(threadId, mergeCopilotThreadSessionState(current.get(threadId), state))
        return next
      })
    },
    []
  )

  const dismissDone = useCallback((threadId: string): void => {
    setCustomCopilotSessions((current) => {
      const session = current.get(threadId)
      if (session?.copilotStatus !== 'done') return current
      const next = new Map(current)
      next.set(threadId, dismissCopilotThreadDone(session))
      return next
    })
  }, [])

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

  // Another thread's Copilot working in this checkout would race an AI commit.
  const sharedCheckoutBusy = useMemo(() => {
    const cwd = selectedThread?.executionCwd?.toLowerCase()
    if (!selectedThread || !cwd) return false
    return threads.some((thread) => {
      if (thread.id === selectedThread.id || thread.executionCwd?.toLowerCase() !== cwd)
        return false
      const session = customCopilotSessions.get(thread.id)
      return (
        session?.copilotPhase === 'running' ||
        session?.copilotPhase === 'connecting' ||
        session?.copilotStatus === 'input'
      )
    })
  }, [customCopilotSessions, selectedThread, threads])

  const selectedTerminalSession: ThreadSessionState = useMemo(() => {
    if (!selectedThread) return IDLE_STATE
    return terminalSessions.get(selectedThread.id) ?? IDLE_STATE
  }, [selectedThread, terminalSessions])

  const requestedView = getSelectedThreadView(threadViewSelections, selectedThread?.id)
  // The preview follows the run command and comes back once the command runs again.
  const selectedView: ThreadWorkspaceViewId =
    (requestedView === 'preview' && !previewAvailability?.enabled) ||
    (requestedView === 'diff' && generalProject)
      ? 'copilot'
      : requestedView
  const activeSession =
    selectedView === 'terminal'
      ? selectedTerminalSession
      : selectedView === 'copilot' || selectedView === 'preview'
        ? selectedCopilotSession
        : IDLE_STATE
  const isRunning = activeSession.phase === 'running'
  const hasThread = Boolean(selectedThread)
  const hasRunCommand = Boolean(selectedRepository?.runCommand)
  const runCommandRunning = selectedThread?.isRunCommandRunning ?? false
  const showRunCommandButton = !generalProject && (hasRunCommand || runCommandRunning)
  const headerTitle = selectedThread
    ? composeThreadTitle(selectedThread, selectedCopilotSession.runtimeTitle)
    : selectedRepository
      ? selectedRepository.name
      : 'Taskmaster'

  const headerBranch = generalProject
    ? (selectedThread?.cwd ?? selectedRepository?.path)
    : selectedThread
      ? selectedThread.displayBranchName
      : selectedRepository?.currentBranch
  const selectedThreadId = selectedThread?.id ?? null
  const selectedDone = selectedCopilotSession.copilotStatus === 'done'
  const handleWorkspacePointerDown = useCallback((): void => {
    if (selectedThreadId && selectedDone) dismissDone(selectedThreadId)
  }, [dismissDone, selectedDone, selectedThreadId])
  const handleWorkspaceKeyDown = useCallback(
    (event: React.KeyboardEvent): void => {
      if (isDoneDismissKey(event.key)) handleWorkspacePointerDown()
    },
    [handleWorkspacePointerDown]
  )
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

  const modeLabel = selectedThread
    ? selectedThread.mode === 'worktree'
      ? 'Worktree'
      : selectedThread.mode === 'new-branch'
        ? 'New branch'
        : 'Active branch'
    : null
  const showTasks = !hasThread && Boolean(selectedRepository) && showRepositoryTasks
  const showThreadView = (view: ThreadWorkspaceViewId): boolean =>
    Boolean(selectedThread) && selectedView === view

  return (
    <main
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      onKeyDownCapture={handleWorkspaceKeyDown}
      onPointerDownCapture={handleWorkspacePointerDown}
    >
      <header className="tm-workspace-header">
        <div className="min-w-0 flex-1">
          <div className="tm-workspace-title">
            <h1>{headerTitle}</h1>
            {selectedThread && !generalProject ? (
              <span className="flex text-fg-subtle" title={modeLabel ?? undefined}>
                <IconSwap
                  first={<BranchIcon width={12} height={12} />}
                  second={<WorktreeIcon width={12} height={12} />}
                  showSecond={selectedThread.mode === 'worktree'}
                />
              </span>
            ) : null}
            <Presence motion="rise" show={Boolean(selectedThread && selectedDone)}>
              <button
                type="button"
                className="tm-workspace-done"
                title="Thread finished — click or interact with the thread to dismiss"
                aria-label="Dismiss done state"
              >
                <CheckIcon width={11} height={11} />
                Done
              </button>
            </Presence>
          </div>
          <div className="tm-workspace-sub">
            {headerBranch ? (
              <span className="truncate">{headerBranch}</span>
            ) : (
              <span className="font-sans">No selection</span>
            )}
            <Presence motion="fade" show={Boolean(branchStatusSummary)}>
              {branchStatusSummary ? (
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="text-fg-faint">·</span>
                  {/* Keyed so a new summary fades in instead of snapping. */}
                  <span
                    className="tm-fade-in truncate"
                    key={branchStatusSummary}
                    title={branchStatusTitle ?? undefined}
                  >
                    <BranchStatusSummary summary={branchStatusSummary} />
                  </span>
                </span>
              ) : null}
            </Presence>
          </div>
        </div>

        {selectedThread ? (
          <div className="flex shrink-0 items-center gap-0.5">
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
                <IconSwap
                  first={<PlayIcon width={13} height={13} />}
                  second={<StopIcon width={13} height={13} />}
                  showSecond={runCommandRunning}
                />
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
              <FolderIcon width={14} height={14} />
            </Button>

            {generalProject ? null : (
              <Button
                aria-label="Open workspace in VS Code"
                iconOnly
                onClick={onOpenWorkingDirectoryInVscode}
                size="sm"
                title="Open workspace in VS Code"
                variant="ghost"
              >
                <CodeIcon width={14} height={14} />
              </Button>
            )}

            {hasSolutionFile && !generalProject ? (
              <Button
                aria-label="Open solution in Visual Studio"
                iconOnly
                onClick={onOpenSolutionInVisualStudio}
                size="sm"
                title="Open solution in Visual Studio"
                variant="ghost"
              >
                <VisualStudioIcon width={14} height={14} />
              </Button>
            ) : null}

            <span aria-hidden="true" className="tm-workspace-separator" />

            <div className="shrink-0">
              <SegmentedControl<ThreadWorkspaceViewId>
                ariaLabel="Thread view"
                onChange={handleSelectView}
                options={threadViewOptions}
                value={selectedView}
              />
            </div>
          </div>
        ) : null}
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          aria-hidden={!hasThread}
          className={`absolute inset-0 transition-opacity duration-(--duration-base) ${
            hasThread ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <TerminalSessions
            onRefresh={onRefresh}
            onSessionsChange={handleTerminalSessionsChange}
            ref={terminalSessionsRef}
            selectedThreadId={selectedView === 'terminal' ? (selectedThread?.id ?? null) : null}
            settings={settings}
            threads={threads}
          />

          {/* Each view is a layer; switching crossfades the leaving and arriving layers. */}
          <Presence motion="fade" show={showThreadView('copilot')}>
            {selectedThread ? (
              <div className="absolute inset-0">
                <Suspense fallback={<ViewLoading label="Opening thread…" />}>
                  <LazyCopilotThreadView
                    legacyModels={settings.legacyCopilotModels}
                    onSessionChange={handleCustomCopilotSessionChange}
                    sharedCheckoutBusy={sharedCheckoutBusy}
                    thread={selectedThread}
                  />
                </Suspense>
              </div>
            ) : null}
          </Presence>

          <Presence motion="fade" show={showThreadView('preview') && Boolean(selectedPreviewUrl)}>
            {selectedThread && selectedPreviewUrl ? (
              <div className="absolute inset-0">
                <Suspense fallback={<ViewLoading label="Opening preview…" />}>
                  <LazyThreadPreviewView
                    legacyModels={settings.legacyCopilotModels}
                    onSessionChange={handleCustomCopilotSessionChange}
                    previewUrl={selectedPreviewUrl}
                    sharedCheckoutBusy={sharedCheckoutBusy}
                    thread={selectedThread}
                  />
                </Suspense>
              </div>
            ) : null}
          </Presence>

          <Presence motion="fade" show={showThreadView('terminal') && !isRunning}>
            {selectedThread ? (
              <div className="absolute inset-0 bg-panel">
                <TerminalLaunchPanel
                  onLaunch={handleLaunchTerminal}
                  session={selectedTerminalSession}
                  thread={selectedThread}
                />
              </div>
            ) : null}
          </Presence>

          <Presence motion="fade" show={showThreadView('diff')}>
            {selectedThread ? (
              <div className="absolute inset-0">
                <Suspense fallback={<ViewLoading label="Loading diff…" />}>
                  <LazyThreadDiffView key={selectedThread.id} thread={selectedThread} />
                </Suspense>
              </div>
            ) : null}
          </Presence>
        </div>

        <Presence motion="fade" show={showTasks}>
          {showTasks && selectedRepository ? (
            <div className="absolute inset-0">
              <ProjectTaskManager
                busy={repositoryTaskBusy}
                key={selectedRepository.id}
                onCompleteTask={onCompleteRepositoryTask}
                onCreateTask={onCreateRepositoryTask}
                onReopenTask={onReopenRepositoryTask}
                onUpdateTask={onUpdateRepositoryTask}
                onReorderTasks={onReorderRepositoryTasks}
                repository={selectedRepository}
                taskTags={resolveProjectTaskTags(
                  settings.parsedTaskTags,
                  selectedRepository.taskTagsInput
                )}
              />
            </div>
          ) : null}
        </Presence>

        <Presence motion="fade" show={!hasThread && (!selectedRepository || !showRepositoryTasks)}>
          <div className="absolute inset-0">
            <EmptyState
              hasRepositories={hasRepositories}
              hasRepository={Boolean(selectedRepository)}
              onAddRepository={onAddRepository}
              onNewThread={onNewThread}
            />
          </div>
        </Presence>
      </div>
    </main>
  )
}

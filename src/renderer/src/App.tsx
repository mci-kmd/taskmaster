import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Sidebar from './components/Sidebar'
import Workspace from './components/Workspace'
import ModelPerformanceView from './components/ModelPerformanceView'
import Toast, { type ToastTone } from './components/Toast'
import EditRepositoryDialog from './components/dialogs/EditRepositoryDialog'
import EditThreadDialog from './components/dialogs/EditThreadDialog'
import NewThreadDialog from './components/dialogs/NewThreadDialog'
import SettingsDialog from './components/dialogs/SettingsDialog'
import ResizeHandle from './components/ResizeHandle'
import type { SessionMap } from './components/TerminalSessions'
import { getRendererApi } from './shared/api/client'
import { useAppSnapshot } from './shared/hooks/use-app-snapshot'
import {
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  type AppSnapshot,
  type ModelPerformanceSample,
  type CreateRepositoryTaskInput,
  type RepositorySnapshot,
  type ThreadMode,
  type ThreadSnapshot,
  type UpdateSettingsInput,
  type UpdateRepositoryInput,
  type UpdateRepositoryTaskInput
} from '../../shared/app-types'

type Feedback = {
  tone: ToastTone
  message: string
}

type DialogKey = 'new-thread' | 'settings' | 'edit-repository' | 'edit-thread' | null

const api = getRendererApi()

function findThreadById(snapshot: AppSnapshot, threadId: string): ThreadSnapshot | null {
  return (
    snapshot.repositories
      .flatMap((repository) => repository.threads)
      .find((thread) => thread.id === threadId) ?? null
  )
}

function findSelectedRepository(snapshot: AppSnapshot): RepositorySnapshot | null {
  if (snapshot.selectedRepositoryId) {
    return (
      snapshot.repositories.find((repository) => repository.id === snapshot.selectedRepositoryId) ??
      null
    )
  }

  return snapshot.repositories[0] ?? null
}

function findSelectedThread(snapshot: AppSnapshot): ThreadSnapshot | null {
  if (!snapshot.selectedThreadId) {
    return null
  }

  return (
    snapshot.repositories
      .flatMap((repository) => repository.threads)
      .find((thread) => thread.id === snapshot.selectedThreadId) ?? null
  )
}

function applyThreadSelection(snapshot: AppSnapshot, threadId: string | null): AppSnapshot {
  if (!threadId) {
    return {
      ...snapshot,
      selectedThreadId: null
    }
  }

  const thread = findThreadById(snapshot, threadId)
  if (!thread) {
    return snapshot
  }

  return {
    ...snapshot,
    selectedRepositoryId: thread.repositoryId,
    selectedThreadId: thread.id
  }
}

export default function App(): React.JSX.Element {
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogKey>(null)
  const [editingRepositoryId, setEditingRepositoryId] = useState<string | null>(null)
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null)
  const [inboxProjectId, setInboxProjectId] = useState<string | null>(null)
  const [repositoryViewId, setRepositoryViewId] = useState<string | null>(null)
  const [newThreadError, setNewThreadError] = useState<string | null>(null)
  const [sessions, setSessions] = useState<SessionMap>(new Map())
  const [performanceOpen, setPerformanceOpen] = useState(false)
  const [performanceSamples, setPerformanceSamples] = useState<ModelPerformanceSample[]>([])
  const [performanceLoading, setPerformanceLoading] = useState(false)
  const [performanceError, setPerformanceError] = useState<string | null>(null)
  const [performanceRetry, setPerformanceRetry] = useState(0)
  const [sidebarWidth, setSidebarWidth] = useState<number>(SIDEBAR_WIDTH_DEFAULT)
  const selectionRequestIdRef = useRef(0)
  const handleSnapshotLoaded = useCallback((nextSnapshot: AppSnapshot): void => {
    setSidebarWidth(nextSnapshot.sidebarWidth)
  }, [])
  const handleMutationFeedback = useCallback(
    (
      result: { ok: boolean; cancelled?: boolean; error?: string },
      successMessage?: string
    ): void => {
      if (result.ok) {
        if (successMessage) {
          setFeedback({ tone: 'success', message: successMessage })
        }
        return
      }

      if (!result.cancelled) {
        setFeedback({ tone: 'error', message: result.error ?? 'Request failed.' })
      }
    },
    []
  )
  const { applyMutation, refreshSnapshot, setSnapshot, snapshot } = useAppSnapshot({
    onSnapshotLoaded: handleSnapshotLoaded,
    onMutationFeedback: handleMutationFeedback
  })

  const settlingThreadIds = useRef(new Set<string>())
  const handleSettleThread = useCallback(
    async (threadId: string, settled: boolean): Promise<void> => {
      if (settlingThreadIds.current.has(threadId)) return
      settlingThreadIds.current.add(threadId)
      try {
        await applyMutation(api.appState.updateThread({ threadId, settled }))
      } catch (error) {
        setFeedback({
          tone: 'error',
          message: error instanceof Error ? error.message : String(error)
        })
      } finally {
        settlingThreadIds.current.delete(threadId)
      }
    },
    [applyMutation]
  )

  const selectedRepository = useMemo(() => {
    if (!snapshot) {
      return null
    }

    if (repositoryViewId) {
      return snapshot.repositories.find((repository) => repository.id === repositoryViewId) ?? null
    }

    if (inboxProjectId) {
      return (
        snapshot.repositories.find((repository) => repository.id === inboxProjectId) ??
        findSelectedRepository(snapshot)
      )
    }

    return findSelectedRepository(snapshot)
  }, [inboxProjectId, repositoryViewId, snapshot])

  const selectedThread = useMemo(() => {
    if (!snapshot || repositoryViewId) {
      return null
    }

    return findSelectedThread(snapshot)
  }, [repositoryViewId, snapshot])

  useEffect(() => {
    if (!snapshot || !repositoryViewId) {
      return
    }

    if (!snapshot.repositories.some((repository) => repository.id === repositoryViewId)) {
      setRepositoryViewId(null)
    }
  }, [repositoryViewId, snapshot])

  const editingRepository = useMemo(() => {
    if (!snapshot || !editingRepositoryId) {
      return null
    }

    return snapshot.repositories.find((repository) => repository.id === editingRepositoryId) ?? null
  }, [editingRepositoryId, snapshot])

  const editingThread = useMemo(() => {
    if (!snapshot || !editingThreadId) {
      return null
    }

    return findThreadById(snapshot, editingThreadId)
  }, [editingThreadId, snapshot])

  const allThreads = useMemo<ThreadSnapshot[]>(() => {
    return snapshot ? snapshot.repositories.flatMap((repository) => repository.threads) : []
  }, [snapshot])

  const handleSessionsChange = useCallback((next: SessionMap): void => {
    setSessions(next)
  }, [])

  useEffect(() => {
    if (!performanceOpen) return
    let mounted = true
    const merge = (
      current: ModelPerformanceSample[],
      incoming: ModelPerformanceSample[]
    ): ModelPerformanceSample[] => {
      const ids = new Set(current.map((sample) => sample.id))
      const added = incoming.filter((sample) => !ids.has(sample.id))
      return added.length ? [...current, ...added] : current
    }
    setPerformanceLoading(true)
    const unsubscribe = api.copilot.onPerformanceSample(({ sample }) => {
      if (mounted) setPerformanceSamples((current) => merge(current, [sample]))
    })
    void api.copilot.getPerformanceSamples().then(
      (samples) => {
        if (!mounted) return
        setPerformanceSamples((current) => merge(samples, current))
        setPerformanceError(null)
        setPerformanceLoading(false)
      },
      (error: unknown) => {
        if (!mounted) return
        setPerformanceError(error instanceof Error ? error.message : String(error))
        setPerformanceLoading(false)
      }
    )
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [performanceOpen, performanceRetry])

  const handleSidebarResizeEnd = useCallback((finalWidth: number): void => {
    void api.appState.updateUi({ sidebarWidth: finalWidth })
  }, [])

  const handleAddRepository = useCallback(async (): Promise<void> => {
    setBusyAction('add-repository')
    const result = await applyMutation(api.appState.addRepository(), 'Repository added.')
    if (result.ok && result.snapshot?.selectedRepositoryId) {
      setInboxProjectId(result.snapshot.selectedRepositoryId)
      setRepositoryViewId(null)
    }
    setBusyAction(null)
  }, [applyMutation])

  const handleOpenRepositoryEditor = useCallback((repositoryId: string): void => {
    setEditingRepositoryId(repositoryId)
    setDialog('edit-repository')
  }, [])

  const handleCloseRepositoryEditor = useCallback((): void => {
    setDialog(null)
    setEditingRepositoryId(null)
  }, [])

  const handleOpenThreadEditor = useCallback((threadId: string): void => {
    setEditingThreadId(threadId)
    setDialog('edit-thread')
  }, [])

  const handleCloseThreadEditor = useCallback((): void => {
    setDialog(null)
    setEditingThreadId(null)
  }, [])

  const handleSelectRepository = useCallback((repositoryId: string): void => {
    setPerformanceOpen(false)
    setInboxProjectId(repositoryId)
    setRepositoryViewId(null)
  }, [])

  const handleSelectThread = useCallback(
    (threadId: string): void => {
      setPerformanceOpen(false)
      setInboxProjectId(null)
      const requestId = ++selectionRequestIdRef.current
      setRepositoryViewId(null)
      setSnapshot((current) => (current ? applyThreadSelection(current, threadId) : current))
      void api.appState.selectThread(threadId).then((nextSnapshot) => {
        if (selectionRequestIdRef.current !== requestId) {
          return
        }

        setSnapshot(nextSnapshot)
      })
    },
    [setSnapshot]
  )

  const handleCreateThread = useCallback(
    async (input: {
      mode: ThreadMode
      title?: string
      branchName?: string
      useCurrentBranch?: boolean
    }): Promise<boolean> => {
      if (!selectedRepository) {
        return false
      }

      setNewThreadError(null)
      setBusyAction('create-thread')
      try {
        const result = await api.appState.createThread({
          repositoryId: selectedRepository.id,
          mode: input.mode,
          title: input.title,
          branchName: input.branchName,
          useCurrentBranch: input.useCurrentBranch
        })

        if (result.snapshot) {
          setSnapshot(result.snapshot)
        }

        if (result.ok && result.snapshot?.selectedThreadId) {
          setRepositoryViewId(null)
          setInboxProjectId(null)
          setPerformanceOpen(false)
        } else if (!result.cancelled) {
          setNewThreadError(result.error ?? 'Thread creation failed.')
        }

        return result.ok
      } catch (error) {
        setNewThreadError(error instanceof Error ? error.message : String(error))
        return false
      } finally {
        setBusyAction(null)
      }
    },
    [selectedRepository, setSnapshot]
  )

  const handleOpenNewThreadDialog = useCallback(
    (repositoryId?: string): void => {
      const targetRepositoryId = repositoryId ?? selectedRepository?.id
      if (!targetRepositoryId) {
        return
      }

      if (targetRepositoryId !== selectedRepository?.id) {
        handleSelectRepository(targetRepositoryId)
      }
      setNewThreadError(null)
      setDialog('new-thread')
    },
    [handleSelectRepository, selectedRepository]
  )

  const handleCloseNewThreadDialog = useCallback((): void => {
    setDialog(null)
    setNewThreadError(null)
  }, [])

  const handleSaveSettings = useCallback(
    async (input: UpdateSettingsInput): Promise<boolean> => {
      setBusyAction('save-settings')
      const result = await applyMutation(api.appState.updateSettings(input), 'Settings saved.')
      setBusyAction(null)
      return result.ok
    },
    [applyMutation]
  )

  const handleBrowseRepositoryFavicon = useCallback(
    async (repositoryId: string): Promise<string | null> => {
      const result = await api.appState.pickRepositoryFavicon(repositoryId)
      if (result.ok) {
        return result.path
      }

      if ('cancelled' in result && result.cancelled) {
        return null
      }

      if ('error' in result) {
        setFeedback({ tone: 'error', message: result.error })
      }

      return null
    },
    []
  )

  const handleBrowseRepositorySolutionFile = useCallback(
    async (repositoryId: string): Promise<string | null> => {
      const result = await api.appState.pickRepositorySolutionFile(repositoryId)
      if (result.ok) {
        return result.path
      }

      if ('cancelled' in result && result.cancelled) {
        return null
      }

      if ('error' in result) {
        setFeedback({ tone: 'error', message: result.error })
      }

      return null
    },
    []
  )

  const handleSaveRepository = useCallback(
    async (input: UpdateRepositoryInput): Promise<boolean> => {
      setBusyAction('save-repository')
      const result = await applyMutation(api.appState.updateRepository(input), 'Project updated.')
      setBusyAction(null)
      return result.ok
    },
    [applyMutation]
  )

  const handleCreateRepositoryTask = useCallback(
    async (input: Omit<CreateRepositoryTaskInput, 'repositoryId'>): Promise<boolean> => {
      if (!selectedRepository) {
        return false
      }

      setBusyAction('create-task')
      const result = await applyMutation(
        api.appState.createRepositoryTask({
          repositoryId: selectedRepository.id,
          title: input.title,
          description: input.description,
          tags: input.tags
        }),
        'Task created.'
      )
      setBusyAction(null)
      return result.ok
    },
    [applyMutation, selectedRepository]
  )

  const handleCompleteRepositoryTask = useCallback(
    async (taskId: string): Promise<void> => {
      if (!selectedRepository) {
        return
      }

      setBusyAction('complete-task')
      await applyMutation(
        api.appState.completeRepositoryTask({
          repositoryId: selectedRepository.id,
          taskId
        }),
        'Task completed.'
      )
      setBusyAction(null)
    },
    [applyMutation, selectedRepository]
  )

  const handleUpdateRepositoryTask = useCallback(
    async (input: Omit<UpdateRepositoryTaskInput, 'repositoryId'>): Promise<boolean> => {
      if (!selectedRepository) {
        return false
      }

      setBusyAction('update-task')
      const result = await applyMutation(
        api.appState.updateRepositoryTask({
          repositoryId: selectedRepository.id,
          taskId: input.taskId,
          title: input.title,
          description: input.description,
          tags: input.tags
        }),
        'Task updated.'
      )
      setBusyAction(null)
      return result.ok
    },
    [applyMutation, selectedRepository]
  )

  const handleStartRunCommand = useCallback(async (): Promise<void> => {
    if (!selectedThread) {
      return
    }

    setBusyAction('run-command')
    await applyMutation(api.appState.startThreadRun(selectedThread.id))
    setBusyAction(null)
  }, [applyMutation, selectedThread])

  const handleStopRunCommand = useCallback(async (): Promise<void> => {
    if (!selectedThread) {
      return
    }

    setBusyAction('run-command')
    await applyMutation(api.appState.stopThreadRun(selectedThread.id))
    setBusyAction(null)
  }, [applyMutation, selectedThread])

  const handleSaveThread = useCallback(
    async (input: { threadId: string; customTitle: string | null }): Promise<boolean> => {
      setBusyAction('save-thread')
      const result = await applyMutation(api.appState.updateThread(input), 'Thread updated.')
      setBusyAction(null)
      return result.ok
    },
    [applyMutation]
  )

  const handleCloseThread = useCallback(
    async (threadId: string): Promise<void> => {
      setBusyAction('close-thread')
      try {
        await applyMutation(api.appState.closeThread(threadId), 'Thread closed.')
      } catch (error) {
        setFeedback({
          tone: 'error',
          message: error instanceof Error ? error.message : String(error)
        })
      } finally {
        setBusyAction(null)
      }
    },
    [applyMutation]
  )

  const handleConvertThreadToWorktree = useCallback(
    async (threadId: string): Promise<void> => {
      setBusyAction('convert-thread-to-worktree')
      try {
        await applyMutation(
          api.appState.convertThreadToWorktree(threadId),
          'Thread converted to work tree.'
        )
      } catch (error) {
        setFeedback({
          tone: 'error',
          message: error instanceof Error ? error.message : String(error)
        })
      } finally {
        setBusyAction(null)
      }
    },
    [applyMutation]
  )

  const handleOpenWorkingDirectory = useCallback(async (): Promise<void> => {
    if (!selectedThread) {
      return
    }

    const result = await api.appState.openThreadWorkingDirectory(selectedThread.id)
    if (!result.ok) {
      setFeedback({ tone: 'error', message: result.error })
    }
  }, [selectedThread])

  const handleOpenWorkingDirectoryInVscode = useCallback(async (): Promise<void> => {
    if (!selectedThread) {
      return
    }

    const result = await api.appState.openThreadWorkspaceInVscode(selectedThread.id)
    if (!result.ok) {
      setFeedback({ tone: 'error', message: result.error })
      return
    }

    setFeedback({ tone: 'success', message: 'Opened workspace in VS Code.' })
  }, [selectedThread])

  const handleOpenSolutionInVisualStudio = useCallback(async (): Promise<void> => {
    if (!selectedThread) {
      return
    }

    const result = await api.appState.openThreadSolutionInVisualStudio(selectedThread.id)
    if (!result.ok) {
      setFeedback({ tone: 'error', message: result.error })
      return
    }

    setFeedback({ tone: 'success', message: 'Opened solution in Visual Studio.' })
  }, [selectedThread])

  // Refresh repo state (current branch, primary branch, etc.) every time the
  // New Thread dialog opens — git state can change externally between opens.
  useEffect(() => {
    if (dialog === 'new-thread') {
      void refreshSnapshot()
    }
  }, [dialog, refreshSnapshot])

  // Ctrl+N to open new-thread dialog (also accepts ⌘ for cross-platform devs)
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
        if (!selectedRepository) {
          return
        }

        event.preventDefault()
        handleOpenNewThreadDialog()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleOpenNewThreadDialog, selectedRepository])

  if (!snapshot) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--color-bg)] text-[var(--color-fg-muted)]">
        <span className="font-mono text-[12px] uppercase tracking-[0.2em] text-[var(--color-fg-subtle)]">
          Loading
          <span className="tm-pulse-dot ml-1 inline-block size-1 rounded-full bg-[var(--color-fg)] align-middle" />
        </span>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-[var(--color-bg)] text-[var(--color-fg)]">
      <div className="relative flex shrink-0" style={{ width: sidebarWidth }}>
        <Sidebar
          busyAddRepository={busyAction === 'add-repository'}
          closingThread={busyAction === 'close-thread'}
          convertingThread={busyAction === 'convert-thread-to-worktree'}
          onAddRepository={() => void handleAddRepository()}
          onCloseThread={(id) => void handleCloseThread(id)}
          onConvertThreadToWorktree={(id) => void handleConvertThreadToWorktree(id)}
          onEditRepository={handleOpenRepositoryEditor}
          onOpenRepositoryTasks={(id) => {
            setRepositoryViewId(id)
            setPerformanceOpen(false)
          }}
          onEditThread={handleOpenThreadEditor}
          onNewThread={handleOpenNewThreadDialog}
          onOpenSettings={() => setDialog('settings')}
          onOpenPerformance={() => {
            setDialog(null)
            setPerformanceOpen(true)
          }}
          performanceOpen={performanceOpen}
          onSettleThread={(id, settled) => void handleSettleThread(id, settled)}
          onSelectRepository={(id) => void handleSelectRepository(id)}
          onSelectThread={(id) => void handleSelectThread(id)}
          selectedRepository={selectedRepository}
          selectedThread={selectedThread}
          sessions={sessions}
          snapshot={snapshot}
        />
        <ResizeHandle
          max={SIDEBAR_WIDTH_MAX}
          min={SIDEBAR_WIDTH_MIN}
          onResize={setSidebarWidth}
          onResizeEnd={handleSidebarResizeEnd}
          width={sidebarWidth}
        />
      </div>

      <div className="relative flex min-h-0 min-w-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1" inert={performanceOpen}>
          <Workspace
            hasRepositories={snapshot.repositories.length > 0}
            onAddRepository={() => void handleAddRepository()}
            onCompleteRepositoryTask={handleCompleteRepositoryTask}
            onCreateRepositoryTask={(input) => handleCreateRepositoryTask(input)}
            onUpdateRepositoryTask={(input) => handleUpdateRepositoryTask(input)}
            onNewThread={() => handleOpenNewThreadDialog()}
            onStartRunCommand={() => void handleStartRunCommand()}
            onStopRunCommand={() => void handleStopRunCommand()}
            onOpenWorkingDirectory={() => void handleOpenWorkingDirectory()}
            onOpenWorkingDirectoryInVscode={() => void handleOpenWorkingDirectoryInVscode()}
            onOpenSolutionInVisualStudio={() => void handleOpenSolutionInVisualStudio()}
            onRefresh={refreshSnapshot}
            onSessionsChange={handleSessionsChange}
            repositoryTaskBusy={
              busyAction === 'create-task' ||
              busyAction === 'complete-task' ||
              busyAction === 'update-task'
            }
            runCommandBusy={busyAction === 'run-command'}
            selectedRepository={
              selectedThread
                ? (snapshot.repositories.find(
                    (repository) => repository.id === selectedThread.repositoryId
                  ) ?? null)
                : selectedRepository
            }
            showRepositoryTasks={repositoryViewId !== null}
            selectedThread={selectedThread}
            settings={snapshot.settings}
            threads={allThreads}
          />
        </div>
        {performanceOpen ? (
          <div className="absolute inset-0 z-10 flex min-h-0 min-w-0">
            <ModelPerformanceView
              samples={performanceSamples}
              loading={performanceLoading}
              error={performanceError}
              onRetry={() => setPerformanceRetry((value) => value + 1)}
              onClose={() => setPerformanceOpen(false)}
            />
          </div>
        ) : null}
      </div>

      <NewThreadDialog
        busy={busyAction === 'create-thread'}
        error={newThreadError}
        onClose={handleCloseNewThreadDialog}
        onSubmit={handleCreateThread}
        open={dialog === 'new-thread'}
        repository={selectedRepository}
      />

      <SettingsDialog
        busy={busyAction === 'save-settings'}
        onClose={() => setDialog(null)}
        onSubmit={handleSaveSettings}
        open={dialog === 'settings'}
        settings={snapshot.settings}
      />

      <EditRepositoryDialog
        busy={busyAction === 'save-repository'}
        onBrowseFavicon={handleBrowseRepositoryFavicon}
        onBrowseSolutionFile={handleBrowseRepositorySolutionFile}
        onClose={handleCloseRepositoryEditor}
        onSubmit={handleSaveRepository}
        open={dialog === 'edit-repository'}
        repository={editingRepository}
      />

      <EditThreadDialog
        busy={busyAction === 'save-thread'}
        onClose={handleCloseThreadEditor}
        onSubmit={handleSaveThread}
        open={dialog === 'edit-thread'}
        runtimeTitle={editingThread ? (sessions.get(editingThread.id)?.runtimeTitle ?? null) : null}
        thread={editingThread}
      />

      {feedback ? (
        <Toast
          message={feedback.message}
          onDismiss={() => setFeedback(null)}
          tone={feedback.tone}
        />
      ) : null}
    </div>
  )
}

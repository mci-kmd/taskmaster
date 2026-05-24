import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Sidebar from './components/Sidebar'
import Workspace from './components/Workspace'
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
  type CreateRepositoryTaskInput,
  type RepositorySnapshot,
  type ThreadMode,
  type ThreadSnapshot,
  type UpdateSettingsInput,
  type UpdateRepositoryTaskInput
} from '../../shared/app-types'

type Feedback = {
  tone: ToastTone
  message: string
}

type DialogKey = 'new-thread' | 'settings' | 'edit-repository' | 'edit-thread' | null

const DEFAULT_COLLAPSE_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000
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

function applyRepositorySelection(snapshot: AppSnapshot, repositoryId: string | null): AppSnapshot {
  return {
    ...snapshot,
    selectedRepositoryId: repositoryId,
    selectedThreadId: null
  }
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

function shouldCollapseRepositoryByDefault(
  repository: RepositorySnapshot,
  now: number = Date.now()
): boolean {
  if (repository.threads.length === 0) {
    return true
  }

  const lastActivityAt = new Date(repository.lastActivityAt).getTime()
  if (!Number.isFinite(lastActivityAt)) {
    return false
  }

  return now - lastActivityAt >= DEFAULT_COLLAPSE_WINDOW_MS
}

function getDefaultCollapsedRepositoryIds(
  snapshot: AppSnapshot,
  now: number = Date.now()
): Set<string> {
  return new Set(
    snapshot.repositories
      .filter((repository) => shouldCollapseRepositoryByDefault(repository, now))
      .map((repository) => repository.id)
  )
}

export default function App(): React.JSX.Element {
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogKey>(null)
  const [editingRepositoryId, setEditingRepositoryId] = useState<string | null>(null)
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null)
  const [collapsedRepositoryIds, setCollapsedRepositoryIds] = useState<Set<string>>(new Set())
  const [autoLaunchThreadId, setAutoLaunchThreadId] = useState<string | null>(null)
  const [repositoryViewId, setRepositoryViewId] = useState<string | null>(null)
  const [newThreadError, setNewThreadError] = useState<string | null>(null)
  const [sessions, setSessions] = useState<SessionMap>(new Map())
  const [sidebarWidth, setSidebarWidth] = useState<number>(SIDEBAR_WIDTH_DEFAULT)
  const selectionRequestIdRef = useRef(0)
  const handleSnapshotLoaded = useCallback((nextSnapshot: AppSnapshot): void => {
    setCollapsedRepositoryIds(getDefaultCollapsedRepositoryIds(nextSnapshot))
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

  const selectedRepository = useMemo(() => {
    if (!snapshot) {
      return null
    }

    if (repositoryViewId) {
      return snapshot.repositories.find((repository) => repository.id === repositoryViewId) ?? null
    }

    return findSelectedRepository(snapshot)
  }, [repositoryViewId, snapshot])

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

  const handleSidebarResizeEnd = useCallback((finalWidth: number): void => {
    void api.appState.updateUi({ sidebarWidth: finalWidth })
  }, [])

  const handleAddRepository = useCallback(async (): Promise<void> => {
    setBusyAction('add-repository')
    const result = await applyMutation(api.appState.addRepository(), 'Repository added.')
    if (result.ok && result.snapshot?.selectedRepositoryId) {
      setRepositoryViewId(result.snapshot.selectedRepositoryId)
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

  const handleSelectRepository = useCallback(
    (repositoryId: string): void => {
      const requestId = ++selectionRequestIdRef.current
      setRepositoryViewId(repositoryId)
      setSnapshot((current) =>
        current ? applyRepositorySelection(current, repositoryId) : current
      )
      void api.appState.selectRepository(repositoryId).then((nextSnapshot) => {
        if (selectionRequestIdRef.current !== requestId) {
          return
        }

        setSnapshot(nextSnapshot)
      })
    },
    [setSnapshot]
  )

  const handleSelectThread = useCallback(
    (threadId: string): void => {
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

  const handleToggleRepository = useCallback((repositoryId: string): void => {
    setCollapsedRepositoryIds((current) => {
      const next = new Set(current)
      if (next.has(repositoryId)) {
        next.delete(repositoryId)
      } else {
        next.add(repositoryId)
      }
      return next
    })
  }, [])

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
          setFeedback({ tone: 'success', message: 'Thread created.' })
          setRepositoryViewId(null)
          const newThreadId = result.snapshot.selectedThreadId
          const newThread = findThreadById(result.snapshot, newThreadId)
          if (newThread && !newThread.hasLaunched) {
            setAutoLaunchThreadId(newThreadId)
          }
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

  const handleSaveRepository = useCallback(
    async (input: {
      repositoryId: string
      faviconPath: string | null
      runCommand: string | null
      newWorktreeSetupCommand: string | null
      postWorktreeRemoveCommand: string | null
    }): Promise<boolean> => {
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
          collapsedRepositoryIds={collapsedRepositoryIds}
          onAddRepository={() => void handleAddRepository()}
          onCloseThread={(id) => void handleCloseThread(id)}
          onEditRepository={handleOpenRepositoryEditor}
          onEditThread={handleOpenThreadEditor}
          onNewThread={handleOpenNewThreadDialog}
          onOpenSettings={() => setDialog('settings')}
          onSelectRepository={(id) => void handleSelectRepository(id)}
          onSelectThread={(id) => void handleSelectThread(id)}
          onToggleRepository={handleToggleRepository}
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

      <Workspace
        autoLaunchThreadId={autoLaunchThreadId}
        hasRepositories={snapshot.repositories.length > 0}
        onAddRepository={() => void handleAddRepository()}
        onAutoLaunchHandled={() => setAutoLaunchThreadId(null)}
        onCompleteRepositoryTask={handleCompleteRepositoryTask}
        onCreateRepositoryTask={(input) => handleCreateRepositoryTask(input)}
        onUpdateRepositoryTask={(input) => handleUpdateRepositoryTask(input)}
        onNewThread={() => handleOpenNewThreadDialog()}
        onStartRunCommand={() => void handleStartRunCommand()}
        onStopRunCommand={() => void handleStopRunCommand()}
        onOpenWorkingDirectory={() => void handleOpenWorkingDirectory()}
        onOpenWorkingDirectoryInVscode={() => void handleOpenWorkingDirectoryInVscode()}
        onRefresh={refreshSnapshot}
        onSessionsChange={handleSessionsChange}
        repositoryTaskBusy={
          busyAction === 'create-task' ||
          busyAction === 'complete-task' ||
          busyAction === 'update-task'
        }
        runCommandBusy={busyAction === 'run-command'}
        selectedRepository={selectedRepository}
        selectedThread={selectedThread}
        settings={snapshot.settings}
        threads={allThreads}
      />

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
        onBrowse={handleBrowseRepositoryFavicon}
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

import { useCallback, useEffect, useMemo, useState } from 'react'
import Sidebar from './components/Sidebar'
import Workspace from './components/Workspace'
import Toast, { type ToastTone } from './components/Toast'
import NewThreadDialog from './components/dialogs/NewThreadDialog'
import SettingsDialog from './components/dialogs/SettingsDialog'
import ThreadDetailsDialog from './components/dialogs/ThreadDetailsDialog'
import type {
  AppSnapshot,
  MutationResult,
  RepositorySnapshot,
  ThreadMode,
  ThreadSnapshot
} from '../../shared/app-types'

type Feedback = {
  tone: ToastTone
  message: string
}

type DialogKey = 'new-thread' | 'settings' | 'details' | null

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

export default function App(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogKey>(null)
  const [collapsedRepositoryIds, setCollapsedRepositoryIds] = useState<Set<string>>(new Set())
  const [autoLaunchThreadId, setAutoLaunchThreadId] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    void window.api.appState.getSnapshot().then((nextSnapshot) => {
      if (!isMounted) {
        return
      }

      setSnapshot(nextSnapshot)
    })

    return () => {
      isMounted = false
    }
  }, [])

  const refreshSnapshot = useCallback(async (): Promise<void> => {
    const nextSnapshot = await window.api.appState.refresh()
    setSnapshot(nextSnapshot)
  }, [])

  const selectedRepository = useMemo(() => {
    return snapshot ? findSelectedRepository(snapshot) : null
  }, [snapshot])

  const selectedThread = useMemo(() => {
    return snapshot ? findSelectedThread(snapshot) : null
  }, [snapshot])

  const applyMutation = useCallback(
    async (action: Promise<MutationResult>, successMessage?: string): Promise<MutationResult> => {
      const result = await action

      if (result.snapshot) {
        setSnapshot(result.snapshot)
      }

      if (result.ok) {
        if (successMessage) {
          setFeedback({ tone: 'success', message: successMessage })
        }
      } else if (!result.cancelled) {
        setFeedback({ tone: 'error', message: result.error ?? 'Request failed.' })
      }

      return result
    },
    []
  )

  const handleAddRepository = useCallback(async (): Promise<void> => {
    setBusyAction('add-repository')
    await applyMutation(window.api.appState.addRepository(), 'Repository added.')
    setBusyAction(null)
  }, [applyMutation])

  const handleSelectRepository = useCallback(async (repositoryId: string): Promise<void> => {
    const nextSnapshot = await window.api.appState.selectRepository(repositoryId)
    setSnapshot(nextSnapshot)
  }, [])

  const handleSelectThread = useCallback(async (threadId: string): Promise<void> => {
    const nextSnapshot = await window.api.appState.selectThread(threadId)
    setSnapshot(nextSnapshot)
  }, [])

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
    async (input: { mode: ThreadMode; title?: string; branchName?: string }): Promise<boolean> => {
      if (!selectedRepository) {
        return false
      }

      setBusyAction('create-thread')
      const result = await applyMutation(
        window.api.appState.createThread({
          repositoryId: selectedRepository.id,
          mode: input.mode,
          title: input.title,
          branchName: input.branchName
        }),
        'Thread created.'
      )
      setBusyAction(null)

      if (result.ok && result.snapshot?.selectedThreadId) {
        const newThreadId = result.snapshot.selectedThreadId
        const newThread = findThreadById(result.snapshot, newThreadId)
        if (newThread && !newThread.hasLaunched) {
          setAutoLaunchThreadId(newThreadId)
        }
      }

      return result.ok
    },
    [applyMutation, selectedRepository]
  )

  const handleSaveSettings = useCallback(
    async (input: { globalFlagsInput: string }): Promise<boolean> => {
      setBusyAction('save-settings')
      const result = await applyMutation(
        window.api.appState.updateSettings(input),
        'Settings saved.'
      )
      setBusyAction(null)
      return result.ok
    },
    [applyMutation]
  )

  const handleCloseThread = useCallback(async (): Promise<void> => {
    if (!selectedThread) {
      return
    }

    setBusyAction('close-thread')
    const result = await applyMutation(
      window.api.appState.closeThread(selectedThread.id),
      'Thread closed.'
    )
    setBusyAction(null)
    if (result.ok) {
      setDialog(null)
    }
  }, [applyMutation, selectedThread])

  // Ctrl+N to open new-thread dialog (also accepts ⌘ for cross-platform devs)
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
        if (selectedRepository) {
          event.preventDefault()
          setDialog('new-thread')
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedRepository])

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
    <div className="grid h-screen grid-cols-[268px_minmax(0,1fr)] bg-[var(--color-bg)] text-[var(--color-fg)]">
      <Sidebar
        busyAddRepository={busyAction === 'add-repository'}
        collapsedRepositoryIds={collapsedRepositoryIds}
        onAddRepository={() => void handleAddRepository()}
        onNewThread={() => setDialog('new-thread')}
        onOpenSettings={() => setDialog('settings')}
        onSelectRepository={(id) => void handleSelectRepository(id)}
        onSelectThread={(id) => void handleSelectThread(id)}
        onToggleRepository={handleToggleRepository}
        selectedRepository={selectedRepository}
        selectedThread={selectedThread}
        snapshot={snapshot}
      />

      <Workspace
        autoLaunchThreadId={autoLaunchThreadId}
        hasRepositories={snapshot.repositories.length > 0}
        onAddRepository={() => void handleAddRepository()}
        onAutoLaunchHandled={() => setAutoLaunchThreadId(null)}
        onNewThread={() => setDialog('new-thread')}
        onOpenDetails={() => setDialog('details')}
        onRefresh={refreshSnapshot}
        selectedRepository={selectedRepository}
        selectedThread={selectedThread}
        settings={snapshot.settings}
      />

      <NewThreadDialog
        busy={busyAction === 'create-thread'}
        onClose={() => setDialog(null)}
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

      <ThreadDetailsDialog
        closing={busyAction === 'close-thread'}
        onClose={() => setDialog(null)}
        onCloseThread={() => void handleCloseThread()}
        open={dialog === 'details'}
        thread={selectedThread}
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

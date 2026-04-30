import { useCallback, useEffect, useMemo, useState } from 'react'
import TerminalPane from './components/TerminalPane'
import type {
  AppSnapshot,
  MutationResult,
  RepositorySnapshot,
  ThreadMode,
  ThreadSnapshot
} from '../../shared/app-types'

type Feedback = {
  tone: 'error' | 'success' | 'info'
  message: string
}

const INITIAL_THREAD_FORM: {
  mode: ThreadMode
  title: string
  branchName: string
} = {
  mode: 'active-branch',
  title: '',
  branchName: ''
}

function formatRelativeTime(iso: string): string {
  const elapsed = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(elapsed / 60_000)
  const hours = Math.floor(elapsed / 3_600_000)
  const days = Math.floor(elapsed / 86_400_000)
  const weeks = Math.floor(days / 7)
  const months = Math.floor(days / 30)

  if (minutes < 1) {
    return 'now'
  }

  if (minutes < 60) {
    return `${minutes}m`
  }

  if (hours < 24) {
    return `${hours}h`
  }

  if (days < 7) {
    return `${days}d`
  }

  if (weeks < 5) {
    return `${weeks}w`
  }

  return `${months}mo`
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
  const [threadForm, setThreadForm] = useState(INITIAL_THREAD_FORM)
  const [flagsDraft, setFlagsDraft] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)

  const syncSnapshot = useCallback((nextSnapshot: AppSnapshot, syncFlagsDraft = false): void => {
    setSnapshot(nextSnapshot)

    if (syncFlagsDraft) {
      setFlagsDraft(nextSnapshot.settings.globalFlagsInput)
    }
  }, [])

  useEffect(() => {
    let isMounted = true

    void window.api.appState.getSnapshot().then((nextSnapshot) => {
      if (!isMounted) {
        return
      }

      syncSnapshot(nextSnapshot, true)
    })

    return () => {
      isMounted = false
    }
  }, [syncSnapshot])

  const refreshSnapshot = useCallback(async (): Promise<void> => {
    const nextSnapshot = await window.api.appState.refresh()
    syncSnapshot(nextSnapshot)
  }, [syncSnapshot])

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
        syncSnapshot(result.snapshot)
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
    [syncSnapshot]
  )

  const handleAddRepository = async (): Promise<void> => {
    setBusyAction('add-repository')
    await applyMutation(window.api.appState.addRepository(), 'Repository added.')
    setBusyAction(null)
  }

  const handleSelectRepository = async (repositoryId: string): Promise<void> => {
    const nextSnapshot = await window.api.appState.selectRepository(repositoryId)
    syncSnapshot(nextSnapshot)
  }

  const handleSelectThread = async (threadId: string): Promise<void> => {
    const nextSnapshot = await window.api.appState.selectThread(threadId)
    syncSnapshot(nextSnapshot)
  }

  const handleCreateThread = async (): Promise<void> => {
    if (!selectedRepository) {
      return
    }

    if (threadForm.mode === 'worktree' && !threadForm.branchName.trim()) {
      setFeedback({ tone: 'error', message: 'Branch name is required for worktree threads.' })
      return
    }

    setBusyAction('create-thread')
    const result = await applyMutation(
      window.api.appState.createThread({
        repositoryId: selectedRepository.id,
        mode: threadForm.mode,
        title: threadForm.title.trim() || undefined,
        branchName: threadForm.mode === 'worktree' ? threadForm.branchName.trim() : undefined
      }),
      'Thread created.'
    )

    if (result.ok) {
      setThreadForm(INITIAL_THREAD_FORM)
    }

    setBusyAction(null)
  }

  const handleCloseThread = async (): Promise<void> => {
    if (!selectedThread) {
      return
    }

    setBusyAction('close-thread')
    await applyMutation(window.api.appState.closeThread(selectedThread.id), 'Thread closed.')
    setBusyAction(null)
  }

  const handleSaveFlags = async (): Promise<void> => {
    if (flagsDraft === null) {
      return
    }

    setBusyAction('save-flags')
    const result = await applyMutation(
      window.api.appState.updateSettings({
        globalFlagsInput: flagsDraft
      }),
      'Global Copilot flags saved.'
    )

    if (result.ok && result.snapshot) {
      syncSnapshot(result.snapshot, true)
    }

    setBusyAction(null)
  }

  const feedbackClasses =
    feedback?.tone === 'error'
      ? 'border-red-400/20 bg-red-500/10 text-red-200'
      : feedback?.tone === 'success'
        ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-200'
        : 'border-cyan-400/20 bg-cyan-400/10 text-cyan-200'

  if (!snapshot) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-200">
        Loading Taskmaster...
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="grid min-h-screen grid-cols-[320px_minmax(0,1fr)]">
        <aside className="flex flex-col border-r border-white/10 bg-slate-900/70">
          <div className="border-b border-white/10 px-5 py-4">
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">
              Taskmaster
            </div>
            <h1 className="mt-2 text-xl font-semibold text-white">Copilot thread orchestrator</h1>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Embedded Copilot CLI, repo-scoped threads, and owned worktrees.
            </p>
          </div>

          <div className="flex-1 overflow-auto px-4 py-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                Repositories
              </h2>
              <button
                className="rounded-md border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1 text-xs font-medium text-cyan-200 disabled:opacity-50"
                disabled={busyAction === 'add-repository'}
                onClick={() => void handleAddRepository()}
                type="button"
              >
                Add repo
              </button>
            </div>

            <div className="space-y-3">
              {snapshot.repositories.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 bg-slate-950/30 px-4 py-5 text-sm text-slate-400">
                  Add a git repository to start creating Copilot threads.
                </div>
              ) : null}

              {snapshot.repositories.map((repository) => {
                const isSelected = repository.id === selectedRepository?.id

                return (
                  <section
                    className={`rounded-xl border p-3 transition ${
                      isSelected
                        ? 'border-cyan-400/30 bg-cyan-400/10'
                        : 'border-white/10 bg-slate-950/30'
                    }`}
                    key={repository.id}
                  >
                    <button
                      className="w-full text-left"
                      onClick={() => void handleSelectRepository(repository.id)}
                      type="button"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-white">{repository.name}</div>
                          <div className="mt-1 truncate text-xs text-slate-400">
                            {repository.path}
                          </div>
                          <div className="mt-2 text-xs text-slate-500">
                            current branch {repository.currentBranch}
                          </div>
                        </div>
                        <span className="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-300">
                          {formatRelativeTime(repository.lastActivityAt)}
                        </span>
                      </div>
                    </button>

                    <div className="mt-3 space-y-2">
                      {repository.threads.map((thread) => {
                        const isThreadSelected = thread.id === selectedThread?.id

                        return (
                          <button
                            className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                              isThreadSelected
                                ? 'border-cyan-400/30 bg-slate-950'
                                : 'border-white/10 bg-slate-900/70'
                            }`}
                            key={thread.id}
                            onClick={() => void handleSelectThread(thread.id)}
                            type="button"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="truncate text-sm font-medium text-white">
                                {thread.title}
                              </div>
                              <div className="flex items-center gap-2">
                                {thread.isRunning ? (
                                  <span className="rounded-full bg-cyan-400/15 px-2 py-0.5 text-[11px] text-cyan-200">
                                    running
                                  </span>
                                ) : null}
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[11px] ${
                                    thread.mode === 'worktree'
                                      ? 'bg-emerald-500/15 text-emerald-300'
                                      : 'bg-slate-800 text-slate-300'
                                  }`}
                                >
                                  {thread.mode === 'worktree' ? 'worktree' : 'active branch'}
                                </span>
                              </div>
                            </div>
                            <div className="mt-1 text-xs text-slate-400">
                              {thread.displayBranchName} ·{' '}
                              {formatRelativeTime(thread.lastActivityAt)}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </section>
                )
              })}
            </div>
          </div>

          <div className="border-t border-white/10 px-4 py-3 text-xs text-slate-400">
            Bun + Electron + React + Tailwind 4
          </div>
        </aside>

        <main className="flex min-w-0 flex-col">
          <header className="flex items-center justify-between gap-4 border-b border-white/10 px-6 py-4">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white">
                {selectedThread
                  ? `${selectedThread.title} · ${selectedThread.displayBranchName}`
                  : selectedRepository
                    ? `${selectedRepository.name} · ${selectedRepository.currentBranch}`
                    : 'Add a repository to begin'}
              </div>
              <div className="mt-1 text-sm text-slate-400">
                {selectedThread
                  ? selectedThread.mode === 'worktree'
                    ? `Owned worktree at ${selectedThread.cwd}`
                    : `Using the repository working tree at ${selectedThread.cwd}`
                  : selectedRepository
                    ? 'Create a thread or select an existing one to launch Copilot.'
                    : 'Taskmaster stores repos locally and resumes Copilot sessions by thread.'}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full border border-white/10 bg-slate-900 px-3 py-1 text-slate-300">
                port 5175
              </span>
              <button
                className="rounded-full border border-white/10 bg-slate-900 px-3 py-1 text-slate-300"
                onClick={() => void refreshSnapshot()}
                type="button"
              >
                Refresh
              </button>
            </div>
          </header>

          <section className="flex-1 overflow-auto p-6">
            <div className="mx-auto grid w-full max-w-6xl auto-rows-min gap-4 xl:grid-cols-[1.3fr_0.7fr]">
              <TerminalPane
                onFeedback={(tone, message) => setFeedback({ tone, message })}
                onRefresh={refreshSnapshot}
                selectedThread={selectedThread}
                settings={snapshot.settings}
              />

              <div className="space-y-4 self-start">
                {feedback ? (
                  <section className={`rounded-2xl border px-4 py-3 text-sm ${feedbackClasses}`}>
                    {feedback.message}
                  </section>
                ) : null}

                <section className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-base font-semibold text-white">Create thread</h2>
                    {selectedRepository ? (
                      <span className="rounded-full bg-slate-950 px-2.5 py-1 text-xs text-slate-300">
                        {selectedRepository.name}
                      </span>
                    ) : null}
                  </div>

                  {selectedRepository ? (
                    <div className="mt-4 space-y-4">
                      <label className="block text-sm text-slate-300">
                        <div className="mb-2 font-medium">Thread label</div>
                        <input
                          className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-slate-100 outline-none ring-0 placeholder:text-slate-500"
                          onChange={(event) =>
                            setThreadForm((current) => ({ ...current, title: event.target.value }))
                          }
                          placeholder={
                            threadForm.mode === 'worktree'
                              ? 'Defaults to the worktree branch name'
                              : `Defaults to ${selectedRepository.currentBranch}`
                          }
                          type="text"
                          value={threadForm.title}
                        />
                      </label>

                      <label className="block text-sm text-slate-300">
                        <div className="mb-2 font-medium">Mode</div>
                        <select
                          className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-slate-100 outline-none"
                          onChange={(event) =>
                            setThreadForm((current) => ({
                              ...current,
                              mode: event.target.value as ThreadMode
                            }))
                          }
                          value={threadForm.mode}
                        >
                          <option value="active-branch">Active branch</option>
                          <option value="worktree">Owned worktree</option>
                        </select>
                      </label>

                      {threadForm.mode === 'worktree' ? (
                        <label className="block text-sm text-slate-300">
                          <div className="mb-2 font-medium">Branch name</div>
                          <input
                            className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-slate-100 outline-none placeholder:text-slate-500"
                            onChange={(event) =>
                              setThreadForm((current) => ({
                                ...current,
                                branchName: event.target.value
                              }))
                            }
                            placeholder="feature/my-branch"
                            type="text"
                            value={threadForm.branchName}
                          />
                          <p className="mt-2 text-xs text-slate-500">
                            Worktree folder name is derived from this branch.
                          </p>
                        </label>
                      ) : (
                        <div className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-400">
                          New active-branch threads launch in {selectedRepository.currentBranch}.
                        </div>
                      )}

                      <button
                        className="w-full rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm font-medium text-cyan-200 disabled:opacity-50"
                        disabled={busyAction === 'create-thread'}
                        onClick={() => void handleCreateThread()}
                        type="button"
                      >
                        Create thread
                      </button>
                    </div>
                  ) : (
                    <p className="mt-4 text-sm text-slate-400">
                      Select a repository first, or add one from the sidebar.
                    </p>
                  )}
                </section>

                <section className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-base font-semibold text-white">Global Copilot flags</h2>
                    <span className="rounded-full bg-slate-950 px-2.5 py-1 text-xs text-slate-300">
                      applies to all threads
                    </span>
                  </div>

                  <div className="mt-4 space-y-4">
                    <label className="block text-sm text-slate-300">
                      <div className="mb-2 font-medium">Flags</div>
                      <input
                        className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-slate-100 outline-none placeholder:text-slate-500"
                        onChange={(event) => setFlagsDraft(event.target.value)}
                        placeholder="--yolo"
                        type="text"
                        value={flagsDraft ?? ''}
                      />
                    </label>

                    <div className="flex flex-wrap gap-2">
                      {snapshot.settings.parsedGlobalFlags.length > 0 ? (
                        snapshot.settings.parsedGlobalFlags.map((flag) => (
                          <span
                            className="rounded-full border border-white/10 bg-slate-950 px-2.5 py-1 text-xs text-slate-300"
                            key={flag}
                          >
                            {flag}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-slate-500">No global flags configured.</span>
                      )}
                    </div>

                    <button
                      className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-2 text-sm font-medium text-slate-200 disabled:opacity-50"
                      disabled={busyAction === 'save-flags'}
                      onClick={() => void handleSaveFlags()}
                      type="button"
                    >
                      Save flags
                    </button>
                  </div>
                </section>

                <section className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-base font-semibold text-white">Thread details</h2>
                    {selectedThread ? (
                      <button
                        className="rounded-full border border-red-400/30 bg-red-500/10 px-3 py-1 text-xs font-medium text-red-200 disabled:opacity-50"
                        disabled={busyAction === 'close-thread'}
                        onClick={() => void handleCloseThread()}
                        type="button"
                      >
                        Close thread
                      </button>
                    ) : null}
                  </div>

                  {selectedThread ? (
                    <div className="mt-4 space-y-3 text-sm text-slate-300">
                      <div className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2">
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                          Mode
                        </div>
                        <div className="mt-2">
                          {selectedThread.mode === 'worktree' ? 'Owned worktree' : 'Active branch'}
                        </div>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2">
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                          Branch
                        </div>
                        <div className="mt-2 break-all">{selectedThread.displayBranchName}</div>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2">
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                          Working directory
                        </div>
                        <div className="mt-2 break-all font-mono text-xs">{selectedThread.cwd}</div>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2">
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                          Last activity
                        </div>
                        <div className="mt-2">
                          {formatRelativeTime(selectedThread.lastActivityAt)}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-4 text-sm text-slate-400">
                      Select a thread to inspect its branch, cwd, and lifecycle controls.
                    </p>
                  )}
                </section>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}

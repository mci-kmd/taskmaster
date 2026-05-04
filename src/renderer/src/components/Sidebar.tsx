import { useEffect, useMemo, useState } from 'react'
import type { AppSnapshot, RepositorySnapshot, ThreadSnapshot } from '../../../shared/app-types'
import type { SessionMap } from './TerminalSessions'
import {
  BranchIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  GearIcon,
  LogoMark,
  PlusIcon,
  ThreadIcon,
  WorktreeIcon
} from './Icons'
import Button from './ui/Button'
import { formatRelativeTime } from '../lib/time'
import { composeThreadTitle } from '../lib/title'
import { useNow } from '../lib/useNow'

type SidebarProps = {
  snapshot: AppSnapshot
  selectedRepository: RepositorySnapshot | null
  selectedThread: ThreadSnapshot | null
  sessions: SessionMap
  collapsedRepositoryIds: Set<string>
  busyAddRepository: boolean
  onToggleRepository: (id: string) => void
  onSelectRepository: (id: string) => void
  onSelectThread: (id: string) => void
  onAddRepository: () => void
  onEditRepository: (id: string) => void
  onNewThread: () => void
  onOpenSettings: () => void
}

type RepositoryContextMenuState = {
  repositoryId: string
  x: number
  y: number
}

function RepositoryListIcon({
  repository,
  selected
}: {
  repository: RepositorySnapshot
  selected: boolean
}): React.JSX.Element {
  const [imageFailed, setImageFailed] = useState(false)

  if (repository.faviconUrl && !imageFailed) {
    return (
      <img
        alt=""
        className="size-[13px] shrink-0 rounded-[3px] object-contain"
        draggable={false}
        onError={() => setImageFailed(true)}
        src={repository.faviconUrl}
      />
    )
  }

  return (
    <FolderIcon
      className={selected ? 'text-[var(--color-fg)]' : 'text-[var(--color-fg-subtle)]'}
      width={13}
      height={13}
    />
  )
}

export default function Sidebar({
  snapshot,
  selectedRepository,
  selectedThread,
  sessions,
  collapsedRepositoryIds,
  busyAddRepository,
  onToggleRepository,
  onSelectRepository,
  onSelectThread,
  onAddRepository,
  onEditRepository,
  onNewThread,
  onOpenSettings
}: SidebarProps): React.JSX.Element {
  const now = useNow(30_000)
  const [contextMenu, setContextMenu] = useState<RepositoryContextMenuState | null>(null)
  const totalThreads = useMemo(
    () => snapshot.repositories.reduce((count, repository) => count + repository.threads.length, 0),
    [snapshot.repositories]
  )

  useEffect(() => {
    if (!contextMenu) {
      return
    }

    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setContextMenu(null)
      }
    }

    const handleBlur = (): void => {
      setContextMenu(null)
    }

    window.addEventListener('keydown', handleKey)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('keydown', handleKey)
      window.removeEventListener('blur', handleBlur)
    }
  }, [contextMenu])

  const getThreadModeTooltip = (thread: ThreadSnapshot): string | null => {
    if (thread.mode === 'worktree') {
      return 'Worktree thread'
    }
    if (thread.mode === 'new-branch') {
      return 'New branch thread'
    }
    return null
  }

  return (
    <aside className="flex min-h-0 w-full min-w-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-panel)]">
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-[var(--color-border)] px-4">
        <div className="flex items-center gap-2 text-[var(--color-fg)]">
          <LogoMark className="text-[var(--color-fg)]" />
          <span className="text-[13.5px] font-medium tracking-tight">Taskmaster</span>
        </div>
        <Button
          aria-label="Open settings"
          iconOnly
          onClick={onOpenSettings}
          size="sm"
          title="Settings"
          variant="ghost"
        >
          <GearIcon width={14} height={14} />
        </Button>
      </div>

      <div className="px-3 pt-3">
        <Button
          className="w-full justify-start"
          disabled={!selectedRepository}
          onClick={onNewThread}
          size="md"
          title={
            selectedRepository
              ? `New thread in ${selectedRepository.name} (Ctrl+N)`
              : 'Select a repository first'
          }
          variant="secondary"
        >
          <PlusIcon width={12} height={12} strokeWidth={1.8} />
          New thread
          <span className="ml-auto font-mono text-[10.5px] tracking-wide text-[var(--color-fg-subtle)]">
            Ctrl N
          </span>
        </Button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        <div className="mb-1.5 flex items-center justify-between px-2">
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--color-fg-subtle)]">
            <span>Repositories</span>
            <span className="text-[var(--color-fg-faint)]">·</span>
            <span className="font-mono normal-case tracking-normal text-[var(--color-fg-faint)]">
              {snapshot.repositories.length}
            </span>
          </div>
          <Button
            aria-label="Add repository"
            className="!h-6 !w-6 !p-0"
            disabled={busyAddRepository}
            onClick={onAddRepository}
            size="sm"
            title="Add repository"
            variant="ghost"
          >
            <PlusIcon width={13} height={13} strokeWidth={1.6} />
          </Button>
        </div>

        {snapshot.repositories.length === 0 ? (
          <div className="mt-3 rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-input)] px-3 py-5 text-center text-[12.5px] leading-5 text-[var(--color-fg-muted)]">
            No repositories yet.
            <br />
            <button
              className="mt-2 text-[var(--color-fg)] underline-offset-2 hover:underline"
              onClick={onAddRepository}
              title="Add a git repository"
              type="button"
            >
              Add one
            </button>{' '}
            to begin.
          </div>
        ) : null}

        <ul className="space-y-0.5">
          {snapshot.repositories.map((repository) => {
            const isCollapsed = collapsedRepositoryIds.has(repository.id)
            const isSelectedRepo = repository.id === selectedRepository?.id

            return (
              <li key={repository.id}>
                <div
                  className={`group flex items-center gap-1 rounded-md px-1.5 py-1.5 transition ${
                    isSelectedRepo && !selectedThread
                      ? 'bg-[var(--color-active)] text-[var(--color-fg)]'
                      : 'text-[var(--color-fg-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-fg)]'
                  }`}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    setContextMenu({
                      repositoryId: repository.id,
                      x: event.clientX,
                      y: event.clientY
                    })
                  }}
                >
                  <button
                    aria-label={isCollapsed ? 'Expand repository' : 'Collapse repository'}
                    className="grid size-5 place-items-center rounded text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
                    onClick={() => onToggleRepository(repository.id)}
                    title={isCollapsed ? 'Expand' : 'Collapse'}
                    type="button"
                  >
                    {isCollapsed ? (
                      <ChevronRightIcon width={12} height={12} />
                    ) : (
                      <ChevronDownIcon width={12} height={12} />
                    )}
                  </button>
                  <button
                    className="flex min-w-0 flex-1 items-center gap-1.5"
                    onClick={() => onSelectRepository(repository.id)}
                    title={`${repository.name} — ${repository.path}`}
                    type="button"
                  >
                    <RepositoryListIcon
                      key={`${repository.id}:${repository.faviconUrl ?? 'folder'}`}
                      repository={repository}
                      selected={isSelectedRepo}
                    />
                    <span className="truncate text-[13px] font-medium">{repository.name}</span>
                    {repository.threads.length > 0 ? (
                      <span className="ml-auto pr-0.5 font-mono text-[11px] text-[var(--color-fg-faint)]">
                        {repository.threads.length}
                      </span>
                    ) : null}
                  </button>
                </div>

                {!isCollapsed ? (
                  <ul className="mt-0.5 space-y-0.5 border-l border-[var(--color-border)] pl-3 ml-3.5">
                    {repository.threads.length === 0 ? (
                      <li className="px-2 py-1.5 text-[12px] text-[var(--color-fg-faint)]">
                        No threads
                      </li>
                    ) : null}
                    {repository.threads.map((thread) => {
                      const isSelected = thread.id === selectedThread?.id
                      const session = sessions.get(thread.id)
                      const composedTitle = composeThreadTitle(thread, session?.runtimeTitle)
                      const phase = session?.phase
                      const isLaunching = phase === 'launching'
                      const isRunning = thread.isRunning || phase === 'running'
                      const threadModeTooltip = getThreadModeTooltip(thread)

                      return (
                        <li key={thread.id}>
                          <button
                            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition ${
                              isSelected
                                ? 'bg-[var(--color-active)] text-[var(--color-fg)]'
                                : 'text-[var(--color-fg-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-fg)]'
                            }`}
                            onClick={() => onSelectThread(thread.id)}
                            title={`${composedTitle} · ${thread.displayBranchName}${
                              isRunning ? ' · running' : isLaunching ? ' · launching' : ''
                            }\n${thread.cwd}`}
                            type="button"
                          >
                            <span
                              aria-hidden
                              className={`size-1.5 shrink-0 rounded-full ${
                                isRunning
                                  ? 'bg-[var(--color-positive)] tm-pulse-dot'
                                  : isLaunching
                                    ? 'bg-[var(--color-info)] tm-pulse-dot'
                                    : isSelected
                                      ? 'bg-[var(--color-fg)]'
                                      : 'bg-[var(--color-fg-faint)]'
                              }`}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[12.5px] font-medium">
                                {composedTitle}
                              </span>
                              <span className="mt-0.5 flex items-center gap-1 text-[11px] text-[var(--color-fg-subtle)]">
                                <span className="truncate font-mono">
                                  {thread.displayBranchName}
                                </span>
                                <span className="text-[var(--color-fg-faint)]">·</span>
                                <span>{formatRelativeTime(thread.lastActivityAt, now)}</span>
                              </span>
                            </span>
                            {threadModeTooltip ? (
                              <span
                                aria-label={threadModeTooltip}
                                className="shrink-0 text-[var(--color-fg-subtle)]"
                                title={threadModeTooltip}
                              >
                                {thread.mode === 'worktree' ? (
                                  <WorktreeIcon width={11} height={11} />
                                ) : (
                                  <BranchIcon width={11} height={11} />
                                )}
                              </span>
                            ) : null}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                ) : null}
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="flex shrink-0 items-center gap-2 border-t border-[var(--color-border)] px-4 py-2.5 text-[11px] text-[var(--color-fg-subtle)]">
        <ThreadIcon width={11} height={11} className="text-[var(--color-fg-faint)]" />
        <span>
          {totalThreads} {totalThreads === 1 ? 'thread' : 'threads'}
        </span>
      </div>

      {contextMenu ? (
        <>
          <button
            aria-label="Close project menu"
            className="fixed inset-0 z-40 cursor-default appearance-none border-0 bg-transparent p-0"
            onClick={() => setContextMenu(null)}
            onContextMenu={(event) => {
              event.preventDefault()
              setContextMenu(null)
            }}
            type="button"
          />
          <div
            className="fixed z-50 min-w-[10rem] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-1 shadow-[var(--shadow-pop)]"
            onContextMenu={(event) => event.preventDefault()}
            style={{
              left: Math.min(contextMenu.x, window.innerWidth - 176),
              top: Math.min(contextMenu.y, window.innerHeight - 56)
            }}
          >
            <button
              className="flex w-full items-center rounded-md px-3 py-2 text-left text-[12.5px] text-[var(--color-fg)] transition hover:bg-[var(--color-hover)]"
              onClick={() => {
                onEditRepository(contextMenu.repositoryId)
                setContextMenu(null)
              }}
              title="Edit project"
              type="button"
            >
              Edit
            </button>
          </div>
        </>
      ) : null}
    </aside>
  )
}

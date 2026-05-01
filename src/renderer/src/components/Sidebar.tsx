import { useMemo } from 'react'
import type { AppSnapshot, RepositorySnapshot, ThreadSnapshot } from '../../../shared/app-types'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  GearIcon,
  LogoMark,
  PlusIcon,
  ThreadIcon
} from './Icons'
import { formatRelativeTime } from '../lib/time'

type SidebarProps = {
  snapshot: AppSnapshot
  selectedRepository: RepositorySnapshot | null
  selectedThread: ThreadSnapshot | null
  collapsedRepositoryIds: Set<string>
  busyAddRepository: boolean
  onToggleRepository: (id: string) => void
  onSelectRepository: (id: string) => void
  onSelectThread: (id: string) => void
  onAddRepository: () => void
  onNewThread: () => void
  onOpenSettings: () => void
}

export default function Sidebar({
  snapshot,
  selectedRepository,
  selectedThread,
  collapsedRepositoryIds,
  busyAddRepository,
  onToggleRepository,
  onSelectRepository,
  onSelectThread,
  onAddRepository,
  onNewThread,
  onOpenSettings
}: SidebarProps): React.JSX.Element {
  const totalThreads = useMemo(
    () => snapshot.repositories.reduce((count, repository) => count + repository.threads.length, 0),
    [snapshot.repositories]
  )

  return (
    <aside className="flex min-h-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-panel)]">
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-[var(--color-border)] px-4">
        <div className="flex items-center gap-2 text-[var(--color-fg)]">
          <LogoMark className="text-[var(--color-fg)]" />
          <span className="text-[13.5px] font-medium tracking-tight">Taskmaster</span>
        </div>
        <button
          aria-label="Open settings"
          className="grid size-7 place-items-center rounded-md text-[var(--color-fg-subtle)] transition hover:bg-[var(--color-hover)] hover:text-[var(--color-fg)]"
          onClick={onOpenSettings}
          type="button"
        >
          <GearIcon />
        </button>
      </div>

      <div className="px-3 pt-3">
        <button
          className="group flex w-full items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-2 text-[12.5px] font-medium text-[var(--color-fg)] transition hover:border-[var(--color-border-strong)] hover:bg-[var(--color-hover)] disabled:opacity-50"
          disabled={!selectedRepository}
          onClick={onNewThread}
          type="button"
        >
          <span className="grid size-5 place-items-center rounded-[5px] bg-[var(--color-active)] text-[var(--color-fg)] transition group-hover:bg-[var(--color-fg)] group-hover:text-[#0c0c0c]">
            <PlusIcon width={11} height={11} strokeWidth={1.8} />
          </span>
          New thread
          <span className="ml-auto font-mono text-[11px] text-[var(--color-fg-subtle)]">⌘N</span>
        </button>
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
          <button
            aria-label="Add repository"
            className="grid size-6 place-items-center rounded-md text-[var(--color-fg-subtle)] transition hover:bg-[var(--color-hover)] hover:text-[var(--color-fg)] disabled:opacity-50"
            disabled={busyAddRepository}
            onClick={onAddRepository}
            type="button"
          >
            <PlusIcon width={13} height={13} strokeWidth={1.6} />
          </button>
        </div>

        {snapshot.repositories.length === 0 ? (
          <div className="mt-3 rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-input)] px-3 py-5 text-center text-[12.5px] leading-5 text-[var(--color-fg-muted)]">
            No repositories yet.
            <br />
            <button
              className="mt-2 text-[var(--color-fg)] underline-offset-2 hover:underline"
              onClick={onAddRepository}
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
                >
                  <button
                    aria-label={isCollapsed ? 'Expand repository' : 'Collapse repository'}
                    className="grid size-5 place-items-center rounded text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
                    onClick={() => onToggleRepository(repository.id)}
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
                    type="button"
                  >
                    <FolderIcon
                      className={
                        isSelectedRepo ? 'text-[var(--color-fg)]' : 'text-[var(--color-fg-subtle)]'
                      }
                      width={13}
                      height={13}
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

                      return (
                        <li key={thread.id}>
                          <button
                            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition ${
                              isSelected
                                ? 'bg-[var(--color-active)] text-[var(--color-fg)]'
                                : 'text-[var(--color-fg-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-fg)]'
                            }`}
                            onClick={() => onSelectThread(thread.id)}
                            type="button"
                          >
                            <span
                              aria-hidden
                              className={`size-1.5 shrink-0 rounded-full ${
                                thread.isRunning
                                  ? 'bg-[var(--color-positive)] tm-pulse-dot'
                                  : isSelected
                                    ? 'bg-[var(--color-fg)]'
                                    : 'bg-[var(--color-fg-faint)]'
                              }`}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[12.5px] font-medium">
                                {thread.title}
                              </span>
                              <span className="mt-0.5 flex items-center gap-1 text-[11px] text-[var(--color-fg-subtle)]">
                                <span className="truncate font-mono">
                                  {thread.displayBranchName}
                                </span>
                                <span className="text-[var(--color-fg-faint)]">·</span>
                                <span>{formatRelativeTime(thread.lastActivityAt)}</span>
                              </span>
                            </span>
                            {thread.mode === 'worktree' ? (
                              <span className="shrink-0 rounded border border-[var(--color-border)] px-1 py-px font-mono text-[9.5px] uppercase tracking-[0.1em] text-[var(--color-fg-subtle)]">
                                wt
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

      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--color-border)] px-4 py-2.5 text-[11px] text-[var(--color-fg-subtle)]">
        <div className="flex items-center gap-1.5">
          <ThreadIcon width={11} height={11} className="text-[var(--color-fg-faint)]" />
          <span>{totalThreads} threads</span>
        </div>
        <span className="font-mono text-[10.5px] text-[var(--color-fg-faint)]">v1</span>
      </div>
    </aside>
  )
}

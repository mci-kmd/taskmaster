import { useCallback, useEffect, useMemo } from 'react'
import type {
  AppSnapshot,
  RepositorySnapshot,
  SidebarContextMenuActionEvent,
  SidebarContextMenuRequest,
  ThreadSnapshot
} from '../../../shared/app-types'
import type { SessionMap } from './TerminalSessions'
import { GearIcon, LogoMark, PerformanceIcon, PlusIcon } from './Icons'
import InboxThreads from './InboxThreads'
import Button from './ui/Button'
import { getRendererApi } from '../shared/api/client'
import { isDevMode } from '../../../shared/runtime-mode'
import { threadMenuOptions } from '../../../shared/sidebar-thread-actions'

const api = getRendererApi()

type SidebarProps = {
  snapshot: AppSnapshot
  selectedRepository: RepositorySnapshot | null
  selectedThread: ThreadSnapshot | null
  sessions: SessionMap
  busyAddRepository: boolean
  onSelectRepository: (id: string) => void
  onSelectThread: (id: string) => void
  onAddRepository: () => void
  onEditRepository: (id: string) => void
  onOpenRepositoryTasks: (id: string) => void
  onEditThread: (id: string) => void
  onNewThread: (repositoryId: string) => void
  onOpenSettings: () => void
  onOpenPerformance: () => void
  performanceOpen: boolean
  onSettleThread: (id: string, settled: boolean) => void
  onConvertThreadToWorktree: (id: string) => void
  onCloseThread: (id: string) => void
  convertingThread: boolean
  closingThread: boolean
}

export default function Sidebar({
  snapshot,
  selectedRepository,
  selectedThread,
  sessions,
  busyAddRepository,
  onSelectRepository,
  onSelectThread,
  onAddRepository,
  onEditRepository,
  onOpenRepositoryTasks,
  onEditThread,
  onNewThread,
  onOpenSettings,
  onOpenPerformance,
  performanceOpen,
  onSettleThread,
  onConvertThreadToWorktree,
  onCloseThread,
  convertingThread,
  closingThread
}: SidebarProps): React.JSX.Element {
  const totalThreads = useMemo(
    () => snapshot.repositories.reduce((count, repository) => count + repository.threads.length, 0),
    [snapshot.repositories]
  )

  const handleContextMenuAction = useCallback(
    (payload: SidebarContextMenuActionEvent): void => {
      if (payload.action === 'edit') {
        onEditThread(payload.itemId)
        return
      }

      if (payload.action === 'convert-to-worktree') {
        onConvertThreadToWorktree(payload.itemId)
        return
      }

      if (payload.action === 'settle-thread' || payload.action === 'unsettle-thread') {
        onSettleThread(payload.itemId, payload.action === 'settle-thread')
        return
      }

      if (payload.action === 'close-thread') {
        onCloseThread(payload.itemId)
      }
    },
    [onSettleThread, onCloseThread, onConvertThreadToWorktree, onEditThread]
  )

  useEffect(() => {
    return api.appState.onSidebarContextMenuAction(handleContextMenuAction)
  }, [handleContextMenuAction])

  const showContextMenu = useCallback((request: SidebarContextMenuRequest): void => {
    void api.appState.showSidebarContextMenu(request)
  }, [])

  return (
    <aside className="flex min-h-0 w-full min-w-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-panel)]">
      <div className="flex h-12 shrink-0 items-center justify-between gap-1 border-b border-[var(--color-border)] px-3">
        <div className="flex min-w-0 items-center gap-2 text-[var(--color-fg)]">
          <LogoMark className="text-[var(--color-fg)]" />
          <div className="flex items-center gap-2">
            <span className="text-[13.5px] font-medium tracking-tight">Taskmaster</span>
            {isDevMode ? (
              <span className="rounded-full border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/12 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--color-warning)]">
                Dev
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            aria-label="Model performance"
            aria-pressed={performanceOpen}
            className={performanceOpen ? '!bg-[var(--color-active)] !text-[var(--color-fg)]' : ''}
            iconOnly
            onClick={onOpenPerformance}
            size="sm"
            title="Model performance"
            variant="ghost"
          >
            <PerformanceIcon width={14} height={14} />
          </Button>
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
      </div>

      <nav className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 py-3">
        <div className="mb-1.5 flex shrink-0 items-center justify-between px-2">
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--color-fg-subtle)]">
            <span>Threads</span>
            <span className="text-[var(--color-fg-faint)]">·</span>
            <span className="font-mono normal-case tracking-normal text-[var(--color-fg-faint)]">
              {totalThreads}
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

        <InboxThreads
          repositories={snapshot.repositories}
          selectedRepository={selectedRepository}
          selectedThread={selectedThread}
          sessions={sessions}
          onSelectRepository={onSelectRepository}
          onSelectThread={onSelectThread}
          onNewThread={onNewThread}
          onEditRepository={onEditRepository}
          onOpenRepositoryTasks={onOpenRepositoryTasks}
          onEditThread={onEditThread}
          onSettleThread={onSettleThread}
          onCloseThread={onCloseThread}
          onConvertThreadToWorktree={onConvertThreadToWorktree}
          convertingThread={convertingThread}
          closingThread={closingThread}
          onContextMenu={(thread, x, y) =>
            showContextMenu({
              kind: 'thread',
              itemId: thread.id,
              x,
              y,
              ...threadMenuOptions(thread, convertingThread, closingThread)
            })
          }
        />
      </nav>
    </aside>
  )
}

import { useMemo } from 'react'
import type { AppSnapshot, RepositorySnapshot, ThreadSnapshot } from '../../../shared/app-types'
import type { SessionMap } from './TerminalSessions'
import { GearIcon, LogoMark, PerformanceIcon, PlusIcon } from './Icons'
import InboxThreads from './InboxThreads'
import Button from './ui/Button'
import Presence from './ui/Presence'
import { isDevMode } from '../../../shared/runtime-mode'

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
  onToggleRepositoryFavorite: (id: string, favorite: boolean) => void
  onRegenerateTitle: (id: string) => void
  regeneratingTitleIds: ReadonlySet<string>
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
  onToggleRepositoryFavorite,
  onRegenerateTitle,
  regeneratingTitleIds,
  convertingThread,
  closingThread
}: SidebarProps): React.JSX.Element {
  const totalThreads = useMemo(
    () => snapshot.repositories.reduce((count, repository) => count + repository.threads.length, 0),
    [snapshot.repositories]
  )

  return (
    <aside className="flex min-h-0 w-full min-w-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 pr-2 pl-4">
        <LogoMark className="shrink-0 text-accent-2" />
        <span className="text-[14px] font-[620] tracking-[-0.015em] text-fg">Taskmaster</span>
        {isDevMode ? (
          <span className="rounded-full bg-warning-soft px-1.5 text-[9.5px] leading-4 font-semibold tracking-[0.12em] text-warning uppercase">
            Dev
          </span>
        ) : null}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <Button
            aria-label="Model performance"
            aria-pressed={performanceOpen}
            iconOnly
            onClick={onOpenPerformance}
            size="sm"
            title="Model performance"
            variant="ghost"
          >
            <PerformanceIcon width={15} height={15} />
          </Button>
          <Button
            aria-label="Open settings"
            iconOnly
            onClick={onOpenSettings}
            size="sm"
            title="Settings"
            variant="ghost"
          >
            <GearIcon width={15} height={15} />
          </Button>
        </div>
      </div>

      <nav className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 pb-2">
        <div className="flex h-8 shrink-0 items-center pr-0.5 pl-2 text-[10.5px] font-semibold tracking-[0.09em] text-fg-subtle uppercase">
          <span>Threads</span>
          <span
            key={totalThreads}
            className="tm-fade-in ml-1.5 font-mono tracking-normal text-fg-subtle"
          >
            · {totalThreads}
          </span>
          <Button
            aria-label="Add repository"
            className="ml-auto"
            disabled={busyAddRepository}
            iconOnly
            onClick={onAddRepository}
            size="xs"
            title="Add repository"
            variant="ghost"
          >
            <PlusIcon width={13} height={13} strokeWidth={1.6} />
          </Button>
        </div>

        <Presence show={snapshot.repositories.length === 0} motion="collapse">
          <div className="shrink-0">
            <div className="mt-1 mb-2 rounded-lg border border-dashed border-border-strong bg-surface px-3 py-5 text-center text-[12.5px] leading-5 text-fg-muted">
              No repositories yet.
              <br />
              <button
                className="mt-2 rounded-xs text-fg underline-offset-2 hover:underline"
                onClick={onAddRepository}
                title="Add a git repository"
                type="button"
              >
                Add one
              </button>{' '}
              to begin.
            </div>
          </div>
        </Presence>
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
          onToggleRepositoryFavorite={onToggleRepositoryFavorite}
          onRegenerateTitle={onRegenerateTitle}
          regeneratingTitleIds={regeneratingTitleIds}
          convertingThread={convertingThread}
          closingThread={closingThread}
        />
      </nav>
    </aside>
  )
}

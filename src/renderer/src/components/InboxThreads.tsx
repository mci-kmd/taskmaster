import Select from './ui/Select'
import ActionMenu from './ui/ActionMenu'
import { useListMotion } from '../lib/use-list-motion'
import { useState } from 'react'
import type { RepositorySnapshot, ThreadSnapshot } from '../../../shared/app-types'
import type { SessionMap } from './TerminalSessions'
import ProjectIcon from './ProjectIcon'
import { ChevronRightIcon, PencilIcon, GearIcon, TasksIcon } from './Icons'
import { composeThreadTitle } from '../lib/title'
import { formatRelativeTime } from '../lib/time'
import { useNow } from '../lib/useNow'
import { getInboxThreads } from '../lib/inbox-threads'

export default function InboxThreads({
  repositories,
  selectedRepository,
  selectedThread,
  sessions,
  onSelectRepository,
  onSelectThread,
  onNewThread,
  onEditRepository,
  onOpenRepositoryTasks,
  onEditThread,
  onSettleThread,
  onContextMenu
}: {
  repositories: RepositorySnapshot[]
  selectedRepository: RepositorySnapshot | null
  selectedThread: ThreadSnapshot | null
  sessions: SessionMap
  onSelectRepository: (id: string) => void
  onSelectThread: (id: string) => void
  onNewThread: (id: string) => void
  onEditRepository: (id: string) => void
  onOpenRepositoryTasks: (id: string) => void
  onEditThread: (id: string) => void
  onSettleThread: (id: string, settled: boolean) => void
  onContextMenu: (thread: ThreadSnapshot, x: number, y: number) => void
}): React.JSX.Element {
  const [settledExpanded, setSettledExpanded] = useState(false)
  const activeList = useListMotion()
  const settledList = useListMotion()
  const now = useNow(30_000)
  const { active, settled } = getInboxThreads(repositories)
  const row = ({ thread, repository }: (typeof active)[number]): React.JSX.Element => {
    const session = sessions.get(thread.id)
    const title = composeThreadTitle(thread, session?.runtimeTitle)
    const status = session?.copilotStatus ?? 'idle'
    return (
      <li
        key={thread.id}
        data-thread-id={thread.id}
        className={`tm-inbox-row group flex items-center rounded-md ${selectedThread?.id === thread.id ? 'bg-[var(--color-active)]' : 'hover:bg-[var(--color-hover)]'}`}
        onContextMenu={(event) => {
          event.preventDefault()
          onContextMenu(thread, event.clientX, event.clientY)
        }}
      >
        <button
          type="button"
          onClick={() => onSelectThread(thread.id)}
          className="flex min-w-0 flex-1 items-start gap-2.5 px-2 py-2.5 text-left"
          title={`${title}\n${repository.name} · ${thread.displayBranchName}\n${thread.cwd}`}
        >
          <span className="mt-0.5">
            <ProjectIcon repository={repository} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-medium">{title}</span>
            <span className="mt-1 block truncate text-[11px] text-[var(--color-fg-subtle)]">
              {repository.name} · {thread.displayBranchName}
            </span>
            <span className="mt-1 flex items-center gap-1.5 text-[10.5px] text-[var(--color-fg-subtle)]">
              <span
                className={
                  status === 'working' || status === 'connecting'
                    ? 'text-[var(--color-info)]'
                    : status === 'input'
                      ? 'text-[#c4a7ff]'
                      : status === 'error'
                        ? 'text-[var(--color-danger)]'
                        : ''
                }
              >
                {status}
              </span>
              <span>·</span>
              <span>{formatRelativeTime(thread.lastActivityAt, now)}</span>
            </span>
          </span>
        </button>
        <div className="tm-inbox-actions mr-1 flex shrink-0 flex-col opacity-0 focus-within:opacity-100 group-hover:opacity-100">
          <button
            type="button"
            className="tm-inbox-action grid size-6 place-items-center rounded text-[var(--color-fg-muted)]"
            onClick={() => onSettleThread(thread.id, !thread.settledAt)}
            aria-label={`${thread.settledAt ? 'Unsettle' : 'Settle'} ${title}`}
            title={thread.settledAt ? 'Unsettle thread' : 'Settle thread'}
          >
            {thread.settledAt ? '↶' : '✓'}
          </button>
          <ActionMenu
            label={`Thread actions for ${title}`}
            items={[{ label: 'Edit', onSelect: () => onEditThread(thread.id) }]}
          >
            ···
          </ActionMenu>
        </div>
      </li>
    )
  }
  return (
    <div className="tm-inbox flex min-h-0 flex-1 flex-col">
      {repositories.length > 0 ? (
        <div className="mb-3 flex shrink-0 items-center gap-1 px-1">
          <Select
            aria-label="Project for new thread"
            className="min-w-0 flex-1"
            value={selectedRepository?.id ?? repositories[0]?.id ?? ''}
            onChange={onSelectRepository}
            options={repositories.map((repository) => ({
              value: repository.id,
              label: repository.name,
              description: repository.path,
              icon: <ProjectIcon repository={repository} />
            }))}
          />
          <button
            type="button"
            className="grid size-7 shrink-0 place-items-center rounded hover:bg-[var(--color-control-hover)]"
            title="Project tasks"
            aria-label="Project tasks"
            onClick={() => {
              if (selectedRepository) onOpenRepositoryTasks(selectedRepository.id)
            }}
          >
            <TasksIcon width={14} height={14} />
          </button>
          <button
            type="button"
            className="grid size-7 shrink-0 place-items-center rounded hover:bg-[var(--color-hover)]"
            title="Edit project"
            aria-label="Edit project"
            onClick={() => {
              if (selectedRepository) onEditRepository(selectedRepository.id)
            }}
          >
            <GearIcon width={13} height={13} />
          </button>
          <button
            type="button"
            className="grid size-7 shrink-0 place-items-center rounded hover:bg-[var(--color-hover)]"
            title="New thread (Ctrl+N)"
            aria-label="New thread"
            onClick={() => {
              if (selectedRepository) onNewThread(selectedRepository.id)
            }}
          >
            <PencilIcon width={14} height={14} />
          </button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <ul ref={activeList} className="relative space-y-0.5" aria-label="Active threads">
          {active.map(row)}
        </ul>
        {active.length === 0 ? (
          <p className="px-2 py-5 text-[12px] text-[var(--color-fg-subtle)]">
            {settled.length > 0
              ? 'All caught up. Start a new thread or revisit a settled one.'
              : 'Create a thread to start your inbox.'}
          </p>
        ) : null}
      </div>
      <div className="mt-2 shrink-0 border-t border-[var(--color-border)]">
        <button
          type="button"
          aria-expanded={settledExpanded}
          aria-controls="settled-threads"
          onClick={() => setSettledExpanded(!settledExpanded)}
          className="flex w-full items-center gap-2 rounded px-2 pt-3 pb-2 text-left text-[12px] text-[var(--color-fg-subtle)] transition-colors hover:text-[var(--color-fg)]"
        >
          <ChevronRightIcon
            className="tm-inbox-shelf-chevron"
            data-expanded={settledExpanded}
            width={12}
            height={12}
          />
          Settled threads{' '}
          <span className="ml-auto text-[var(--color-fg-faint)]">{settled.length}</span>
        </button>
        <div
          className="tm-inbox-settled-body"
          data-expanded={settledExpanded}
          inert={!settledExpanded}
          aria-hidden={!settledExpanded}
        >
          <ul
            ref={settledList}
            id="settled-threads"
            aria-label="Settled threads"
            className="relative space-y-0.5"
          >
            {settled.map(row)}
          </ul>
        </div>
      </div>
    </div>
  )
}

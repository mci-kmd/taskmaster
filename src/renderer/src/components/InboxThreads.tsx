import { useMemo, useState } from 'react'
import Select from './ui/Select'
import ActionMenu from './ui/ActionMenu'
import LeaveWith from './ui/LeaveWith'
import Button from './ui/Button'
import Presence from './ui/Presence'
import {
  useAnimatedListMotion,
  usePresenceList,
  type PresenceEntry
} from '../lib/use-presence-list'
import type { RepositorySnapshot, ThreadSnapshot } from '../../../shared/app-types'
import type { SessionMap } from './TerminalSessions'
import type { CopilotThreadStatus } from './ThreadTerminal'
import ProjectIcon from './ProjectIcon'
import {
  AlertIcon,
  ChevronRightIcon,
  CheckIcon,
  GitCommitIcon,
  PencilIcon,
  GearIcon,
  MoreIcon,
  PlayIcon,
  QuestionIcon,
  TasksIcon,
  UndoIcon
} from './Icons'
import { COMMIT_PHASE_LABELS } from '../../../shared/commit'
import { composeThreadTitle } from '../lib/title'
import { formatRelativeTime } from '../lib/time'
import { useNow } from '../lib/useNow'
import { getInboxThreads } from '../lib/inbox-threads'
import { threadMenuOptions, threadMenuActions } from '../../../shared/sidebar-thread-actions'

type InboxEntry = ReturnType<typeof getInboxThreads>['active'][number]

const entryKey = (entry: InboxEntry): string => entry.thread.id

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
  onCloseThread,
  onConvertThreadToWorktree,
  convertingThread,
  closingThread,
  onContextMenu,
  onToggleRepositoryFavorite,
  onRegenerateTitle,
  regeneratingTitleIds
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
  onCloseThread: (id: string) => void
  onConvertThreadToWorktree: (id: string) => void
  convertingThread: boolean
  closingThread: boolean
  onContextMenu: (thread: ThreadSnapshot, x: number, y: number) => void
  onToggleRepositoryFavorite?: (id: string, favorite: boolean) => void
  onRegenerateTitle?: (id: string) => void
  regeneratingTitleIds?: ReadonlySet<string>
}): React.JSX.Element {
  const [settledExpanded, setSettledExpanded] = useState(false)
  const now = useNow(30_000)
  const { active, settled } = useMemo(() => getInboxThreads(repositories), [repositories])
  // Rows that leave a list (settled, restored, closed) stay mounted while they animate out.
  const activeEntries = usePresenceList(active, entryKey, 'inbox')
  const settledEntries = usePresenceList(settled, entryKey, 'inbox')
  const activeList = useAnimatedListMotion<HTMLUListElement>('inbox')
  const settledList = useAnimatedListMotion<HTMLUListElement>('inbox')
  const hasFavorites = repositories.some((repository) => repository.favorite)

  const row = ({ key, item, exitToken }: PresenceEntry<InboxEntry>): React.JSX.Element => {
    const { thread, repository } = item
    const exiting = exitToken !== null
    const session = sessions.get(thread.id)
    const title = composeThreadTitle(thread, session?.runtimeTitle)
    const subtitle =
      thread.projectKind === 'general'
        ? repository.name
        : `${repository.name} · ${thread.displayBranchName}`
    return (
      <li
        key={key}
        className="tm-inbox-item"
        data-motion-key={key}
        data-thread-id={thread.id}
        data-exiting={exiting ? '' : undefined}
        inert={exiting}
      >
        <LeaveWith leaving={exiting}>
          <div
            className="tm-inbox-row group"
            data-selected={selectedThread?.id === thread.id || undefined}
            onContextMenu={(event) => {
              event.preventDefault()
              onContextMenu(thread, event.clientX, event.clientY)
            }}
          >
            <button
              type="button"
              onClick={() => onSelectThread(thread.id)}
              className="tm-inbox-row-main"
              title={`${title}\n${subtitle}\n${thread.cwd}`}
            >
              <span className="mt-px">
                <ProjectIcon repository={repository} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="tm-inbox-row-title">{title}</span>
                <span className="tm-inbox-row-subtitle">{subtitle}</span>
                <span className="tm-inbox-row-meta">
                  <ThreadStatus
                    commitPhase={thread.commitPhase}
                    status={session?.copilotStatus ?? 'idle'}
                  />
                  <span className="text-fg-faint">·</span>
                  <span className="tabular-nums">
                    {formatRelativeTime(thread.lastActivityAt, now)}
                  </span>
                  <Presence show={thread.isRunCommandRunning} motion="fade">
                    <span
                      className="tm-inbox-app-running"
                      role="img"
                      aria-label="App running"
                      title="App running"
                    >
                      <PlayIcon width={9} height={9} />
                    </span>
                  </Presence>
                </span>
              </span>
            </button>
            <div className="tm-inbox-actions">
              <Button
                className="tm-inbox-action"
                data-action={thread.settledAt ? 'unsettle' : 'settle'}
                iconOnly
                size="xs"
                variant="ghost"
                onClick={() => onSettleThread(thread.id, !thread.settledAt)}
                aria-label={`${thread.settledAt ? 'Unsettle' : 'Settle'} ${title}`}
                title={thread.settledAt ? 'Unsettle thread' : 'Settle thread'}
              >
                {thread.settledAt ? (
                  <UndoIcon width={12} height={12} strokeWidth={1.7} />
                ) : (
                  <CheckIcon width={13} height={13} strokeWidth={1.8} />
                )}
              </Button>
              <ActionMenu
                label={`Thread actions for ${title}`}
                triggerClassName="tm-inbox-action"
                items={threadMenuActions(
                  threadMenuOptions(
                    thread,
                    convertingThread,
                    closingThread,
                    regeneratingTitleIds?.has(thread.id)
                  )
                ).map(({ action, label, enabled }) => ({
                  label,
                  disabled: !enabled,
                  onSelect: () => {
                    if (action === 'edit') onEditThread(thread.id)
                    else if (action === 'regenerate-title') onRegenerateTitle?.(thread.id)
                    else if (action === 'convert-to-worktree') onConvertThreadToWorktree(thread.id)
                    else if (action === 'settle-thread' || action === 'unsettle-thread')
                      onSettleThread(thread.id, action === 'settle-thread')
                    else if (action === 'close-thread') onCloseThread(thread.id)
                  }
                }))}
              >
                <MoreIcon width={13} height={13} />
              </ActionMenu>
            </div>
          </div>
        </LeaveWith>
      </li>
    )
  }

  return (
    <div className="tm-inbox flex min-h-0 flex-1 flex-col">
      <Presence show={repositories.length > 0} motion="collapse">
        <div className="shrink-0">
          <div className="flex items-center gap-0.5 pt-0.5 pb-2">
            <Select
              aria-label="Project for new thread"
              className="mr-1 min-w-0 flex-1"
              value={selectedRepository?.id ?? repositories[0]?.id ?? ''}
              onChange={onSelectRepository}
              onToggleFavorite={onToggleRepositoryFavorite}
              options={projectOptions(repositories).map((repository) => ({
                value: repository.id,
                label: repository.name,
                description: repository.path,
                icon: <ProjectIcon repository={repository} />,
                favorite: repository.favorite === true,
                group: hasFavorites ? (repository.favorite ? 'Favorites' : 'Projects') : undefined
              }))}
            />
            <Button
              iconOnly
              size="sm"
              variant="ghost"
              title="Project tasks"
              aria-label="Project tasks"
              onClick={() => {
                if (selectedRepository) onOpenRepositoryTasks(selectedRepository.id)
              }}
            >
              <TasksIcon width={14} height={14} />
            </Button>
            <Button
              iconOnly
              size="sm"
              variant="ghost"
              title="Edit project"
              aria-label="Edit project"
              onClick={() => {
                if (selectedRepository) onEditRepository(selectedRepository.id)
              }}
            >
              <GearIcon width={14} height={14} />
            </Button>
            <Button
              iconOnly
              size="sm"
              variant="ghost"
              title="New thread (Ctrl+N)"
              aria-label="New thread"
              onClick={() => {
                if (selectedRepository) onNewThread(selectedRepository.id)
              }}
            >
              <PencilIcon width={14} height={14} />
            </Button>
          </div>
        </div>
      </Presence>
      <div className="tm-inbox-scroll min-h-0 flex-1">
        <ul ref={activeList} className="relative" aria-label="Active threads">
          {activeEntries.map(row)}
        </ul>
        <Presence show={active.length === 0} motion="fade">
          <p className="px-2 py-5 text-[12px] leading-5 text-fg-subtle">
            {repositories.length === 0
              ? 'Add a repository to start a thread.'
              : settled.length > 0
                ? 'All caught up. Start a new thread or revisit a settled one.'
                : 'Create a thread to start your inbox.'}
          </p>
        </Presence>
      </div>
      <div className="tm-inbox-shelf">
        <button
          type="button"
          aria-expanded={settledExpanded}
          aria-controls="settled-threads"
          onClick={() => setSettledExpanded(!settledExpanded)}
          className="tm-inbox-shelf-toggle"
        >
          <ChevronRightIcon
            className="tm-inbox-shelf-chevron"
            data-expanded={settledExpanded}
            width={12}
            height={12}
            strokeWidth={1.8}
          />
          Settled threads{' '}
          <span key={settled.length} className="tm-inbox-shelf-count tm-fade-in">
            {settled.length}
          </span>
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
            className="relative pb-1"
          >
            {settledEntries.map(row)}
          </ul>
        </div>
      </div>
    </div>
  )
}

/**
 * A thread's status in its meta line. Each status is keyed, so a change (working → done)
 * swaps in the new badge with an entrance instead of an instant replacement.
 */
function ThreadStatus({
  commitPhase,
  status
}: {
  commitPhase: ThreadSnapshot['commitPhase']
  status: CopilotThreadStatus
}): React.JSX.Element {
  if (commitPhase) {
    const label = commitPhase === 'pushing' ? 'Pushing' : 'Committing'
    return (
      <span
        key={label}
        className="tm-status-badge tm-fade-in"
        data-status="committing"
        title={COMMIT_PHASE_LABELS[commitPhase]}
      >
        <GitCommitIcon className="tm-blink" width={11} height={11} strokeWidth={1.7} />
        {label}
      </span>
    )
  }
  if (status === 'done' || status === 'input') {
    return (
      <span key={status} className="tm-status-badge tm-fade-in" data-status={status}>
        {status === 'done' ? (
          <CheckIcon width={11} height={11} strokeWidth={2} />
        ) : (
          <QuestionIcon width={11} height={11} strokeWidth={1.8} />
        )}
        {status === 'done' ? 'Done' : 'Needs input'}
      </span>
    )
  }
  return (
    <span key={status} className="tm-thread-status tm-fade-in" data-status={status}>
      {status === 'working' || status === 'connecting' ? (
        <span className="tm-live-dot" aria-hidden="true" />
      ) : status === 'error' ? (
        <AlertIcon width={11} height={11} strokeWidth={1.8} aria-hidden="true" />
      ) : (
        <span className="tm-thread-status-ring" aria-hidden="true" />
      )}
      {STATUS_LABELS[status]}
    </span>
  )
}

const STATUS_LABELS: Record<CopilotThreadStatus, string> = {
  idle: 'Idle',
  working: 'Working',
  connecting: 'Connecting',
  input: 'Needs input',
  done: 'Done',
  error: 'Error',
  disconnected: 'Disconnected'
}

/** Favorite projects first, otherwise in snapshot order. */
function projectOptions(repositories: RepositorySnapshot[]): RepositorySnapshot[] {
  return [
    ...repositories.filter((repository) => repository.favorite),
    ...repositories.filter((repository) => !repository.favorite)
  ]
}
